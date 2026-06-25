import * as fsp from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import type {
  DiscoveredSession,
  ParsedSessionData,
  ResolvedSession,
  SessionPrompt,
  WatcherCallbacks
} from './types'
import type { HistoricalSession } from '../dashboard/types'
import { BaseSessionProvider, normalizePathForCompare, type SessionEntry } from './baseProvider'
import {
  parseCopilotEvents,
  extractCopilotPrompts,
  clearCopilotParseCache
} from './copilotEventsParser'
import { CopilotChronicle, type ChronicleRow } from './copilotChronicle'
import { isProcessAlive } from './processUtils'

export class CopilotProvider extends BaseSessionProvider {
  readonly id = 'copilot-cli'
  readonly name = 'Copilot CLI'
  readonly command = 'copilot'
  readonly icon = 'copilot'

  private readonly chronicle = new CopilotChronicle()
  private chronicleUnsub: (() => void) | null = null
  private chronicleRefreshing = false
  private chronicleRefreshQueued = false
  private chronicleStopped = false
  /**
   * Session ids the user explicitly deleted in this process. The Chronicle is
   * read-only from DPlex's side, so the row may linger after the on-disk
   * `session-state/<id>` directory is gone. Without this filter, the next
   * Chronicle refresh would resurrect the entry as an idle session.
   *
   * Pruned each refresh: an id whose on-disk dir is gone can never resurface
   * (we also gate Chronicle rows on dir existence), so retaining it serves
   * no purpose.
   */
  private readonly deletedIds = new Set<string>()

  // ── Abstract method implementations ──────────────────────────────

  protected getSessionDir(): string {
    return path.join(os.homedir(), '.copilot', 'session-state')
  }

  protected async parseSession(entry: SessionEntry): Promise<DiscoveredSession | null> {
    const { id: dirName, path: dirPath } = entry
    try {
      const workspace = await this.parseWorkspaceYaml(dirPath)
      const displayName = await this.getDisplayName(dirPath, dirName)
      const isActive = (await this.getActivePidForEntry(entry)) !== null

      // Parse events for enriched data
      const eventsPath = path.join(dirPath, 'events.jsonl')
      let parsed: ParsedSessionData | null = null
      let eventsMtimeMs = entry.mtimeMs
      try {
        const eventsStat = await fsp.stat(eventsPath)
        eventsMtimeMs = eventsStat.mtimeMs
        parsed = await this.parseEventsIncremental(eventsPath)
      } catch {
        // events.jsonl may not exist yet
      }

      // Use events.jsonl mtime for updatedAt (more accurate than dir mtime)
      const updatedAt = new Date(eventsMtimeMs).toISOString()

      return {
        id: dirName,
        displayName,
        status: isActive ? 'active' : 'idle',
        aiTool: this.id,
        createdAt: new Date(entry.birthtimeMs).toISOString(),
        updatedAt,
        cwd: workspace.cwd,
        summary: displayName,
        branch: workspace.branch,
        detailedStatus: parsed?.detailedStatus ?? 'idle',
        messageCount: parsed?.messageCount ?? 0,
        toolCallCount: parsed?.toolCallCount ?? 0,
        lastActivityTime: parsed?.lastActivityTime ?? eventsMtimeMs
      }
    } catch {
      return null
    }
  }

  protected parseEventsIncremental(filePath: string): Promise<ParsedSessionData> {
    return parseCopilotEvents(filePath)
  }

  protected extractPromptsFromEvents(sessionDir: string, limit: number): Promise<SessionPrompt[]> {
    return extractCopilotPrompts(sessionDir, limit)
  }

  getResumeCommand(sessionId: string): string {
    return `copilot --resume=${sessionId}`
  }

  getNewSessionCommand(): string {
    return 'copilot'
  }

  protected onSessionDeleted(entry: SessionEntry): void {
    clearCopilotParseCache(path.join(entry.path, 'events.jsonl'))
    // Remember the id so a subsequent Chronicle refresh doesn't resurrect it
    // as an idle session (the CLI's DB still has the row).
    this.deletedIds.add(entry.id)
  }

  // ── Chronicle-backed discovery ───────────────────────────────────

