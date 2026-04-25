import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import type {
  DiscoveredSession,
  ParsedSessionData,
  SessionPrompt,
  SessionStatus,
  WatcherCallbacks
} from './types'
import { BaseSessionProvider, type SessionEntry } from './baseProvider'
import {
  parseClaudeEvents,
  extractClaudePrompts,
  clearClaudeParseCache,
  getCachedExtras
} from './claudeEventsParser'
import {
  getClaudePidfileRegistry,
  type ClaudePidfileRegistry,
  type ClaudePidfileSnapshot
} from './claudePidfileRegistry'
import { killProcess, isProcessAlive } from './processUtils'

/**
 * Provider for Claude Code (`claude` CLI from `@anthropic-ai/claude-code`).
 *
 * Storage layout differs from Copilot CLI:
 *   • Each session is a single JSONL file at
 *     `~/.claude/projects/<slug-of-cwd>/<sessionId>.jsonl`.
 *   • Live status is published in `~/.claude/sessions/<pid>.json`
 *     (the "fleetview" pidfile registry — see {@link ClaudePidfileRegistry}).
 *
 * Display name lookup chain:
 *   1. pidfile `name` field (CLI auto-generated 2-4 word label)
 *   2. First user message in the JSONL transcript
 *   3. `sessionId.slice(0, 12)` fallback
 */
export class ClaudeCodeProvider extends BaseSessionProvider {
  readonly id = 'claude-code'
  readonly name = 'Claude Code'
  readonly command = 'claude'
  readonly icon = 'claude'

  private registry: ClaudePidfileRegistry
  private registryUnsubscribe: (() => void) | null = null
  /**
   * Permanent registry pin held for the lifetime of the provider. Without
   * this, registry-backed paths (`parseSession`, `closeSession`,
   * `resolveSessionByCwd`, `getActivePidsForEntry`) called before
   * `startWatching()` would hit an empty index — and `deleteSession` would
   * skip the kill phase, deleting the JSONL while `claude` is still
   * writing to it. Released by {@link dispose}.
   */
  private registryPin: (() => void) | null = null

  constructor(registry?: ClaudePidfileRegistry) {
    super()
    this.registry = registry ?? getClaudePidfileRegistry()
    // Pin the registry alive and kick off its initial scan eagerly.
    this.registryPin = this.registry.subscribe(() => {})
    void this.registry.ensureStarted()
  }

  /**
   * Release the permanent registry pin held by the constructor. Idempotent.
   * Tests that construct a provider should call this in teardown to avoid
   * leaking the singleton registry's watcher across test files.
   */
  dispose(): void {
    if (this.registryPin) {
      this.registryPin()
      this.registryPin = null
    }
    this.stopWatching()
  }

  // ── Required hooks ───────────────────────────────────────────────

  protected getSessionDir(): string {
    return path.join(os.homedir(), '.claude', 'projects')
  }

