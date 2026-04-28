import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'
import type {
  SessionProvider,
  DiscoveredSession,
  ResolvedSession,
  WatcherCallbacks,
  SessionPrompt,
  ParsedSessionData
} from './types'
import { killProcess, isProcessAlive, waitForProcessesToExit } from './processUtils'

// Filesystems on macOS and Windows are case-insensitive by default; Linux is case-sensitive.
const FS_CASE_SENSITIVE = process.platform !== 'darwin' && process.platform !== 'win32'

/** Normalize a path for equality comparison, honoring filesystem case sensitivity. */
export function normalizePathForCompare(p: string): string {
  const unified = p.replace(/\\/g, '/').replace(/\/+$/, '')
  return FS_CASE_SENSITIVE ? unified : unified.toLowerCase()
}

/**
 * One discovered session entry (a file or a directory, depending on the
 * provider's storage convention). `id` is the session identifier; `path` is
 * the absolute filesystem path to the entry; `mtimeMs` / `birthtimeMs` are
 * filesystem timestamps used for cutoff filtering.
 */
export interface SessionEntry {
  id: string
  path: string
  mtimeMs: number
  birthtimeMs: number
}

/**
 * Abstract base class for AI session providers.
 * Handles generic behavior: file watching, discovery, session resolution.
 *
 * Concrete providers override:
 *   • {@link getSessionDir} — root directory containing sessions.
 *   • {@link parseSession} — parse a single entry into a `DiscoveredSession`.
 *   • {@link parseEventsIncremental} / {@link extractPromptsFromEvents} — events parsing.
 *   • {@link getResumeCommand} / {@link getNewSessionCommand} — CLI invocation.
 *
 * Optional overrides for providers that don't follow Copilot's conventions
 * (one directory per session + `inuse.<PID>.lock` lock files):
 *   • {@link listSessionEntries} — custom discovery layout (e.g. files, nested).
 *   • {@link getEntryForSessionId} — `sessionId` → entry-path resolution.
 *   • {@link getActivePidForEntry} / {@link getActivePidsForEntry} — active-PID detection.
 *   • {@link findSessionEntryByPid} — fast PID → session lookup.
 *   • {@link removeSessionData} — disk cleanup on delete.
 *   • {@link sessionIdFromWatchPath} — relative-path → sessionId mapping.
 */
export abstract class BaseSessionProvider implements SessionProvider {
  abstract readonly id: string
  abstract readonly name: string
  abstract readonly command: string

  private watcher: fs.FSWatcher | null = null
  private staleTimer: ReturnType<typeof setInterval> | null = null
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private watchCallbacks: WatcherCallbacks | null = null
  private knownSessionIds = new Set<string>()
  private sessionCache = new Map<string, DiscoveredSession>()
  /** Cache of `sessionId → entry path`, populated by discovery and watcher.
   *  Used to avoid re-walking the session tree to resolve a sessionId to its
   *  filesystem entry on every operation. */
  private entryPathCache = new Map<string, string>()
  private watchGeneration = 0

  private static readonly DEBOUNCE_MS = 300
  private static readonly STALE_CHECK_MS = 5000
  private static readonly DEFAULT_MAX_AGE_DAYS = 7
  private static maxAgeDays: number = BaseSessionProvider.DEFAULT_MAX_AGE_DAYS

  /** Set the max age (in days) used by session discovery. Shared across all providers. */
  static setMaxAgeDays(days: number): void {
    if (Number.isFinite(days) && days >= 1) {
      BaseSessionProvider.maxAgeDays = Math.min(365, Math.floor(days))
    }
  }

  // ── Abstract methods — each provider implements these ────────────

  /** Base directory where sessions are stored (e.g. `~/.copilot/session-state/`). */
  protected abstract getSessionDir(): string

  /** Parse a single session entry into a `DiscoveredSession`. Return null to skip. */
  protected abstract parseSession(entry: SessionEntry): Promise<DiscoveredSession | null>

