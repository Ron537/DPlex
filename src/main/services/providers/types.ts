/**
 * Provider-agnostic types for AI tool session management.
 * Each AI CLI tool (Copilot, Claude, Codex, etc.) implements SessionProvider.
 */

import type { HistoricalSession } from '../dashboard/types'

/** Granular session status derived from JSONL event parsing. */
export type SessionStatus =
  | 'idle'
  | 'thinking'
  | 'executingTool'
  | 'awaitingApproval'
  | 'waitingForUser'

/**
 * Why a session most recently became idle. Lets the attention layer tell a
 * genuine completion apart from a user cancel (Ctrl-C) or a model/API error,
 * without inventing extra `SessionStatus` values that would ripple through the
 * session-list visuals. `undefined` while the session is not idle.
 */
export type TerminalReason = 'completed' | 'aborted' | 'error'

/** Data extracted from incremental event parsing. */
export interface ParsedSessionData {
  detailedStatus: SessionStatus
  messageCount: number
  toolCallCount: number
  lastActivityTime: number
  /** Set when `detailedStatus` is `idle`; describes how the turn ended. */
  terminalReason?: TerminalReason
}

/** A single user prompt extracted from a session. */
export interface SessionPrompt {
  text: string
  timestamp?: number
  index: number
}

/** Callbacks for real-time session watcher events. */
export interface WatcherCallbacks {
  onUpdated: (session: DiscoveredSession) => void
  onAdded: (session: DiscoveredSession) => void
  onRemoved: (sessionId: string, providerId: string) => void
}

export interface DiscoveredSession {
  id: string
  displayName: string
  status: 'active' | 'idle'
  aiTool: string
  createdAt: string
  updatedAt: string
  cwd?: string
  summary?: string
  detailedStatus?: SessionStatus
  /** How the turn ended, when `detailedStatus` is `idle` (completed/aborted/error). */
  terminalReason?: TerminalReason
  branch?: string
  messageCount?: number
  toolCallCount?: number
  lastActivityTime?: number
}

export interface ResolvedSession {
  sessionId: string
  displayName: string
}

export interface ProviderInfo {
  id: string
  name: string
  command: string
  icon?: string
}

/**
 * Interface that every AI tool provider must implement.
 * Adding a new provider = creating a class that implements this interface
 * and registering it with the ProviderRegistry.
 */
export interface SessionProvider {
  readonly id: string
  readonly name: string
  readonly command: string
  readonly icon?: string

  /** Discover all sessions for this provider from disk/filesystem. */
  discoverSessions(): Promise<DiscoveredSession[]>

  /**
   * Return lightweight historical rows for sessions created at/after
   * `cutoffMs`. Used by the Overview Dashboard for long-window aggregation,
   * independent of the (shorter) live-discovery age cap. Must stay cheap —
   * no deep per-session event parsing.
   */
  getSessionHistory(cutoffMs: number): Promise<HistoricalSession[]>

  /** Close an active session by killing its process. Returns true if a process was killed. */
  closeSession(sessionId: string): Promise<boolean>

  /** Delete a session's data from disk. */
  deleteSession(sessionId: string): Promise<void>

  /** Find a session that owns the given PID. */
  resolveSessionByPid(pid: number): Promise<ResolvedSession | null>

  /** Find the most recently active session matching the given CWD. */
  resolveSessionByCwd(cwd: string): Promise<ResolvedSession | null>

  /** Return the CLI command string to resume a session (e.g. "copilot --resume=abc123"),
   *  or null when the session id is unsafe to interpolate into a shell command. */
  getResumeCommand(sessionId: string): string | null

  /** Return the CLI command string to start a new session (e.g. "copilot"). */
  getNewSessionCommand(): string

  /** Start watching for real-time session changes. */
  startWatching(callbacks: WatcherCallbacks): Promise<void>

  /** Stop watching for session changes. */
  stopWatching(): void

  /** Get user prompts from a session. */
  getPrompts(sessionId: string, limit?: number): Promise<SessionPrompt[]>
}
