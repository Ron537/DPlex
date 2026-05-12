import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { isProcessAlive, verifyProcessIdentity } from './processUtils'

/**
 * Live status snapshot from a Claude Code `~/.claude/sessions/<pid>.json`
 * file. Only fields the registry actually trusts and consumes are typed —
 * the file may contain additional opaque keys that we ignore.
 *
 * The Claude CLI rewrites this file on every state transition; treat it as
 * a live mirror of the running session's status.
 */
export interface ClaudePidfileSnapshot {
  pid: number
  sessionId: string
  cwd: string
  /** High-level traffic-light state. */
  status?: 'idle' | 'busy' | 'waiting'
  /** Reason when `status === "waiting"`. Examples: `approve <toolName>`,
   *  `worker request`, `sandbox request`, `dialog open`, `input needed`. */
  waitingFor?: string
  /** 2–4 word lowercase auto-generated session label. */
  name?: string
  /** One-line summary of the current tool call (e.g. `Bash · git status`). */
  detail?: string
  /** Free-form classifier label (`working`, `idle`, `blocked`, ...). */
  state?: string
  /** Pace classification used by the agent-name picker / blockers. */
  tempo?: 'active' | 'idle' | 'blocked'
  /** What a `blocked`/`tempo:"blocked"` agent needs from the user. */
  needs?: string
  /** Epoch ms of the last status mutation. */
  updatedAt?: number
  /** Epoch ms when the Claude process was started. Used together with
   *  the OS-reported start time to detect PID reuse — if the live PID's
   *  start time disagrees with this value, the original Claude crashed
   *  and the kernel reassigned the PID to an unrelated process. */
  startedAt?: number
  /** Human-readable OS-level process-creation timestamp. Informational —
   *  use `startedAt` for identity checks. */
  procStart?: string | number
  version?: string
  kind?: string
  entrypoint?: string
}

type Listener = (snapshots: ClaudePidfileSnapshot[]) => void

/**
 * Watches `~/.claude/sessions/*.json` (Claude Code's per-process pidfile
 * registry — internally called "fleetview"). Maintains in-memory indexes
 * by sessionId, by pid, and by cwd, and notifies subscribers on changes.
 *
 * Use `subscribe()` from each provider instance; the registry refcounts
 * subscribers and only stops the underlying watcher when the last one
 * unsubscribes.
 *
 * Liveness: snapshots are filtered through `process.kill(pid, 0)` before
 * being returned. Stale pidfiles (process gone) are ignored — Claude
 * unlinks the file on graceful exit but a `kill -9` or panic can leave
 * one behind.
 */
export class ClaudePidfileRegistry {
  private dir: string
  private snapshots = new Map<number, ClaudePidfileSnapshot>()
  private bySessionId = new Map<string, number>() // sessionId → pid
  private listeners = new Set<Listener>()
  private watcher: fs.FSWatcher | null = null
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /**
   * Polling timer that re-scans the directory at a fixed interval. Acts as a
   * safety net for {@link fs.FSWatcher} missing events — on macOS, `fs.watch`
   * is implemented via FSEvents and is known to miss in-place rewrites of
   * small files (the exact pattern Claude Code uses for its pidfiles). When
   * the watcher drops a `busy → waiting` transition, the UI stays stuck on
   * the previous status (green "Running Tool" while the user is actually
   * staring at an approval prompt). The poll guarantees eventual consistency
   * within {@link POLL_MS}.
   */
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private started = false
  private startPromise: Promise<void> | null = null
  /**
   * True after the first `scanAll` has notified subscribers. Lets the
   * polling rescan stay silent in steady state while still seeding the
   * initial state even when the directory is empty.
   */
  private seededSubscribers = false
  /**
   * Increments on every `stop()`. In-flight async operations (initial scan,
   * debounced refreshFile, attachWatcher) capture the generation at entry
   * and bail if it changed mid-await — preventing a `subscribe → stop →
   * (start resumes) → leaked watcher` race when listeners churn rapidly.
   */
  private generation = 0

  private static readonly DEBOUNCE_MS = 200
  private static readonly POLL_MS = 2000
  private static readonly HEARTBEAT_FILE = '.fleetview-heartbeat'

  constructor(sessionsDir?: string) {
    this.dir = sessionsDir ?? path.join(os.homedir(), '.claude', 'sessions')
  }