  /**
   * Override discovery to query Copilot's SQLite Chronicle (read-only) for
   * the session list and enrich only the *active* sessions with live event
   * data. On installs without the Chronicle (older CLI, fresh install,
   * locked DB), falls back to the base directory-scan implementation.
   */
  async discoverSessions(): Promise<DiscoveredSession[]> {
    if (!this.chronicle.tryOpen()) {
      return super.discoverSessions()
    }

    const cutoffMs = Date.now() - BaseSessionProvider.getMaxAgeDays() * 86_400_000
    const allRows = this.chronicle.listSessions({ cutoffMs })

    // One readdir of the session dir tells us which Chronicle rows still have
    // an on-disk entry. This (a) prevents resurrecting sessions deleted in a
    // previous run (Chronicle row outlived the dir) and (b) feeds the bounded
    // active-scan below.
    const existingDirs = await this.listExistingSessionDirs()
    // Prune the deletedIds set: ids whose dir is gone can never resurface.
    if (this.deletedIds.size > 0) {
      for (const id of this.deletedIds) {
        if (!existingDirs.has(id)) this.deletedIds.delete(id)
      }
    }

    // Drop ids that don't match the shell-safe charset (defence against a
    // malicious / corrupted DB entry; ids flow into `copilot --resume=<id>`),
    // user-deleted ids the Chronicle still remembers, and rows whose
    // on-disk dir has been removed since.
    const rows = allRows.filter(
      (r) => this.validateSessionId(r.id) && !this.deletedIds.has(r.id) && existingDirs.has(r.id)
    )
    if (rows.length === 0) {
      // DB exists but empty (very fresh install). Fall back so the user
      // sees any directories Copilot has written but not committed yet.
      return super.discoverSessions()
    }

    const messageCounts = this.chronicle.getMessageCounts()
    // Only stat candidate dirs (rows the Chronicle knows about). On a
    // 1500-session install this drops the scan from O(total) to O(recent).
    const candidateIds = new Set(rows.map((r) => r.id))
    const activeByEntry = await this.scanActiveSessions(candidateIds)

    const sessions: DiscoveredSession[] = []
    const seen = new Set<string>()
    for (const row of rows) {
      const isActive = activeByEntry.has(row.id)
      const base = await this.rowToDiscoveredSession(row, isActive, messageCounts.get(row.id) ?? 0)
      seen.add(row.id)
      // For active sessions, hydrate live status / counts from events.jsonl.
      if (isActive) {
        const enriched = await this.enrichActiveSession(base)
        sessions.push(enriched)
        this.entryPathCache.set(row.id, path.join(this.getSessionDir(), row.id))
      } else {
        sessions.push(base)
      }
    }

    // Some active sessions may not be in the Chronicle yet (very fresh
    // session whose row Copilot hasn't committed to SQLite) or may have an
    // `updated_at` older than our cutoff. Sweep the full session dir for
    // those so the user still sees every live session.
    const freshActive = await this.scanActiveSessions()
    const sessionDir = this.getSessionDir()
    for (const id of freshActive) {
      if (seen.has(id) || this.deletedIds.has(id)) continue
      try {
        const entryPath = path.join(sessionDir, id)
        const stat = await fsp.stat(entryPath)
        const parsed = await this.parseSession({
          id,
          path: entryPath,
          mtimeMs: stat.mtimeMs,
          birthtimeMs: stat.birthtimeMs
        })
        if (parsed) {
          sessions.push(parsed)
          this.entryPathCache.set(id, entryPath)
        }
      } catch {
        // Session vanished mid-scan — skip silently.
      }
    }

    return sessions.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
  }