  /** Incrementally parse events to get current status/counts. */
  protected abstract parseEventsIncremental(entryPath: string): Promise<ParsedSessionData | null>

  /** Extract user prompts from a session's events. */
  protected abstract extractPromptsFromEvents(
    entryPath: string,
    limit: number
  ): Promise<SessionPrompt[]>

  abstract getResumeCommand(sessionId: string): string
  abstract getNewSessionCommand(): string

  // ── Default storage layout (Copilot convention) ──────────────────
  // Override these for providers that don't store one directory per session.

  /**
   * List all session entries under `getSessionDir()`. Default implementation
   * returns immediate sub-directories; override for nested or file-based
   * layouts (e.g. Claude Code's `<projects>/<slug>/<id>.jsonl`).
   */
  protected async listSessionEntries(): Promise<SessionEntry[]> {
    const sessionDir = this.getSessionDir()
    if (!(await this.dirExists(sessionDir))) return []

    const out: SessionEntry[] = []
    try {
      const entries = await fsp.readdir(sessionDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const fullPath = path.join(sessionDir, entry.name)
        try {
          const stat = await fsp.stat(fullPath)
          out.push({
            id: entry.name,
            path: fullPath,
            mtimeMs: stat.mtimeMs,
            birthtimeMs: stat.birthtimeMs
          })
        } catch {
          // Skip unreadable entries
        }
      }
    } catch {
      // ignore
    }
    return out
  }

  /**
   * Look up the on-disk entry for a session id. Default joins `sessionId` to
   * `getSessionDir()` (Copilot convention). Providers with a more complex
   * layout (e.g. nested directories) should override or rely on the entry
   * cache populated during discovery.
   */
  protected async getEntryForSessionId(sessionId: string): Promise<SessionEntry | null> {
    if (!this.validateSessionId(sessionId)) return null

    const cachedPath = this.entryPathCache.get(sessionId)
    if (cachedPath) {
      try {
        const stat = await fsp.stat(cachedPath)
        return {
          id: sessionId,
          path: cachedPath,
          mtimeMs: stat.mtimeMs,
          birthtimeMs: stat.birthtimeMs
        }
      } catch {
        this.entryPathCache.delete(sessionId)
      }
    }

    const fullPath = path.join(this.getSessionDir(), sessionId)
    const resolved = path.resolve(fullPath)
    if (!resolved.startsWith(path.resolve(this.getSessionDir()) + path.sep)) return null

    try {
      const stat = await fsp.stat(resolved)
      this.entryPathCache.set(sessionId, resolved)
      return {
        id: sessionId,
        path: resolved,
        mtimeMs: stat.mtimeMs,
        birthtimeMs: stat.birthtimeMs
      }
    } catch {
      // Fall back to a slow scan via listSessionEntries — supports providers
      // whose entries don't live directly under sessionDir.
      const entries = await this.listSessionEntries()
      for (const e of entries) {
        if (e.id === sessionId) {
          this.entryPathCache.set(sessionId, e.path)
          return e
        }
      }
      return null
    }
  }

  /**
   * Active-PID detection for a single entry. Default reads `inuse.<PID>.lock`
   * files inside an entry directory (Copilot convention). Override for
   * providers that publish liveness elsewhere (e.g. a pidfile registry).
   */
  protected async getActivePidForEntry(entry: SessionEntry): Promise<number | null> {
    const pids = await this.getActivePidsForEntry(entry)
    return pids[0] ?? null
  }

  /**
   * Returns all live PIDs that own a session. Default scans `inuse.<PID>.lock`
   * files inside the entry directory and verifies each PID is alive. Override
   * for providers that publish liveness elsewhere.
   */
  protected async getActivePidsForEntry(entry: SessionEntry): Promise<number[]> {
    try {
      const stat = await fsp.stat(entry.path)
      if (!stat.isDirectory()) return []
      const files = await fsp.readdir(entry.path)
      const pids: number[] = []
      for (const f of files) {
        const m = f.match(/^inuse\.(\d+)\.lock$/)
        if (!m) continue
        const pid = parseInt(m[1], 10)
        if (!isNaN(pid) && pid > 0 && isProcessAlive(pid)) pids.push(pid)
      }
      return pids
    } catch {
      return []
    }
  }