  /** Subscribe to live updates. Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    if (!this.started) void this.ensureStarted()
    if (this.snapshots.size > 0) {
      try {
        listener(this.listSnapshots())
      } catch {
        // Listener errors must not break the registry.
      }
    }
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.stop()
    }
  }

  /**
   * Idempotent eager-start. Returns a promise that resolves once the initial
   * directory scan has populated the indexes — callers that need a fresh
   * snapshot before subscribing (e.g. provider `parseSession`/`closeSession`
   * paths invoked outside the watcher lifecycle) should `await` this.
   */
  ensureStarted(): Promise<void> {
    if (this.startPromise) return this.startPromise
    this.startPromise = this.startInternal()
    return this.startPromise
  }

  /** Backward-compatible alias for {@link ensureStarted}. */
  start(): Promise<void> {
    return this.ensureStarted()
  }

  /** All currently-live snapshots (PID verified alive at call time). */
  listSnapshots(): ClaudePidfileSnapshot[] {
    const out: ClaudePidfileSnapshot[] = []
    const dead: number[] = []
    for (const snap of this.snapshots.values()) {
      if (this.isLive(snap)) out.push(snap)
      else dead.push(snap.pid)
    }
    for (const pid of dead) this.removePid(pid)
    return out
  }

  /**
   * True when the snapshot's PID is alive AND, where determinable, the
   * OS-reported process start time matches the pidfile's `startedAt`.
   *
   * If start-time verification is unavailable (Windows, missing field,
   * `ps` failure) we fall back to "alive" only — preserving previous
   * behaviour rather than rejecting valid sessions on platforms where
   * we have no signal.
   */
  private isLive(snap: ClaudePidfileSnapshot): boolean {
    if (!isProcessAlive(snap.pid)) return false
    return verifyProcessIdentity(snap.pid, snap.startedAt) !== false
  }

  /** Look up a live snapshot by sessionId. Returns null if not active or stale. */
  getBySessionId(sessionId: string): ClaudePidfileSnapshot | null {
    const pid = this.bySessionId.get(sessionId)
    if (pid === undefined) return null
    const snap = this.snapshots.get(pid)
    if (!snap) return null
    if (!this.isLive(snap)) {
      this.removePid(snap.pid)
      return null
    }
    return snap
  }

  /** Look up the most recently updated live snapshot for a cwd. */
  getByCwd(cwd: string): ClaudePidfileSnapshot | null {
    const normalized = normalizePath(cwd)
    let best: ClaudePidfileSnapshot | null = null
    let bestUpdated = -1
    const dead: number[] = []
    for (const snap of this.snapshots.values()) {
      if (normalizePath(snap.cwd) !== normalized) continue
      if (!this.isLive(snap)) {
        dead.push(snap.pid)
        continue
      }
      const u = snap.updatedAt ?? 0
      if (u >= bestUpdated) {
        best = snap
        bestUpdated = u
      }
    }
    for (const pid of dead) this.removePid(pid)
    return best
  }

  /** Look up a live snapshot by PID. */
  getByPid(pid: number): ClaudePidfileSnapshot | null {
    const snap = this.snapshots.get(pid)
    if (!snap) return null
    if (!this.isLive(snap)) {
      this.removePid(pid)
      return null
    }
    return snap
  }

  /** True when `~/.claude/sessions/.fleetview-heartbeat` was touched within 5s. */
  isAnyAlive(): boolean {
    try {
      const { mtimeMs } = fs.statSync(path.join(this.dir, ClaudePidfileRegistry.HEARTBEAT_FILE))
      return Date.now() - mtimeMs < 5000
    } catch {
      return false
    }
  }

