import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { createRequire } from 'module'

type DatabaseSyncCtor = typeof import('node:sqlite').DatabaseSync
type StatementSync = import('node:sqlite').StatementSync

const requireFromHere = createRequire(import.meta.url)

let DatabaseSyncCached: DatabaseSyncCtor | null | undefined

/**
 * Lazily load `node:sqlite`. Returns `null` on Node versions that don't ship
 * it (or where it's behind a flag that wasn't passed). The runtime target
 * (Electron 42, Node 24) always has it; tests under older Node bail out.
 */
function loadDatabaseSync(): DatabaseSyncCtor | null {
  if (DatabaseSyncCached !== undefined) return DatabaseSyncCached
  try {
    const mod = requireFromHere('node:sqlite') as typeof import('node:sqlite')
    DatabaseSyncCached = mod.DatabaseSync
  } catch {
    DatabaseSyncCached = null
  }
  return DatabaseSyncCached
}

export function isChronicleAvailable(): boolean {
  return loadDatabaseSync() !== null
}

/**
 * Strictly read-only reader over Copilot CLI's local "Chronicle" SQLite
 * database (`~/.copilot/session-store.db`). The CLI itself owns all writes;
 * DPlex only reads — guarded by `readOnly: true` and `PRAGMA query_only = 1`.
 *
 * Uses Node 22+'s built-in `node:sqlite` (no native dependency, no rebuild
 * step). Electron 42 ships Node 24, where `node:sqlite` is available without
 * any opt-in flag.
 *
 * If the database doesn't exist (older Copilot CLI versions, fresh installs)
 * `tryOpen()` returns false and the provider falls back to a directory scan.
 *
 * Copilot CLI uses WAL mode, so reads don't block its writes. We never issue
 * write-side PRAGMAs (`wal_checkpoint`, `journal_mode`, `synchronous`, ...),
 * leaving WAL management entirely to the CLI process.
 */
export class CopilotChronicle {
  private db: InstanceType<DatabaseSyncCtor> | null = null
  /** Cached column sets for defensive querying against schema drift. */
  private hasSessionsCols: Set<string> = new Set()
  private hasTurnsCols: Set<string> = new Set()
  /** Prepared statements — recreated on each open. */
  private stmts: {
    listSessions?: StatementSync
    countTurns?: StatementSync
    firstUserMsg?: StatementSync
    byId?: StatementSync
  } = {}
  private watcher: fs.FSWatcher | null = null
  private watcherListeners = new Set<() => void>()
  private watcherDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private watcherRetryTimer: ReturnType<typeof setTimeout> | null = null
  private watcherRetryDelayMs = 0
  private static readonly WATCH_DEBOUNCE_MS = process.platform === 'win32' ? 500 : 250
  private static readonly WATCH_RETRY_MIN_MS = 1000
  private static readonly WATCH_RETRY_MAX_MS = 30_000

  constructor(private readonly dbPath: string = defaultDbPath()) {}

  /**
   * Attempt to open the DB in strict read-only mode. Returns `true` on
   * success, `false` if the file is missing or unreadable. Safe to call
   * repeatedly — a no-op if already open.
   */
  tryOpen(): boolean {
    if (this.db) return true
    if (!fs.existsSync(this.dbPath)) return false
    const Ctor = loadDatabaseSync()
    if (!Ctor) return false

    try {
      const db = new Ctor(this.dbPath, {
        readOnly: true,
        // Tolerate transient locks from the CLI's own writers. WAL readers
        // normally don't block, but this guards against edge cases.
        timeout: 200
      })
      // Defence in depth: even buggy/future code in this class cannot mutate
      // the DB. Combined with `readOnly: true`, this blocks every write path.
      db.exec('PRAGMA query_only = 1')

      this.db = db
      this.cacheSchema()
      this.prepareStatements()
      if (!this.stmts.listSessions) {
        // Schema drift — refuse to use the chronicle.
        this.safeClose()
        return false
      }
      return true
    } catch {
      this.safeClose()
      return false
    }
  }

  isOpen(): boolean {
    return this.db !== null
  }

  close(): void {
    this.stopWatch()
    this.safeClose()
  }

  private safeClose(): void {
    if (this.db) {
      try {
        this.db.close()
      } catch {
        // ignore — best-effort
      }
      this.db = null
    }
    this.stmts = {}
    this.hasSessionsCols = new Set()
    this.hasTurnsCols = new Set()
  }

  private cacheSchema(): void {
    if (!this.db) return
    try {
      const sCols = this.db.prepare(`PRAGMA table_info(sessions)`).all() as Array<{
        name: string
      }>
      this.hasSessionsCols = new Set(sCols.map((r) => r.name))
      const tCols = this.db.prepare(`PRAGMA table_info(turns)`).all() as Array<{
        name: string
      }>
      this.hasTurnsCols = new Set(tCols.map((r) => r.name))
    } catch {
      this.hasSessionsCols = new Set()
      this.hasTurnsCols = new Set()
    }
  }

