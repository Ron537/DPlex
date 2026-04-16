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

/**
 * Abstract base class for AI session providers.
 * Handles generic behavior: file watching, discovery, session resolution, active detection.
 * Concrete providers override format-specific parsing methods.
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

  /** Base directory where sessions are stored (e.g., ~/.copilot/session-state/) */
  protected abstract getSessionDir(): string

  /** Parse a single session directory into a DiscoveredSession. Return null to skip. */
  protected abstract parseSessionDir(
    dirPath: string,
    dirName: string
  ): Promise<DiscoveredSession | null>

  /** Incrementally parse events to get current status/counts. */
  protected abstract parseEventsIncremental(
    filePath: string
  ): Promise<ParsedSessionData | null>

  /** Extract user prompts from events file. */
  protected abstract extractPromptsFromEvents(
    filePath: string,
    limit: number
  ): Promise<SessionPrompt[]>

  abstract getResumeCommand(sessionId: string): string
  abstract getNewSessionCommand(): string

  // ── Discovery ────────────────────────────────────────────────────

  async discoverSessions(): Promise<DiscoveredSession[]> {
    const sessionDir = this.getSessionDir()
    if (!(await this.dirExists(sessionDir))) return []

    try {
      const entries = await fsp.readdir(sessionDir, { withFileTypes: true })
      const sessions: DiscoveredSession[] = []
      const cutoff = Date.now() - BaseSessionProvider.maxAgeDays * 86400000

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const fullPath = path.join(sessionDir, entry.name)

        try {
          const stat = await fsp.stat(fullPath)
          // Fast-path skip: if dir mtime is older than cutoff, actual session
          // activity is guaranteed to be older too.
          if (stat.mtimeMs < cutoff) continue

          const session = await this.parseSessionDir(fullPath, entry.name)
          if (!session) continue

          // Filter by the session's reported updatedAt (events activity),
          // which can be older than dir mtime (lock files touch the dir).
          if (new Date(session.updatedAt).getTime() < cutoff) continue

          sessions.push(session)
        } catch {
          // Skip unreadable sessions
        }
      }

      return sessions.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
    } catch {
      return []
    }
  }

  // ── Session Lifecycle ────────────────────────────────────────────

  async closeSession(sessionId: string): Promise<boolean> {
    const fullPath = this.resolveAndValidateSessionPath(sessionId)
    if (!fullPath) return false

    try {
      const files = await fsp.readdir(fullPath)
      const lockFiles = files.filter((f) => /^inuse\.\d+\.lock$/.test(f))
      if (lockFiles.length === 0) return false

      let killed = false
      for (const lockFile of lockFiles) {
        const match = lockFile.match(/^inuse\.(\d+)\.lock$/)
        if (!match) continue
        const pid = parseInt(match[1], 10)
        if (isNaN(pid) || pid <= 0) continue
        try {
          process.kill(pid, 'SIGTERM')
          killed = true
        } catch {
          // Process already gone
        }
      }
      return killed
    } catch {
      return false
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const fullPath = this.resolveAndValidateSessionPath(sessionId)
    if (!fullPath) throw new Error('Invalid session ID')
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true, force: true })
    }
    // Clean up internal watcher state
    this.knownSessionIds.delete(sessionId)
    this.sessionCache.delete(sessionId)
    this.onSessionDeleted(fullPath)
  }

  /** Hook for subclasses to clean up provider-specific caches on session delete. */
  protected onSessionDeleted(_sessionDir: string): void {
    // Override in subclasses if needed
  }

  // ── Session Resolution ───────────────────────────────────────────

  async resolveSessionByPid(pid: number): Promise<ResolvedSession | null> {
    const sessionDir = this.getSessionDir()
    const lockFileName = `inuse.${pid}.lock`

    try {
      process.kill(pid, 0)
    } catch {
      return null
    }

    try {
      const entries = await fsp.readdir(sessionDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const fullPath = path.join(sessionDir, entry.name)
        try {
          const files = await fsp.readdir(fullPath)
          if (files.includes(lockFileName)) {
            const session = await this.parseSessionDir(fullPath, entry.name)
            return {
              sessionId: entry.name,
              displayName: session?.displayName ?? entry.name.slice(0, 12)
            }
          }
        } catch {
          // Skip unreadable dirs
        }
      }
    } catch {
      // Session directory doesn't exist
    }

    return null
  }

  async resolveSessionByCwd(cwd: string): Promise<ResolvedSession | null> {
    const sessionDir = this.getSessionDir()
    const normalizedCwd = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
    if (!(await this.dirExists(sessionDir))) return null

    let bestMatch: { id: string; mtime: number; session: DiscoveredSession } | null = null

    try {
      const entries = await fsp.readdir(sessionDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const fullPath = path.join(sessionDir, entry.name)

        try {
          const pid = await this.getActivePid(fullPath)
          if (pid === null) continue

          const session = await this.parseSessionDir(fullPath, entry.name)
          if (!session?.cwd) continue

          const sessionCwd = session.cwd.replace(/\\/g, '/').replace(/\/+$/, '')
          if (sessionCwd !== normalizedCwd) continue

          const stat = await fsp.stat(fullPath)
          if (!bestMatch || stat.mtimeMs > bestMatch.mtime) {
            bestMatch = { id: entry.name, mtime: stat.mtimeMs, session }
          }
        } catch {
          // Skip
        }
      }
    } catch {
      // ignore
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
    if (!fs.existsSync(sessionDir)) return

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
  }

  // ── Prompts ──────────────────────────────────────────────────────

  async getPrompts(sessionId: string, limit = 20): Promise<SessionPrompt[]> {
    const fullPath = this.resolveAndValidateSessionPath(sessionId)
    if (!fullPath) return []
    return this.extractPromptsFromEvents(fullPath, limit)
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

  protected async getActivePid(sessionDir: string): Promise<number | null> {
    try {
      const files = await fsp.readdir(sessionDir)
      const lockFile = files.find((f) => f.startsWith('inuse.') && f.endsWith('.lock'))
      if (!lockFile) return null

      const pidStr = lockFile.replace('inuse.', '').replace('.lock', '')
      const pid = parseInt(pidStr, 10)
      if (isNaN(pid)) return null

      try {
        process.kill(pid, 0)
        return pid
      } catch {
        return null
      }
    } catch {
      return null
    }
  }

  protected validateSessionId(sessionId: string): boolean {
    if (
      !sessionId ||
      sessionId.includes('/') ||
      sessionId.includes('\\') ||
      sessionId.includes('..')
    ) {
      return false
    }
    return true
  }

  protected resolveAndValidateSessionPath(sessionId: string): string | null {
    if (!this.validateSessionId(sessionId)) return null
    const targetPath = path.join(this.getSessionDir(), sessionId)
    const resolved = path.resolve(targetPath)
    if (!resolved.startsWith(path.resolve(this.getSessionDir()) + path.sep)) return null
    return resolved
  }

  // ── Private Watcher Helpers ──────────────────────────────────────

  private handleFileChange(filename: string): void {
    // filename is relative to session dir, e.g. "uuid/events.jsonl" or "uuid"
    const parts = filename.replace(/\\/g, '/').split('/')
    if (parts.length === 0) return

    const sessionId = parts[0]

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

    const fullPath = path.join(this.getSessionDir(), sessionId)

    try {
      await fsp.access(fullPath)
    } catch {
      // Directory removed
      if (this.knownSessionIds.has(sessionId)) {
        this.knownSessionIds.delete(sessionId)
        this.sessionCache.delete(sessionId)
        this.watchCallbacks?.onRemoved(sessionId, this.id)
      }
      return
    }

    try {
      const session = await this.parseSessionDir(fullPath, sessionId)
      if (!session || !this.watchCallbacks) return

      if (this.knownSessionIds.has(sessionId)) {
        const prev = this.sessionCache.get(sessionId)
        if (prev && this.hasSessionChanged(prev, session)) {
          this.sessionCache.set(sessionId, session)
          this.watchCallbacks?.onUpdated(session)
        }
      } else {
        this.knownSessionIds.add(sessionId)
        this.sessionCache.set(sessionId, session)
        this.watchCallbacks?.onAdded(session)
      }
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
        const fullPath = path.join(this.getSessionDir(), sessionId)
        try {
          const stat = await fsp.stat(fullPath)
          const age = Date.now() - stat.mtimeMs
          if (age > 30000) {
            const updated = await this.parseSessionDir(fullPath, sessionId)
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