  /** Stop watching and clear all caches. */
  stop(): void {
    if (!this.started && !this.startPromise) return
    this.started = false
    this.startPromise = null
    this.generation++
    if (this.watcher) {
      try {
        this.watcher.close()
      } catch {
        // ignore
      }
      this.watcher = null
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    for (const t of this.debounceTimers.values()) clearTimeout(t)
    this.debounceTimers.clear()
    this.snapshots.clear()
    this.bySessionId.clear()
    this.seededSubscribers = false
  }

  // ── Internal ─────────────────────────────────────────────────────

  private async startInternal(): Promise<void> {
    if (this.started) return
    this.started = true
    const myGen = this.generation
    try {
      await fsp.mkdir(this.dir, { recursive: true })
    } catch {
      // ignore — directory may already exist or be on a read-only mount;
      // the watcher attempt below will surface a real failure if any.
    }
    if (myGen !== this.generation) return // stopped during await
    await this.scanAll(myGen)
    if (myGen !== this.generation) return
    this.attachWatcher()
    this.attachPoller()
  }

  /**
   * Periodic safety-net rescan. {@link fs.FSWatcher} drops events under
   * a number of platform-specific conditions (FSEvents coalescing on macOS,
   * non-recursive watches missing rapid sequential writes, network mounts,
   * etc.). When that happens, snapshots silently drift away from the
   * on-disk truth and downstream consumers (status dot colour, attention
   * inbox, sessionStore) act on stale state.
   *
   * The poll is deliberately cheap: read directory listing, refresh each
   * `.json` file, dedup unchanged snapshots via `shallowEqualSnapshot`.
   * In the steady state (no pidfile mutations) it produces zero listener
   * notifications. The first poll after a missed watcher event closes the
   * status-detection gap within {@link POLL_MS}.
   */
  private attachPoller(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = setInterval(() => {
      const myGen = this.generation
      void this.scanAll(myGen)
    }, ClaudePidfileRegistry.POLL_MS)
    // Allow the Node event loop to exit even when only the poller is left
    // (matters in CLI/test contexts; harmless in Electron where the app
    // process is held alive by other handles).
    if (typeof this.pollTimer.unref === 'function') this.pollTimer.unref()
  }

  private attachWatcher(): void {
    try {
      this.watcher = fs.watch(this.dir, { persistent: false }, (_event, filename) => {
        if (!filename) return
        const name = String(filename)
        if (!name.endsWith('.json')) return
        // Debounce per-file (chokidar awaitWriteFinish equivalent — handles
        // partial writes during pidfile mutation).
        const existing = this.debounceTimers.get(name)
        if (existing) clearTimeout(existing)
        const myGen = this.generation
        this.debounceTimers.set(
          name,
          setTimeout(() => {
            this.debounceTimers.delete(name)
            if (myGen !== this.generation) return
            void this.refreshFile(path.join(this.dir, name), { generation: myGen })
          }, ClaudePidfileRegistry.DEBOUNCE_MS)
        )
      })
      this.watcher.on('error', () => {
        // Watcher errors are non-fatal; full re-scans on next subscribe will
        // recover. Don't tear down the registry on a single error.
      })
    } catch {
      // fs.watch unsupported — fall back to scan-on-subscribe behavior.
    }
  }

  private async scanAll(generation: number): Promise<void> {
    let entries: string[]
    try {
      entries = await fsp.readdir(this.dir)
    } catch {
      return
    }
    if (generation !== this.generation) return
    const seenPids = new Set<number>()
    let changed = false
    for (const name of entries) {
      if (!name.endsWith('.json')) continue
      const pid = parseInt(name.slice(0, -5), 10)
      if (Number.isNaN(pid) || pid <= 0) continue
      seenPids.add(pid)
      const fileChanged = await this.refreshFile(path.join(this.dir, name), {
        silent: true,
        generation
      })
      if (fileChanged) changed = true
      if (generation !== this.generation) return
    }
    // Drop any cached snapshots whose file no longer exists.
    for (const pid of [...this.snapshots.keys()]) {
      if (!seenPids.has(pid)) {
        if (this.removePid(pid)) changed = true
      }
    }
    // Always notify on the first scan so subscribers receive an initial
    // seed even when the directory is empty. Subsequent polls only
    // notify if something actually changed — keeping steady-state polling
    // free of downstream parseSession/parse work.
    if (changed || !this.seededSubscribers) {
      this.seededSubscribers = true
      this.notify()
    }
  }

  /**
   * Read and apply a single pidfile's contents to the in-memory snapshot
   * map. Returns `true` if applying the file produced an observable change
   * (snapshot inserted, removed, or replaced with a non-shallow-equal
   * value); `false` otherwise. The boolean is what lets {@link scanAll}
   * stay quiet during steady-state polling.
   */
  private async refreshFile(
    fullPath: string,
    opts: { silent?: boolean; generation?: number } = {}
  ): Promise<boolean> {
    const gen = opts.generation ?? this.generation
    const base = path.basename(fullPath)
    const pid = parseInt(base.slice(0, -5), 10)
    if (Number.isNaN(pid) || pid <= 0) return false

    let raw: string
    try {
      raw = await fsp.readFile(fullPath, 'utf-8')
    } catch (err) {
      if (gen !== this.generation) return false
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        const removed = this.removePid(pid)
        if (removed && !opts.silent) this.notify()
        return removed
      }
      return false
    }
    if (gen !== this.generation) return false
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      // Truncated/partial write — debounced retry will pick it up.
      return false
    }
    const snap = sanitizeSnapshot(pid, parsed)
    if (!snap) return false
    if (!this.isLive(snap)) {
      const removed = this.removePid(pid)
      if (removed && !opts.silent) this.notify()
      return removed
    }

