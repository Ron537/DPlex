export interface TerminalInstance {
  id: string
  title: string
  cwd?: string
}

export interface PaneNode {
  type: 'terminal' | 'split'
  direction?: 'horizontal' | 'vertical'
  terminalId?: string
  children?: PaneNode[]
  sizes?: number[]
}

export interface TabData {
  id: string
  title: string
  paneTree: PaneNode
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