  /**
   * Fast lookup: which session does this PID belong to?
   * Default walks all entries looking for an `inuse.<PID>.lock` file.
   */
  protected async findSessionEntryByPid(pid: number): Promise<SessionEntry | null> {
    if (!isProcessAlive(pid)) return null
    const lockFileName = `inuse.${pid}.lock`
    const entries = await this.listSessionEntries()
    for (const entry of entries) {
      try {
        const stat = await fsp.stat(entry.path)
        if (!stat.isDirectory()) continue
        const files = await fsp.readdir(entry.path)
        if (files.includes(lockFileName)) return entry
      } catch {
        // Skip
      }
    }
    return null
  }

  /**
   * Remove a session's on-disk data. Default recursively deletes the entry
   * (Copilot's per-session directory). Override for providers that store
   * each session as a single file plus optional sidecars.
   */
  protected async removeSessionData(entry: SessionEntry): Promise<void> {
    if (fs.existsSync(entry.path)) {
      fs.rmSync(entry.path, { recursive: true, force: true })
    }
  }

  /**
   * Map a relative path (from the recursive watcher) to a sessionId.
   * Default returns the first path segment (Copilot convention).
   * Return null to ignore the change.
   */
  protected sessionIdFromWatchPath(relativePath: string): string | null {
    const parts = relativePath.replace(/\\/g, '/').split('/')
    return parts[0] || null
  }

  // ── Discovery ────────────────────────────────────────────────────

  async discoverSessions(): Promise<DiscoveredSession[]> {
    const cutoff = Date.now() - BaseSessionProvider.maxAgeDays * 86400000
    const entries = await this.listSessionEntries()
    const sessions: DiscoveredSession[] = []

    for (const entry of entries) {
      if (!this.validateSessionId(entry.id)) continue
      // Fast-path skip: if entry mtime is older than cutoff, actual session
      // activity is guaranteed to be older too.
      if (entry.mtimeMs < cutoff) continue

      try {
        const session = await this.parseSession(entry)
        if (!session) continue

        // Filter by the session's reported updatedAt (events activity),
        // which can be older than entry mtime (lock files touch the dir).
        if (new Date(session.updatedAt).getTime() < cutoff) continue

        this.entryPathCache.set(session.id, entry.path)
        sessions.push(session)
      } catch {
        // Skip unreadable sessions
      }
    }

    return sessions.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
  }

  // ── Session Lifecycle ────────────────────────────────────────────

  async closeSession(sessionId: string): Promise<boolean> {
    const entry = await this.getEntryForSessionId(sessionId)
    if (!entry) return false

    const pids = await this.getActivePidsForEntry(entry)
    if (pids.length === 0) return false

    let killed = false
    for (const pid of pids) {
      if (killProcess(pid)) killed = true
    }
    return killed
  }

  async deleteSession(sessionId: string): Promise<void> {
    const entry = await this.getEntryForSessionId(sessionId)
    if (!entry) throw new Error('Invalid session ID')

    // If the session is currently active, terminate the owning process(es)
    // BEFORE removing on-disk data. Otherwise the process keeps writing to
    // the (just-deleted) location, recreating it with stripped metadata.
    const pids = await this.getActivePidsForEntry(entry)
    if (pids.length > 0) {
      for (const pid of pids) killProcess(pid, 'SIGTERM')
      const exited = await waitForProcessesToExit(pids, 1500)
      if (!exited) {
        for (const pid of pids) {
          if (isProcessAlive(pid)) killProcess(pid, 'SIGKILL')
        }
        await waitForProcessesToExit(pids, 500)
      }
    }

    await this.removeSessionData(entry)

    // Clean up internal watcher state
    this.knownSessionIds.delete(sessionId)
    this.sessionCache.delete(sessionId)
    this.entryPathCache.delete(sessionId)
    this.onSessionDeleted(entry)
  }