    const prev = this.snapshots.get(pid)
    const changed = !shallowEqualSnapshot(prev, snap)
    this.snapshots.set(pid, snap)

    // Maintain bySessionId. Same sessionId may migrate between PIDs across
    // resumes (rare); always keep the most recent mapping.
    if (prev?.sessionId && prev.sessionId !== snap.sessionId) {
      const cur = this.bySessionId.get(prev.sessionId)
      if (cur === pid) this.bySessionId.delete(prev.sessionId)
    }
    this.bySessionId.set(snap.sessionId, pid)

    if (!opts.silent && changed) this.notify()
    return changed
  }

  private removePid(pid: number): boolean {
    const prev = this.snapshots.get(pid)
    if (!prev) return false
    this.snapshots.delete(pid)
    if (prev.sessionId) {
      const cur = this.bySessionId.get(prev.sessionId)
      if (cur === pid) this.bySessionId.delete(prev.sessionId)
    }
    return true
  }

  private notify(): void {
    if (this.listeners.size === 0) return
    const snaps = this.listSnapshots()
    for (const l of this.listeners) {
      try {
        l(snaps)
      } catch {
        // Listener errors are isolated.
      }
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────

const FS_CASE_SENSITIVE = process.platform !== 'darwin' && process.platform !== 'win32'

function normalizePath(p: string): string {
  if (!p) return ''
  const unified = p.replace(/\\/g, '/').replace(/\/+$/, '')
  return FS_CASE_SENSITIVE ? unified : unified.toLowerCase()
}

function sanitizeSnapshot(filePid: number, raw: unknown): ClaudePidfileSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const pid = typeof r.pid === 'number' ? r.pid : filePid
  const sessionId = typeof r.sessionId === 'string' ? r.sessionId : ''
  const cwd = typeof r.cwd === 'string' ? r.cwd : ''
  if (!sessionId || !cwd || pid <= 0) return null

  const status =
    r.status === 'idle' || r.status === 'busy' || r.status === 'waiting'
      ? (r.status as 'idle' | 'busy' | 'waiting')
      : undefined
  const tempo =
    r.tempo === 'active' || r.tempo === 'idle' || r.tempo === 'blocked'
      ? (r.tempo as 'active' | 'idle' | 'blocked')
      : undefined

  return {
    pid,
    sessionId,
    cwd,
    status,
    waitingFor: typeof r.waitingFor === 'string' ? r.waitingFor : undefined,
    name: typeof r.name === 'string' ? r.name : undefined,
    detail: typeof r.detail === 'string' ? r.detail : undefined,
    state: typeof r.state === 'string' ? r.state : undefined,
    tempo,
    needs: typeof r.needs === 'string' ? r.needs : undefined,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : undefined,
    startedAt: typeof r.startedAt === 'number' ? r.startedAt : undefined,
    procStart:
      typeof r.procStart === 'string' || typeof r.procStart === 'number'
        ? (r.procStart as string | number)
        : undefined,
    version: typeof r.version === 'string' ? r.version : undefined,
    kind: typeof r.kind === 'string' ? r.kind : undefined,
    entrypoint: typeof r.entrypoint === 'string' ? r.entrypoint : undefined
  }
}

function shallowEqualSnapshot(
  a: ClaudePidfileSnapshot | undefined,
  b: ClaudePidfileSnapshot
): boolean {
  if (!a) return false
  return (
    a.pid === b.pid &&
    a.sessionId === b.sessionId &&
    a.cwd === b.cwd &&
    a.status === b.status &&
    a.waitingFor === b.waitingFor &&
    a.name === b.name &&
    a.detail === b.detail &&
    a.state === b.state &&
    a.tempo === b.tempo &&
    a.needs === b.needs &&
    a.updatedAt === b.updatedAt
  )
}

// ── Singleton ──────────────────────────────────────────────────────

let _singleton: ClaudePidfileRegistry | null = null

/** Shared registry instance; lazily constructed at first use. */
export function getClaudePidfileRegistry(): ClaudePidfileRegistry {
  if (!_singleton) _singleton = new ClaudePidfileRegistry()
  return _singleton
}

/** Test helper: replace the singleton instance (e.g. with a custom dir). */
export function __setClaudePidfileRegistryForTests(instance: ClaudePidfileRegistry | null): void {
  _singleton = instance
}
