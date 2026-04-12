/**
 * Provider-agnostic types for AI tool session management.
 * Each AI CLI tool (Copilot, Claude, Codex, etc.) implements SessionProvider.
 */

export interface DiscoveredSession {
  id: string
  displayName: string
  status: 'active' | 'idle'
  aiTool: string
  createdAt: string
  updatedAt: string
  cwd?: string
  summary?: string
}

export interface ActiveProjectSession {
  id: string
  displayName: string
  cwd: string
  aiTool: string
}

export interface ResolvedSession {
  sessionId: string
  displayName: string
}

export interface ProviderInfo {
  id: string
  name: string
  command: string
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

  /** Discover all sessions for this provider from disk/filesystem. */
  discoverSessions(): Promise<DiscoveredSession[]>

  /** Find active sessions whose CWD matches any of the given project paths. */
  getActiveProjectSessions(projectPaths: string[]): Promise<ActiveProjectSession[]>

  /** Close an active session by killing its process. Returns true if a process was killed. */
  closeSession(sessionId: string): Promise<boolean>

  /** Delete a session's data from disk. */
  deleteSession(sessionId: string): Promise<void>

  /** Find a session that owns the given PID. */
  resolveSessionByPid(pid: number): Promise<ResolvedSession | null>

  /** Find the most recently active session matching the given CWD. */
  resolveSessionByCwd(cwd: string): Promise<ResolvedSession | null>

  /** Return the CLI command string to resume a session (e.g. "copilot --resume=abc123"). */
  getResumeCommand(sessionId: string): string

  /** Return the CLI command string to start a new session (e.g. "copilot"). */
  getNewSessionCommand(): string
}