  /** Hook for subclasses to clean up provider-specific caches on session delete. */
  protected onSessionDeleted(entry: SessionEntry): void {
    void entry
    // Override in subclasses if needed
  }

  // ── Session Resolution ───────────────────────────────────────────

  async resolveSessionByPid(pid: number): Promise<ResolvedSession | null> {
    const entry = await this.findSessionEntryByPid(pid)
    if (!entry) return null

    this.entryPathCache.set(entry.id, entry.path)
    let displayName = entry.id.slice(0, 12)
    try {
      const session = await this.parseSession(entry)
      if (session) displayName = session.displayName
    } catch {
      // Ignore parse errors and fall back to the truncated id
    }
    return { sessionId: entry.id, displayName }
  }

  async resolveSessionByCwd(cwd: string): Promise<ResolvedSession | null> {
    const normalizedCwd = normalizePathForCompare(cwd)
    const entries = await this.listSessionEntries()
    let bestMatch: { id: string; mtime: number; session: DiscoveredSession } | null = null

    for (const entry of entries) {
      try {
        const pid = await this.getActivePidForEntry(entry)
        if (pid === null) continue

        const session = await this.parseSession(entry)
        if (!session?.cwd) continue

        if (normalizePathForCompare(session.cwd) !== normalizedCwd) continue

        if (!bestMatch || entry.mtimeMs > bestMatch.mtime) {
          bestMatch = { id: entry.id, mtime: entry.mtimeMs, session }
          this.entryPathCache.set(entry.id, entry.path)
        }
      } catch {
        // Skip
      }
    }

    if (!bestMatch) return null
    return { sessionId: bestMatch.id, displayName: bestMatch.session.displayName }
  }

  // ── File Watching ────────────────────────────────────────────────