  /**
   * Chronicle-backed history for the dashboard. The Chronicle indexes every
   * session with repository/branch/timestamps and exact turn (message) counts,
   * so this is both rich and cheap (two prepared queries, no event parsing).
   * Falls back to the filesystem-only base implementation when the Chronicle
   * isn't available (older CLI / fresh install / locked DB).
   */
  async getSessionHistory(cutoffMs: number): Promise<HistoricalSession[]> {
    if (!this.chronicle.tryOpen()) {
      return super.getSessionHistory(cutoffMs)
    }
    const rows = this.chronicle.listSessions({ cutoffMs })
    // Gate on on-disk existence — same guard discoverSessions uses — so rows
    // for sessions deleted from disk in a previous run (the Chronicle is
    // read-only to us and outlives the dir) don't resurrect in dashboard
    // totals after a restart, when the in-memory deletedIds set is empty.
    const existingDirs = await this.listExistingSessionDirs()
    const kept = rows.filter(
      (r) => this.validateSessionId(r.id) && !this.deletedIds.has(r.id) && existingDirs.has(r.id)
    )
    // Count turns only for the windowed sessions — cost scales with the
    // dashboard window, not the entire Chronicle history.
    const messageCounts = this.chronicle.getMessageCounts(kept.map((r) => r.id))
    return kept.map((r) => ({
      id: r.id,
      providerId: this.id,
      cwd: r.cwd,
      repository: r.repository,
      branch: r.branch,
      createdAtMs: r.createdAtMs,
      updatedAtMs: r.updatedAtMs,
      messageCount: messageCounts.get(r.id) ?? 0,
      toolCallCount: 0
    }))
  }
  async resolveSessionByCwd(cwd: string): Promise<ResolvedSession | null> {
    if (!this.chronicle.tryOpen()) return super.resolveSessionByCwd(cwd)

    const cutoffMs = Date.now() - BaseSessionProvider.getMaxAgeDays() * 86_400_000
    const rows = this.chronicle.listSessions({ cutoffMs })
    const target = normalizePathForCompare(cwd)
    const candidates = rows.filter(
      (r) =>
        this.validateSessionId(r.id) &&
        !this.deletedIds.has(r.id) &&
        r.cwd &&
        normalizePathForCompare(r.cwd) === target
    )
    if (candidates.length === 0) {
      // Chronicle has nothing for this cwd yet (very fresh session whose row
      // Copilot hasn't committed). Fall back to the directory-scan resolver.
      return super.resolveSessionByCwd(cwd)
    }

    const candidateIds = new Set(candidates.map((r) => r.id))
    const active = await this.scanActiveSessions(candidateIds)
    let best: { row: ChronicleRow } | null = null
    for (const row of candidates) {
      if (!active.has(row.id)) continue
      if (!best || row.updatedAtMs > best.row.updatedAtMs) best = { row }
    }
    if (!best) {
      // Chronicle had matching cwd rows but none are currently active. Still
      // try the base resolver — Copilot may have written a lock for a row
      // whose `updated_at` was bumped after we last queried.
      return super.resolveSessionByCwd(cwd)
    }
    const displayName = await this.deriveDisplayName(best.row)
    this.entryPathCache.set(best.row.id, path.join(this.getSessionDir(), best.row.id))
    return { sessionId: best.row.id, displayName }
  }

  // ── Watching ─────────────────────────────────────────────────────

  async startWatching(callbacks: WatcherCallbacks): Promise<void> {
    await super.startWatching(callbacks)
    // Subscribe to Chronicle changes only after the base watcher is wired,
    // so the session cache is populated before any diffing happens.
    if (this.chronicle.tryOpen()) {
      this.chronicleUnsub = this.chronicle.onChange(() => {
        void this.refreshFromChronicle()
      })
    }
  }

  stopWatching(): void {
    this.chronicleStopped = true
    this.chronicleRefreshQueued = false
    if (this.chronicleUnsub) {
      this.chronicleUnsub()
      this.chronicleUnsub = null
    }
    this.chronicle.close()
    super.stopWatching()
  }

  /**
   * Re-query the Chronicle, diff against the cache, and push add/update/remove
   * events through the base watcher pipeline. Coalesces overlapping calls.
   */
  private async refreshFromChronicle(): Promise<void> {
    if (this.chronicleStopped) return
    if (this.chronicleRefreshing) {
      this.chronicleRefreshQueued = true
      return
    }
    this.chronicleRefreshing = true
    try {
      const sessions = await this.discoverSessions()
      const seen = new Set<string>()
      for (const s of sessions) {
        seen.add(s.id)
        this.pushSessionUpdate(s)
      }
      // Remove anything that fell out of the Chronicle window.
      for (const id of Array.from(this.getKnownSessionIds())) {
        if (!seen.has(id)) this.pushSessionRemoved(id)
      }
    } catch {
      // Refresh failures are non-fatal — next watcher event will retry.
    } finally {
      this.chronicleRefreshing = false
      if (this.chronicleRefreshQueued && !this.chronicleStopped) {
        this.chronicleRefreshQueued = false
        void this.refreshFromChronicle()
      } else {
        this.chronicleRefreshQueued = false
      }
    }
  }

  // ── Chronicle row → DiscoveredSession ────────────────────────────

