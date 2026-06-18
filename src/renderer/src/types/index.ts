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

export type EditorTab = TerminalTab | FileDiffTab | FileEditorTab

/**
 * Editable file tab opened from the file explorer. Distinct from the
 * read-only `FileDiffTab`: it targets an arbitrary project file (not a git
 * change) and mounts an editable Monaco model. Preview tabs (single-click)
 * are not persisted; permanent tabs are serialized to the workspace.
 */
export interface FileEditorTab {
  id: string
  title: string
  kind: 'fileEditor'
  /** Canonical, realpathed project root the file is bounded to. */
  rootFs: string
  /** Display name of the project (for the tab subtitle / picker parity). */
  rootLabel: string
  /** Project-root-relative POSIX path of the file. */
  relPath: string
  /** True in single-click preview mode (italic, single reusable slot). */
  preview?: boolean
  /** True when the editor has unsaved changes (drives the dirty dot). */
  dirty?: boolean
}

export function isFileDiffTab(tab: EditorTab): tab is FileDiffTab {
  return tab.kind === 'fileDiff'
}

export function isFileEditorTab(tab: EditorTab): tab is FileEditorTab {
  return tab.kind === 'fileEditor'
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
  /**
   * Treat the macOS ⌥ Option key as the Meta key inside terminals. When true
   * (default), Option is sent to the shell as Alt/Meta. When false, Option is
   * left to the OS so it can compose characters — required to type
   * @ # [ ] { } \ | on Spanish and other non-US layouts; word navigation is
   * still available via ⌥+Arrow keys. Ignored on Windows and Linux.
   */
  macOptionIsMeta: boolean
  /**
   * When true, selecting text in a terminal with the mouse automatically
   * copies it to the clipboard. Off by default, matching Windows Terminal,
   * VS Code, and iTerm2.
   */
  copyOnSelection: boolean
  theme: string
  sidebarWidth: number
  sidebarVisible: boolean
  /** Which sidebar view is active in the activity bar. */
  sidebarActiveTab: 'projects' | 'sessions' | 'git' | 'search' | 'explorer'
  /** When true, the panel portion of the sidebar is collapsed (activity bar still visible). */
  sidebarPanelCollapsed: boolean
  sessionPollIntervalMs: number
  sessionMaxAgeDays: number
  /**
   * Override the session-watcher debounce in milliseconds. When `null`/unset,
   * the platform default is used (1000 ms on Windows, 300 ms on macOS/Linux
   * for filesystem session providers; 600 ms / 200 ms respectively for the
   * Claude pidfile registry). Higher values reduce CPU on noisy filesystems
   * (Windows + AV) at the cost of slightly slower live-status updates.
   */
  watcherDebounceMs: number | null
  /** Hide idle sessions that have no messages yet. Active sessions are always shown. */
  hideEmptySessions: boolean
  /**
   * Show a slim list of recent (idle) sessions inside each expanded project /
   * worktree section so the user can resume them without leaving the panel.
   */
  showRecentSessionsInProject: boolean
  /** Max number of recent sessions surfaced per project / worktree section. */
  recentSessionsCount: number
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
  /**
   * When true, clicking a row in the attention bell will navigate to the
   * tab AND dismiss waiting events (`waitingForApproval`, `waitingForInput`),
   * matching Slack/Gmail "click to mark seen" behavior. Finished events are
   * always acknowledged on click regardless of this setting. The bell will
   * re-surface dismissed events on the next status transition or via the
   * idle-too-long escalation. Default is false to preserve historical
   * behavior where row-click only navigates.
   */
  attentionClickClearsWaiting: boolean
  /** Global defaults for worktree creation (inherited by per-project settings). */
  worktreeDefaults: WorktreeDefaults
  /** Show the health footer bar at the bottom of the Projects panel. */
  projectPanelShowFooter: boolean
  /** Per-tag color overrides keyed by the normalized tag name. Value is a
   *  `TAG_PALETTE` token id (e.g. `"violet"`). Tags without an entry fall
   *  back to a deterministic hash of the tag name, so existing tags keep
   *  their visual identity until the user picks an explicit color. */
  tagColors?: Record<string, string>
  /** Right-side Git panel UI state. */
  gitPanel: GitPanelSettings
  /**
   * File-editor save behavior. `'manual'` (default) saves only on
   * Cmd/Ctrl+S; `'onChange'` debounce-saves as you type (VSCode-style
   * auto-save). Applies to editable file tabs from the explorer.
   */
  editorAutoSave: 'manual' | 'onChange'
  /**
   * How the project focus toggle filters tabs. `'dim'` (default) keeps every
   * tab visible but de-emphasizes tabs outside the focused project.
   * `'isolate'` hides non-matching tabs entirely, showing only the active
   * project's tabs and collapsing now-empty split groups. The on/off state of
   * focus itself is ephemeral (never persisted); only this style preference is
   * remembered.
   */
  focusFilterMode: 'dim' | 'isolate'
  /**
   * Version the user explicitly chose to skip from the update banner.
   * Honored only for `manualDownload` flows (macOS, .deb) — auto-install
   * platforms surface the banner only after the bytes are already on
   * disk and a "Skip" choice there would just waste the download.
   */
  skippedUpdateVersion: string | null
}

export interface GitPanelSettings {
  /** Whether the panel is expanded. Default: false (collapsed strip). */
  open: boolean
  /** Expanded width in px. */
  width: number
  /** Per-section collapse map. Keys are section ids. */
  sectionCollapse: { changes: boolean; graph: boolean }
  /** When both Changes and Graph are expanded, the fraction of vertical
   *  space (0–1) given to the Changes pane. The Graph pane gets the rest. */
  changesFraction: number
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
  /** Free-form user-defined tags. Normalized lowercase, leading `#` stripped,
   *  deduped. Used for filtering the projects sidebar and for fuzzy matching
   *  in the command palette. Absent / empty array both mean "no tags". */
  tags?: string[]
  /** Git panel UI state scoped to this project. Persists across sessions
   *  so the user lands back on the file they last opened. Validated on
   *  each refresh — stale paths fall back to the first changed file. */
  gitPanelState?: ProjectGitPanelState
}

export interface ProjectGitPanelState {
  selectedGitPath?: string
}

export interface ProviderInfo {
  id: string
  name: string
  command: string
  icon?: string
}