  /**
   * Walk two levels deep: each direct child of `projects/` is a per-cwd
   * folder, each `.jsonl` file inside is one session.
   */
  protected async listSessionEntries(): Promise<SessionEntry[]> {
    const sessionDir = this.getSessionDir()
    if (!(await this.dirExists(sessionDir))) return []

    const out: SessionEntry[] = []
    let projects: fs.Dirent[]
    try {
      projects = await fsp.readdir(sessionDir, { withFileTypes: true })
    } catch {
      return out
    }

    for (const proj of projects) {
      if (!proj.isDirectory()) continue
      const projPath = path.join(sessionDir, proj.name)
      let files: string[]
      try {
        files = await fsp.readdir(projPath)
      } catch {
        continue
      }
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue
        const sessionId = file.slice(0, -'.jsonl'.length)
        if (!sessionId) continue
        const fullPath = path.join(projPath, file)
        try {
          const stat = await fsp.stat(fullPath)
          out.push({
            id: sessionId,
            path: fullPath,
            mtimeMs: stat.mtimeMs,
            birthtimeMs: stat.birthtimeMs
          })
        } catch {
          // Skip unreadable
        }
      }
    }
    return out
  }

  /**
   * Resolve a sessionId to its `.jsonl` path. Uses the entry-path cache
   * populated by discovery; falls back to a full scan when the cache misses.
   */
  protected async getEntryForSessionId(sessionId: string): Promise<SessionEntry | null> {
    if (!this.validateSessionId(sessionId)) return null
    return super.getEntryForSessionId(sessionId)
  }

  protected async parseSession(entry: SessionEntry): Promise<DiscoveredSession | null> {
    try {
      await this.registry.ensureStarted()
      const parsed = await parseClaudeEvents(entry.path)
      const extras = getCachedExtras(entry.path)

      const cwd = extras.cwd ?? decodeCwdFromSlug(path.basename(path.dirname(entry.path)))
      const snap = this.registry.getBySessionId(entry.id)
      const isActive = snap !== null && isProcessAlive(snap.pid)

      const detailedStatus: SessionStatus = isActive
        ? mapPidfileStatus(snap)
        : (parsed?.detailedStatus ?? 'idle')

      const displayName =
        snap?.name?.trim() || extras.firstUserPrompt || entry.id.slice(0, 12)

      const updatedAtMs = Math.max(
        entry.mtimeMs,
        parsed?.lastActivityTime ?? 0,
        snap?.updatedAt ?? 0
      )

      return {
        id: entry.id,
        displayName,
        status: isActive ? 'active' : 'idle',
        aiTool: this.id,
        createdAt: new Date(entry.birthtimeMs).toISOString(),
        updatedAt: new Date(updatedAtMs).toISOString(),
        cwd,
        summary: snap?.detail || displayName,
        branch: extras.gitBranch,
        detailedStatus,
        messageCount: parsed?.messageCount ?? 0,
        toolCallCount: parsed?.toolCallCount ?? 0,
        lastActivityTime: parsed?.lastActivityTime ?? entry.mtimeMs
      }
    } catch {
      return null
    }
  }

  protected parseEventsIncremental(filePath: string): Promise<ParsedSessionData> {
    return parseClaudeEvents(filePath)
  }

  protected extractPromptsFromEvents(
    entryPath: string,
    limit: number
  ): Promise<SessionPrompt[]> {
    return extractClaudePrompts(entryPath, limit)
  }

  // ── Active-session hooks (use the registry instead of lock files) ──

  protected async getActivePidsForEntry(entry: SessionEntry): Promise<number[]> {
    await this.registry.ensureStarted()
    const snap = this.registry.getBySessionId(entry.id)
    if (!snap) return []
    return isProcessAlive(snap.pid) ? [snap.pid] : []
  }

  protected async getActivePidForEntry(entry: SessionEntry): Promise<number | null> {
    const pids = await this.getActivePidsForEntry(entry)
    return pids[0] ?? null
  }

  protected async findSessionEntryByPid(pid: number): Promise<SessionEntry | null> {
    await this.registry.ensureStarted()
    const snap = this.registry.getByPid(pid)
    if (!snap) return null
    return this.getEntryForSessionId(snap.sessionId)
  }

  // ── Resolution overrides — fast path via the registry ─────────────

  async resolveSessionByCwd(cwd: string): Promise<{ sessionId: string; displayName: string } | null> {
    await this.registry.ensureStarted()
    const snap = this.registry.getByCwd(cwd)
    if (!snap) return null
    const entry = await this.getEntryForSessionId(snap.sessionId)
    if (!entry) {
      return {
        sessionId: snap.sessionId,
        displayName: snap.name?.trim() || snap.sessionId.slice(0, 12)
      }
    }
    const session = await this.parseSession(entry)
    return {
      sessionId: snap.sessionId,
      displayName: session?.displayName ?? snap.sessionId.slice(0, 12)
    }
  }

  // ── Removal ──────────────────────────────────────────────────────

  protected async removeSessionData(entry: SessionEntry): Promise<void> {
    // Remove the JSONL transcript.
    try {
      await fsp.unlink(entry.path)
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err
    }
    // Best-effort: remove any matching pidfile (the CLI usually unlinks it
    // on graceful exit, but a hard kill can leave one behind).
    const snap = this.registry.getBySessionId(entry.id)
    if (snap) {
      const pidfile = path.join(
        os.homedir(),
        '.claude',
        'sessions',
        `${snap.pid}.json`
      )
      try {
        await fsp.unlink(pidfile)
      } catch {
        // ignore — file may already be gone
      }
    }
  }

  protected onSessionDeleted(entry: SessionEntry): void {
    clearClaudeParseCache(entry.path)
  }

  // ── Watch-path mapping ───────────────────────────────────────────

  /**
   * Recursive watcher fires on `<slug>/<sessionId>.jsonl`. Extract the
   * sessionId (filename without extension); ignore non-jsonl events and
   * directory-level events.
   */
  protected sessionIdFromWatchPath(relativePath: string): string | null {
    const parts = relativePath.replace(/\\/g, '/').split('/')
    const last = parts[parts.length - 1]
    if (!last || !last.endsWith('.jsonl')) return null
    const id = last.slice(0, -'.jsonl'.length)
    return id || null
  }

  // ── CLI invocation ───────────────────────────────────────────────

  getResumeCommand(sessionId: string): string {
    return `claude --resume ${sessionId}`
  }

  getNewSessionCommand(): string {
    return 'claude'
  }

  // ── Watcher integration ──────────────────────────────────────────

  async startWatching(callbacks: WatcherCallbacks): Promise<void> {
    await super.startWatching(callbacks)

    // Subscribe to the pidfile registry — every status change pushes a
    // refreshed `DiscoveredSession` through the same dedup pipeline as
    // filesystem events.
    if (this.registryUnsubscribe) this.registryUnsubscribe()
    this.registryUnsubscribe = this.registry.subscribe((snapshots) => {
      for (const snap of snapshots) {
        // Schedule asynchronously — we don't need to block the registry's
        // notify loop on disk I/O for parseSession.
        void this.refreshSessionFromSnapshot(snap)
      }
    })
  }

  stopWatching(): void {
    if (this.registryUnsubscribe) {
      this.registryUnsubscribe()
      this.registryUnsubscribe = null
    }
    super.stopWatching()
  }

  // ── Close (kill PID via registry) ─────────────────────────────────

  async closeSession(sessionId: string): Promise<boolean> {
    await this.registry.ensureStarted()
    const snap = this.registry.getBySessionId(sessionId)
    if (!snap) return false
    return killProcess(snap.pid)
  }

  // ── Internal ─────────────────────────────────────────────────────

  private async refreshSessionFromSnapshot(snap: ClaudePidfileSnapshot): Promise<void> {
    const entry = await this.getEntryForSessionId(snap.sessionId)
    if (!entry) return
    const session = await this.parseSession(entry)
    if (!session) return
    this.pushSessionUpdate(session)
  }
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Decode a Claude project-folder slug back to an absolute cwd.
 *
 * Claude's slug rule: replace every `/` in the absolute cwd with `-`,
 * keeping the leading `/` as a leading `-`.
 *   `/Users/me/repo`  →  `-Users-me-repo`
 *
 * The decoding is ambiguous when the original cwd contains hyphens
 * (e.g. `/Users/me/my-repo` collides with `/Users/me/my/repo`). For that
 * reason `parseSession` prefers the `cwd` field embedded in the JSONL
 * envelopes, which is unambiguous.
 *
 * On Windows the CLI normalizes paths to forward slashes before slugging,
 * so `C:\Users\me\repo` becomes `-C-Users-me-repo`. We don't try to
 * round-trip Windows drive letters; rely on the JSONL `cwd` field.
 */
