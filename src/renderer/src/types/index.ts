import type { ChangedFile, DiffScope as DiffScopeFromIPC } from '../../../preload/index'

export interface TerminalTab {
  id: string
  title: string
  kind?: 'terminal'
  shell?: string
  cwd?: string
  command?: string // Direct command to exec (e.g. 'copilot'). Bypasses shell — no shell to fall back to.
  sessionId?: string // AI tool session ID (e.g. copilot session dir name) for --resume on restore
  providerId?: string // AI provider id (e.g. 'copilot-cli') for composite attention identity
  pid?: number // PTY process PID, used for PID→session mapping
  worktreePath?: string // Canonical worktree path if this tab was launched against a worktree
  worktreeBranch?: string // Worktree branch at launch time (display hint, not authoritative)
}

export type DiffScopePersisted = DiffScopeFromIPC

/**
 * Per-file diff tab. Replaces the legacy "diff dashboard" tab — each tab now
 * targets a single file. The Git panel produces these tabs (preview or
 * permanent); preview tabs are not persisted in the workspace.
 */
export interface FileDiffTab {
  id: string
  title: string
  kind: 'fileDiff'
  /** Absolute, OS-correct repo root path (project or worktree). */
  repoRootFs: string
  /** Display name of the repo (project / worktree name). */
  repoLabel: string
  scope: DiffScopePersisted
  /** Snapshot of the file's status at open time. Refreshed when the underlying
   *  changes list updates and this gitPath is still present. */
  file: ChangedFile
  /** True when this tab is in "preview" mode (italic title, single slot
   *  per group, replaced on next single-click). Promoted to permanent
   *  on double-click or programmatic action. */
  preview?: boolean
  /** UI preference per tab. */
  sideBySide?: boolean
}

export type EditorTab = TerminalTab | FileDiffTab

export function isFileDiffTab(tab: EditorTab): tab is FileDiffTab {
  return tab.kind === 'fileDiff'
}

export function isTerminalTab(tab: EditorTab): tab is TerminalTab {
  // Positive match to stay sound if a third tab kind is added later.
  return tab.kind === 'terminal' || tab.kind === undefined
}

export interface ShellInfo {
  name: string
  path: string
}

export interface EditorGroup {
  id: string
  tabs: EditorTab[]
  activeTabId: string
  /**
   * Id of the tab currently in "preview" mode within this group (if any).
   * Invariant: undefined or refers to an existing tab in `tabs`. Sanitized
   * by `terminalStore.sanitizeGroupPreview` after every group/tab mutation.
   */
  previewTabId?: string
}

export interface LayoutNode {
  type: 'group' | 'split'
  groupId?: string
  direction?: 'horizontal' | 'vertical'
  children?: LayoutNode[]
}

export type SessionStatus =
  | 'idle'
  | 'thinking'
  | 'executingTool'
  | 'awaitingApproval'
  | 'waitingForUser'

export interface AISession {
  id: string
  displayName: string
  status: 'active' | 'idle'
  aiTool: string
  createdAt: Date
  updatedAt: Date
  cwd?: string
  summary?: string
  detailedStatus?: SessionStatus
  branch?: string
  messageCount?: number
  toolCallCount?: number
  lastActivityTime?: number
}

export interface AppSettings {
  defaultShell: string
  defaultAITool: string
  fontSize: number
  fontFamily: string
  theme: string
  sidebarWidth: number
  sidebarVisible: boolean
  /** Which sidebar tab is active in the activity bar. */
  sidebarActiveTab: 'projects' | 'sessions'
  /** When true, the panel portion of the sidebar is collapsed (activity bar still visible). */
  sidebarPanelCollapsed: boolean
  sessionPollIntervalMs: number
  sessionMaxAgeDays: number
  /** Hide idle sessions that have no messages yet. Active sessions are always shown. */
  hideEmptySessions: boolean
  // Attention inbox / notifications
  notificationsEnabled: boolean
  notifyOnApproval: boolean
  notifyOnInput: boolean
  notifyOnFinished: boolean
  notifyOnlyWhenUnfocused: boolean
  notificationSound: boolean
  dndFrom: string | null // "HH:MM" or null
  dndTo: string | null
  notificationCooldownSeconds: number
  idleTooLongMinutes: number
  /** Global defaults for worktree creation (inherited by per-project settings). */
  worktreeDefaults: WorktreeDefaults
  /** Show the health footer bar at the bottom of the Projects panel. */
  projectPanelShowFooter: boolean
  /** Right-side Git panel UI state. */
  gitPanel: GitPanelSettings
}

export interface GitPanelSettings {
  /** Whether the panel is expanded. Default: false (collapsed strip). */
  open: boolean
  /** Expanded width in px. */
  width: number
  /** Per-section collapse map. Keys are section ids. */
  sectionCollapse: { changes: boolean }
}

export interface WorktreeDefaults {
  /** Path pattern — supports `{project}` and `{branch}` placeholders. */
  locationPattern: string
  /** Env files (repo-relative) to copy on create. Supports trailing `*`. */
  envFiles: string[]
  /** Setup script to run after creation (bash-style). Empty = none. */
  setupScript: string
  /** Default after-create behavior. */
  afterCreate: 'session' | 'terminal' | 'none'
}

export interface ProjectWorktreeOverrides {
  locationPattern?: string
  envFiles?: string[] | null // null = inherit
  setupScript?: string
  afterCreate?: 'session' | 'terminal' | 'none'
}

export interface Project {
  id: string
  name: string
  path: string
  addedAt: string
  worktreeOverrides?: ProjectWorktreeOverrides
  /** If set, this project is a worktree of the project with this id. */
  parentProjectId?: string
  /** Display name of the parent repo at creation time — preserved so orphan
      worktrees (parent project removed) can still show "branch (repo)". */
  parentRepoName?: string
  /** Absolute path of the parent repo (main checkout). Used to reconcile
      parentProjectId when the origin is added later. */
  parentRepoPath?: string
  /** True when DPlex created the worktree (affects default "delete from disk" behavior). */
  createdByDplexWorktree?: boolean
  /** Pinned projects render in a dedicated section at the top of the panel. */
  pinned?: boolean
  /**
   * Git panel UI state scoped to this project. Persists across sessions so
   * the user lands back on the file they last opened. Validated on each
   * refresh — stale paths fall back to the first changed file, and an
   * invalid worktree root falls back to the project root.
   */
  gitPanelState?: ProjectGitPanelState
}

export interface ProjectGitPanelState {
  selectedGitPath?: string
  activeWorktreeRoot?: string
}

export interface ProviderInfo {
  id: string
  name: string
  command: string
  icon?: string
}