  private async rowToDiscoveredSession(
    row: ChronicleRow,
    isActive: boolean,
    messageCount: number
  ): Promise<DiscoveredSession> {
    const displayName = await this.deriveDisplayName(row)
    return {
      id: row.id,
      displayName,
      status: isActive ? 'active' : 'idle',
      aiTool: this.id,
      createdAt: new Date(row.createdAtMs).toISOString(),
      updatedAt: new Date(row.updatedAtMs).toISOString(),
      cwd: row.cwd ?? undefined,
      summary: displayName,
      branch: row.branch ?? undefined,
      detailedStatus: 'idle',
      messageCount,
      // Tool call counts aren't in the Chronicle; treat idle sessions as 0.
      // Active sessions are hydrated separately via events.jsonl.
      toolCallCount: 0,
      lastActivityTime: row.updatedAtMs
    }
  }

  /**
   * Hydrate live status / counts for an active session from events.jsonl.
   * Called only for sessions with a verified `inuse.*.lock` (typically ≤ 5),
   * so the per-session FS work is bounded.
   */
  private async enrichActiveSession(base: DiscoveredSession): Promise<DiscoveredSession> {
    try {
      const eventsPath = path.join(this.getSessionDir(), base.id, 'events.jsonl')
      const parsed = await this.parseEventsIncremental(eventsPath)
      let updatedAt = base.updatedAt
      try {
        const stat = await fsp.stat(eventsPath)
        updatedAt = new Date(stat.mtimeMs).toISOString()
      } catch {
        // events.jsonl may not exist yet
      }
      return {
        ...base,
        detailedStatus: parsed?.detailedStatus ?? 'idle',
        messageCount: Math.max(parsed?.messageCount ?? 0, base.messageCount ?? 0),
        toolCallCount: parsed?.toolCallCount ?? 0,
        lastActivityTime: parsed?.lastActivityTime ?? base.lastActivityTime,
        updatedAt
      }
    } catch {
      return base
    }
  }

  /**
   * Derive a display name from the Chronicle row, preferring `summary`, then
   * the first user message. The legacy chain (workspace.yaml `name`, plan.md
   * heading) is reserved for the fallback path where the Chronicle is absent.
   */
  private async deriveDisplayName(row: ChronicleRow): Promise<string> {
    if (row.summary && row.summary.trim()) return row.summary.trim()
    const firstMsg = this.chronicle.getFirstUserMessage(row.id)
    if (firstMsg) {
      return firstMsg.length > 80 ? firstMsg.slice(0, 77) + '...' : firstMsg
    }
    return row.id.slice(0, 12)
  }

  // ── Active-session sweep ─────────────────────────────────────────

  /**
   * Sessions older than this window are skipped during the active-lock sweep.
   * Copilot CLI writes `inuse.<PID>.lock` when attaching and removes it on
   * exit — both bump the session-directory mtime — so any session currently
   * holding a lock has a recent dir mtime. We respect the user's
   * `sessionMaxAgeDays` setting with a 7-day floor so long-running CLI
   * processes that sit idle between prompts are never missed, while still
   * skipping the per-directory `readdir` for the bulk of dormant entries on
   * a 1500-session install.
   */
  private getActiveScanCutoffMs(): number {
    const days = Math.max(7, BaseSessionProvider.getMaxAgeDays())
    return Date.now() - days * 86_400_000
  }

