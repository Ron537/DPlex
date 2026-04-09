export interface TerminalTab {
  id: string
  title: string
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

export interface AISession {
  id: string
  displayName: string
  status: 'active' | 'idle'
  aiTool: string
  createdAt: Date
  updatedAt: Date
  cwd?: string
  summary?: string
}

export interface AppSettings {
  defaultShell: string
  defaultAITool: string
  fontSize: number
  fontFamily: string
  theme: 'dark' | 'light'
  sidebarWidth: number
  sidebarVisible: boolean
  sessionPollIntervalMs: number
}

export interface AIToolAdapter {
  name: string
  icon: string
  discoverSessions(): Promise<AISession[]>
  getResumeCommand(sessionId: string): string
  getNewSessionCommand(): string
  deleteSession?(sessionId: string): Promise<void>
}
