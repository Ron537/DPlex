export interface TerminalTab {
  id: string
  title: string
  shell?: string
  cwd?: string
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
  theme: string
  sidebarWidth: number
  sidebarVisible: boolean
  sessionPollIntervalMs: number
}

export interface Project {
  id: string
  name: string
  path: string
  addedAt: string
}

export interface AIToolConfig {
  id: string
  name: string
  command: string
}

export const AI_TOOLS: AIToolConfig[] = [
  { id: 'copilot-cli', name: 'Copilot CLI', command: 'copilot' },
  { id: 'claude-code', name: 'Claude Code', command: 'claude' }
]

export function getAIToolCommand(toolId: string): string {
  return AI_TOOLS.find((t) => t.id === toolId)?.command ?? 'copilot'
}

export interface AIToolAdapter {
  name: string
  icon: string
  discoverSessions(): Promise<AISession[]>
  getResumeCommand(sessionId: string): string
  getNewSessionCommand(): string
  deleteSession?(sessionId: string): Promise<void>
}