  /** One readdir of the session dir — used to gate Chronicle rows on
   * still-on-disk entries and to feed the bounded active-sweep. */
  private async listExistingSessionDirs(): Promise<Set<string>> {
    const sessionDir = this.getSessionDir()
    const out = new Set<string>()
    try {
      const entries = await fsp.readdir(sessionDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory() && this.validateSessionId(entry.name)) {
          out.add(entry.name)
        }
      }
    } catch {
      // Session dir may not exist on a fresh install — return empty set.
    }
    return out
  }

  /**
   * Single sweep of `session-state/` to find sessions with a live
   * `inuse.<PID>.lock` file. Replaces the per-session `parseSession` walk
   * (which read workspace.yaml + events.jsonl for every directory).
   *
   * When `candidateIds` is provided, only those directories are stat()ed —
   * this is the hot path for the Chronicle-driven refresh and bounds the
   * scan to the rows we already know about. When omitted, the full session
   * dir is swept (used by the fresh-active fallback and for legacy callers).
   *
   * Optimisation: only `readdir` inside directories whose mtime is within
   * the active-scan window. Inactive sessions can't have a live lock file,
   * and bumping the directory mtime is a side-effect of writing/removing
   * the lock — so a stat() suffices to rule them out cheaply.
   */
  private async scanActiveSessions(candidateIds?: Set<string>): Promise<Set<string>> {
    const sessionDir = this.getSessionDir()
    const active = new Set<string>()
    let ids: string[]
    if (candidateIds) {
      ids = Array.from(candidateIds).filter((id) => this.validateSessionId(id))
    } else {
      try {
        const entries = await fsp.readdir(sessionDir, { withFileTypes: true })
        ids = entries
          .filter((e) => e.isDirectory() && this.validateSessionId(e.name))
          .map((e) => e.name)
      } catch {
        return active
      }
    }
    const cutoff = this.getActiveScanCutoffMs()
    for (const id of ids) {
      const dirPath = path.join(sessionDir, id)
      let mtimeMs: number
      try {
        mtimeMs = (await fsp.stat(dirPath)).mtimeMs
      } catch {
        continue
      }
      if (mtimeMs < cutoff) continue
      let files: string[]
      try {
        files = await fsp.readdir(dirPath)
      } catch {
        continue
      }
      for (const f of files) {
        const m = f.match(/^inuse\.(\d+)\.lock$/)
        if (!m) continue
        const pid = parseInt(m[1], 10)
        if (!isNaN(pid) && pid > 0 && isProcessAlive(pid)) {
          active.add(id)
          break
        }
      }
    }
    return active
  }

  // ── Legacy parsing helpers (used by the fallback path) ───────────

  private async getDisplayName(sessionDir: string, sessionId: string): Promise<string> {
    // Newer Copilot CLI versions write the human-readable session title to
    // `workspace.yaml` as `name:`. Older versions used `summary:` and/or a
    // `plan.md` heading. Check the modern field first, fall back through the
    // legacy sources, and finally to the first user prompt and a truncated id.
    const workspace = await this.parseWorkspaceYaml(sessionDir)
    if (workspace.name) return workspace.name

    const planPath = path.join(sessionDir, 'plan.md')
    const planName = await this.parsePlanSummary(planPath)
    if (planName) return planName

    if (workspace.summary) return workspace.summary

    const firstMsg = await this.parseFirstUserMessage(sessionDir)
    if (firstMsg) return firstMsg

    return sessionId.slice(0, 12)
  }

  private async parsePlanSummary(planPath: string): Promise<string | undefined> {
    try {
      const content = await fsp.readFile(planPath, 'utf-8')
      const firstHeading = content.match(/^#\s+(.+)$/m)
      return firstHeading?.[1]?.trim()
    } catch {
      return undefined
    }
  }

  private async parseWorkspaceYaml(
    sessionDir: string
  ): Promise<{ name?: string; summary?: string; cwd?: string; branch?: string }> {
    try {
      const yamlPath = path.join(sessionDir, 'workspace.yaml')
      const content = await fsp.readFile(yamlPath, 'utf-8')
      const nameMatch = content.match(/^name:\s*(.+)$/m)
      const summaryMatch = content.match(/^summary:\s*(.+)$/m)
      const cwdMatch = content.match(/^cwd:\s*(.+)$/m)
      const branchMatch = content.match(/^branch:\s*(.+)$/m)
      return {
        name: nameMatch?.[1]?.trim().replace(/^["']|["']$/g, '') || undefined,
        summary: summaryMatch?.[1]?.trim() || undefined,
        cwd: cwdMatch?.[1]?.trim() || undefined,
        branch: branchMatch?.[1]?.trim() || undefined
      }
    } catch {
      return {}
    }
  }

  private async parseFirstUserMessage(sessionDir: string): Promise<string | undefined> {
    try {
      const eventsPath = path.join(sessionDir, 'events.jsonl')
      const fd = await fsp.open(eventsPath, 'r')
      try {
        const buffer = Buffer.alloc(8192)
        const { bytesRead } = await fd.read(buffer, 0, 8192, 0)
        const content = buffer.toString('utf-8', 0, bytesRead)
        const lines = content.split('\n')
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line)
            if (event.type === 'user.message' && event.data?.content) {
              const msg = event.data.content.trim()
              return msg.length > 80 ? msg.slice(0, 77) + '...' : msg
            }
          } catch {
            continue
          }
        }
      } finally {
        await fd.close()
      }
    } catch {
      // ignore
    }
    return undefined
  }
}