  private prepareStatements(): void {
    if (!this.db) return
    // Defensive column list — every column we read is required to exist.
    const required = ['id', 'cwd', 'repository', 'branch', 'summary', 'created_at', 'updated_at']
    for (const c of required) {
      if (!this.hasSessionsCols.has(c)) return
    }
    try {
      this.stmts.listSessions = this.db.prepare(
        `SELECT id, cwd, repository, branch, summary, created_at, updated_at
         FROM sessions
         WHERE updated_at >= ?
         ORDER BY updated_at DESC`
      )
      this.stmts.byId = this.db.prepare(
        `SELECT id, cwd, repository, branch, summary, created_at, updated_at
         FROM sessions WHERE id = ?`
      )
      if (this.hasTurnsCols.has('session_id')) {
        this.stmts.countTurns = this.db.prepare(
          `SELECT session_id AS sid, COUNT(*) AS n FROM turns GROUP BY session_id`
        )
        if (this.hasTurnsCols.has('user_message') && this.hasTurnsCols.has('turn_index')) {
          this.stmts.firstUserMsg = this.db.prepare(
            `SELECT user_message FROM turns
             WHERE session_id = ?
               AND user_message IS NOT NULL
               AND TRIM(user_message) != ''
             ORDER BY turn_index ASC LIMIT 1`
          )
        }
      }
    } catch {
      this.stmts = {}
    }
  }

  // ── Public read API ──────────────────────────────────────────────

  /**
   * Return all sessions updated at or after `cutoffMs`, most-recent first.
   *
   * The local session store (`~/.copilot/session-store.db`) only ever holds
   * local CLI sessions — each row's `cwd` is a path on this machine — so every
   * row is a candidate for discovery regardless of which git host the working
   * directory belongs to.
   */
  listSessions(opts: { cutoffMs: number }): ChronicleRow[] {
    if (!this.stmts.listSessions) return []
    try {
      const cutoffIso = new Date(opts.cutoffMs).toISOString()
      const rows = this.stmts.listSessions.all(cutoffIso) as unknown as RawSessionRow[]
      return rows.map(toChronicleRow).filter((r): r is ChronicleRow => r !== null)
    } catch {
      return []
    }
  }

  /**
   * Returns `Map<sessionId, messageCount>`. When `sessionIds` is provided,
   * counts turns only for those sessions (chunked `WHERE session_id IN (...)`)
   * — so callers like the dashboard pay a cost bounded by their window rather
   * than scanning the entire `turns` table. With no argument, returns counts
   * for every session (used by the live discovery path).
   */
  getMessageCounts(sessionIds?: readonly string[]): Map<string, number> {
    const map = new Map<string, number>()

    if (sessionIds) {
      if (sessionIds.length === 0) return map
      if (!this.db || !this.hasTurnsCols.has('session_id')) return map
      const CHUNK = 500
      try {
        for (let i = 0; i < sessionIds.length; i += CHUNK) {
          const chunk = sessionIds.slice(i, i + CHUNK)
          const placeholders = chunk.map(() => '?').join(',')
          const stmt = this.db.prepare(
            `SELECT session_id AS sid, COUNT(*) AS n FROM turns
             WHERE session_id IN (${placeholders}) GROUP BY session_id`
          )
          const rows = stmt.all(...chunk) as unknown as Array<{ sid: string; n: number }>
          for (const r of rows) {
            if (typeof r.sid === 'string' && typeof r.n === 'number') map.set(r.sid, r.n)
          }
        }
      } catch {
        // ignore
      }
      return map
    }

    if (!this.stmts.countTurns) return map
    try {
      const rows = this.stmts.countTurns.all() as unknown as Array<{
        sid: string
        n: number
      }>
      for (const r of rows) {
        if (typeof r.sid === 'string' && typeof r.n === 'number') {
          map.set(r.sid, r.n)
        }
      }
    } catch {
      // ignore
    }
    return map
  }

  getById(id: string): ChronicleRow | null {
    if (!this.stmts.byId) return null
    try {
      const row = this.stmts.byId.get(id) as unknown as RawSessionRow | undefined
      return row ? toChronicleRow(row) : null
    } catch {
      return null
    }
  }

  getFirstUserMessage(id: string): string | null {
    if (!this.stmts.firstUserMsg) return null
    try {
      const row = this.stmts.firstUserMsg.get(id) as unknown as
        | { user_message?: string }
        | undefined
      const msg = row?.user_message?.trim()
      return msg ? msg : null
    } catch {
      return null
    }
  }

  // ── Change notification ──────────────────────────────────────────

