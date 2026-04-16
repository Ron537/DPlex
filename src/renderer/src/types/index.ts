export interface TerminalTab {
  id: string
  title: string
  shell?: string
  cwd?: string
  command?: string // Direct command to exec (e.g. 'copilot'). Bypasses shell — no shell to fall back to.
  sessionId?: string // AI tool session ID (e.g. copilot session dir name) for --resume on restore
  providerId?: string // AI provider id (e.g. 'copilot-cli') for composite attention identity
  pid?: number // PTY process PID, used for PID→session mapping
}

export interface ShellInfo {
  name: string
  path: string
}

export interface EditorGroup {
  id: string
  tabs: TerminalTab[]
  activeTabId: string
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
  sessionPollIntervalMs: number
  sessionMaxAgeDays: number
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
}

export interface Project {
  id: string
  name: string
  path: string
  addedAt: string
}

export interface ProviderInfo {
  id: string
  name: string
  command: string
  icon?: string
}