export function decodeCwdFromSlug(slug: string): string | undefined {
  if (!slug) return undefined
  if (!slug.startsWith('-')) return undefined
  // Naive decode: `-` → `/`. Good enough as a fallback when the JSONL hasn't
  // been parsed yet; otherwise the JSONL `cwd` field is preferred.
  return slug.replace(/-/g, '/')
}

/**
 * Tools whose `approve <name>` waitingFor reason should be treated as
 * "waiting for the user to answer", not "awaiting approval to perform a
 * side-effecting action". From the CLI's perspective every tool call is
 * gated by an `approve <toolName>` waitingFor, but for UX purposes a tool
 * that's purely about prompting the user (like `AskUserQuestion`) should
 * surface as "waitingForUser" — same colour as a free-form input prompt —
 * rather than the louder "Needs approval" badge reserved for Bash/Edit/
 * Write etc. that imply real-world side effects.
 */
const NON_APPROVAL_TOOLS = new Set<string>(['AskUserQuestion'])

/** Map a live pidfile snapshot to dplex's SessionStatus enum. */
export function mapPidfileStatus(snap: ClaudePidfileSnapshot): SessionStatus {
  if (snap.tempo === 'blocked') return 'waitingForUser'
  if (snap.status === 'waiting') {
    const reason = snap.waitingFor ?? ''
    if (reason.startsWith('approve ')) {
      const toolName = reason.slice('approve '.length).trim()
      if (NON_APPROVAL_TOOLS.has(toolName)) return 'waitingForUser'
      return 'awaitingApproval'
    }
    return 'waitingForUser'
  }
  if (snap.status === 'busy') {
    // `detail` contains a "Tool · summary" line when a tool is running.
    if (snap.detail && snap.detail.includes('·')) return 'executingTool'
    return 'thinking'
  }
  return 'idle'
}