  /**
   * Watch the DB and its WAL/SHM sidecars for changes. The CLI uses WAL mode,
   * so any committed session update touches `session-store.db-wal`; the main
   * DB file only changes on checkpoint. The callback is debounced.
   *
   * Returns an unsubscribe function.
   */
  onChange(listener: () => void): () => void {
    this.watcherListeners.add(listener)
    this.ensureWatcher()
    return () => {
      this.watcherListeners.delete(listener)
      if (this.watcherListeners.size === 0) this.stopWatch()
    }
  }

  private ensureWatcher(): void {
    if (this.watcher) return
    const dir = path.dirname(this.dbPath)
    const base = path.basename(this.dbPath)
    if (!fs.existsSync(dir)) {
      // Directory doesn't exist yet — retry later in case Copilot CLI creates
      // it. Without this, a fresh install never starts watching.
      this.scheduleWatcherRetry()
      return
    }
    try {
      // Watch the directory (single fd) and filter for the DB / WAL / SHM in
      // the callback. Cross-platform reliable: `fs.watch` on a missing file
      // throws on macOS; the directory always exists if Copilot is installed.
      this.watcher = fs.watch(dir, (_event, filename) => {
        if (!filename) return
        if (filename !== base && !filename.startsWith(base + '-')) return
        this.scheduleNotify()
      })
      this.watcher.on('error', () => {
        this.handleWatcherFailure()
      })
      // Successful (re)attach — reset backoff.
      this.watcherRetryDelayMs = 0
    } catch {
      // fs.watch failed (transient EMFILE, permissions, racy unmount, ...).
      // Schedule a recovery attempt so subscribers keep receiving updates.
      this.handleWatcherFailure()
    }
  }

  private handleWatcherFailure(): void {
    this.teardownWatcher()
    if (this.watcherListeners.size > 0) this.scheduleWatcherRetry()
  }

  private scheduleWatcherRetry(): void {
    if (this.watcherRetryTimer) return
    const base = CopilotChronicle.WATCH_RETRY_MIN_MS
    const max = CopilotChronicle.WATCH_RETRY_MAX_MS
    this.watcherRetryDelayMs = this.watcherRetryDelayMs
      ? Math.min(max, this.watcherRetryDelayMs * 2)
      : base
    this.watcherRetryTimer = setTimeout(() => {
      this.watcherRetryTimer = null
      if (this.watcherListeners.size === 0) return
      this.ensureWatcher()
    }, this.watcherRetryDelayMs)
  }

  private scheduleNotify(): void {
    if (this.watcherDebounceTimer) clearTimeout(this.watcherDebounceTimer)
    this.watcherDebounceTimer = setTimeout(() => {
      this.watcherDebounceTimer = null
      // Snapshot to a local copy: a listener may unsubscribe during iteration.
      const listeners = Array.from(this.watcherListeners)
      for (const l of listeners) {
        try {
          l()
        } catch {
          // Listener errors must not break the registry.
        }
      }
    }, CopilotChronicle.WATCH_DEBOUNCE_MS)
  }

  /** Tear down the FSWatcher instance only — leaves listeners & timers alone. */
  private teardownWatcher(): void {
    if (this.watcher) {
      try {
        this.watcher.close()
      } catch {
        // ignore
      }
      this.watcher = null
    }
  }

  private stopWatch(): void {
    this.teardownWatcher()
    if (this.watcherDebounceTimer) {
      clearTimeout(this.watcherDebounceTimer)
      this.watcherDebounceTimer = null
    }
    if (this.watcherRetryTimer) {
      clearTimeout(this.watcherRetryTimer)
      this.watcherRetryTimer = null
    }
    this.watcherRetryDelayMs = 0
  }
}

// ── Types & helpers ────────────────────────────────────────────────

export interface ChronicleRow {
  id: string
  cwd: string | null
  repository: string | null
  branch: string | null
  summary: string | null
  createdAtMs: number
  updatedAtMs: number
}

interface RawSessionRow {
  id: string
  cwd: string | null
  repository: string | null
  branch: string | null
  summary: string | null
  created_at: string
  updated_at: string
}

function toChronicleRow(r: RawSessionRow): ChronicleRow | null {
  if (typeof r.id !== 'string' || !r.id) return null
  const createdAtMs = parseIsoMs(r.created_at)
  const updatedAtMs = parseIsoMs(r.updated_at)
  if (createdAtMs === null || updatedAtMs === null) return null
  return {
    id: r.id,
    cwd: nullish(r.cwd),
    repository: nullish(r.repository),
    branch: nullish(r.branch),
    summary: nullish(r.summary),
    createdAtMs,
    updatedAtMs
  }
}

function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

function nullish<T>(v: T | null | undefined): T | null {
  return v === undefined ? null : v
}

function defaultDbPath(): string {
  return path.join(os.homedir(), '.copilot', 'session-store.db')
}