  async startWatching(callbacks: WatcherCallbacks): Promise<void> {
    this.stopWatching()
    this.watchCallbacks = callbacks
    const generation = ++this.watchGeneration

    const sessionDir = this.getSessionDir()
    if (!fs.existsSync(sessionDir)) {
      // Defer the watcher until the directory exists. Common case: fresh
      // installs where the AI tool hasn't created its data dir yet.
      return
    }

    // Populate known sessions before starting watcher to avoid spurious onAdded calls
    const sessions = await this.discoverSessions()

    // If stopWatching() or another startWatching() was called during discovery, abort
    if (this.watchGeneration !== generation) return

    this.knownSessionIds.clear()
    this.sessionCache.clear()
    for (const s of sessions) {
      this.knownSessionIds.add(s.id)
      this.sessionCache.set(s.id, s)
    }

    try {
      this.watcher = fs.watch(sessionDir, { recursive: true }, (_eventType, filename) => {
        if (!filename) return
        this.handleFileChange(filename)
      })

      this.watcher.on('error', () => {
        // Watcher error — will be recreated on next startWatching
      })
    } catch {
      // fs.watch not supported or dir doesn't exist
    }

    // Stale check timer — reset non-idle sessions to idle if no activity
    this.staleTimer = setInterval(() => {
      this.checkStale()
    }, BaseSessionProvider.STALE_CHECK_MS)
  }

  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    if (this.staleTimer) {
      clearInterval(this.staleTimer)
      this.staleTimer = null
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer)
    }
    this.debounceTimers.clear()
    this.watchCallbacks = null
    this.knownSessionIds.clear()
    this.sessionCache.clear()
    this.entryPathCache.clear()
  }

  /**
   * Hook used by subclasses (e.g. `ClaudeCodeProvider` integrating with the
   * pidfile registry) to push a session update through the same watcher
   * pipeline that the filesystem watcher uses. Centralizing the push avoids
   * duplicating the dedup / cache-update logic.
   */
  protected pushSessionUpdate(session: DiscoveredSession): void {
    if (!this.watchCallbacks) return
    if (this.knownSessionIds.has(session.id)) {
      const prev = this.sessionCache.get(session.id)
      if (!prev || this.hasSessionChanged(prev, session)) {
        this.sessionCache.set(session.id, session)
        this.watchCallbacks.onUpdated(session)
      }
    } else {
      this.knownSessionIds.add(session.id)
      this.sessionCache.set(session.id, session)
      this.watchCallbacks.onAdded(session)
    }
  }

  // ── Prompts ──────────────────────────────────────────────────────

  async getPrompts(sessionId: string, limit = 20): Promise<SessionPrompt[]> {
    const entry = await this.getEntryForSessionId(sessionId)
    if (!entry) return []
    return this.extractPromptsFromEvents(entry.path, limit)
  }

  // ── Protected Helpers ────────────────────────────────────────────

  protected async dirExists(dirPath: string): Promise<boolean> {
    try {
      await fsp.access(dirPath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Validate a session id is safe to use in shell commands and filesystem
   * paths. Session ids come from filesystem entry names (filenames or
   * directory names), so a tarball / malicious project that ships a
   * crafted `.claude/` or `.copilot/` directory could otherwise plant
   * shell metacharacters that fire when the user clicks Resume.
   *
   * Both Copilot and Claude session ids are UUID/hex-shaped — restrict
   * to a strict, shell-safe charset.
   */
  protected validateSessionId(sessionId: string): boolean {
    if (!sessionId) return false
    if (sessionId.length > 128) return false
    return /^[A-Za-z0-9_-]+$/.test(sessionId)
  }

  // ── Private Watcher Helpers ──────────────────────────────────────

  private handleFileChange(filename: string): void {
    const sessionId = this.sessionIdFromWatchPath(filename)
    if (!sessionId) return

    // Debounce per session
    const existing = this.debounceTimers.get(sessionId)
    if (existing) clearTimeout(existing)

    this.debounceTimers.set(
      sessionId,
      setTimeout(() => {
        this.debounceTimers.delete(sessionId)
        this.processSessionChange(sessionId)
      }, BaseSessionProvider.DEBOUNCE_MS)
    )
  }

  private async processSessionChange(sessionId: string): Promise<void> {
    if (!this.watchCallbacks) return

    const entry = await this.getEntryForSessionId(sessionId)

    if (!entry) {
      // Entry removed
      if (this.knownSessionIds.has(sessionId)) {
        this.knownSessionIds.delete(sessionId)
        this.sessionCache.delete(sessionId)
        this.entryPathCache.delete(sessionId)
        this.watchCallbacks?.onRemoved(sessionId, this.id)
      }
      return
    }

    try {
      const session = await this.parseSession(entry)
      if (!session || !this.watchCallbacks) return
      this.entryPathCache.set(session.id, entry.path)
      this.pushSessionUpdate(session)
    } catch {
      // Parse error — ignore
    }
  }

  private hasSessionChanged(prev: DiscoveredSession, next: DiscoveredSession): boolean {
    return (
      prev.detailedStatus !== next.detailedStatus ||
      prev.status !== next.status ||
      prev.messageCount !== next.messageCount ||
      prev.toolCallCount !== next.toolCallCount ||
      prev.displayName !== next.displayName
    )
  }

  private async checkStale(): Promise<void> {
    if (!this.watchCallbacks) return

    for (const [sessionId, session] of this.sessionCache.entries()) {
      if (!this.watchCallbacks) return
      if (session.detailedStatus && session.detailedStatus !== 'idle') {
        const entry = await this.getEntryForSessionId(sessionId)
        if (!entry) continue
        try {
          const age = Date.now() - entry.mtimeMs
          if (age > 30000) {
            const updated = await this.parseSession(entry)
            if (updated && this.hasSessionChanged(session, updated)) {
              this.sessionCache.set(sessionId, updated)
              this.watchCallbacks?.onUpdated(updated)
            }
          }
        } catch {
          // ignore
        }
      }
    }
  }
}

// Re-export so existing imports `import { ... } from './baseProvider'`
// keep working if any non-provider code referenced the helpers.
export { killProcess, isProcessAlive, waitForProcessesToExit }
