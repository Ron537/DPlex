import { create } from 'zustand'
import type { Project } from '../types'
import { useSettingsStore } from './settingsStore'
import { useTerminalStore } from './terminalStore'

function generateId(): string {
  return `proj-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function folderName(folderPath: string): string {
  const parts = folderPath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || folderPath
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

export interface ActiveSession {
  id: string
  displayName: string
  cwd: string
  aiTool: string
}

interface ProjectState {
  projects: Project[]
  expandedProjectIds: Set<string>
  activeSessions: ActiveSession[]
  loaded: boolean

  loadProjects: () => Promise<void>
  addProject: () => Promise<void>
  removeProject: (id: string) => void
  reorderProject: (draggedId: string, targetId: string, position: 'above' | 'below') => void
  toggleExpanded: (id: string) => void
  startAISession: (project: Project) => void
  getActiveSessionsForProject: (projectPath: string) => ActiveSession[]
  persistProjects: () => void
  refreshActiveSessions: () => Promise<void>
  startStatusPolling: () => () => void
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  expandedProjectIds: new Set(),
  activeSessions: [],
  loaded: false,

  loadProjects: async () => {
    try {
      const allSettings = await window.dplex.settings.getAll()
      const saved = (allSettings.projects as Project[]) || []
      set({ projects: saved, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },

  persistProjects: () => {
    const { projects } = get()
    window.dplex.settings.getAll().then((current) => {
      window.dplex.settings.setAll({ ...current, projects })
    })
  },

  addProject: async () => {
    const selectedPath = await window.dplex.app.selectFolder()
    if (!selectedPath) return

    const { projects } = get()
    // Don't add duplicate paths
    const normalized = normalizePath(selectedPath)
    if (projects.some((p) => normalizePath(p.path) === normalized)) return

    const project: Project = {
      id: generateId(),
      name: folderName(selectedPath),
      path: selectedPath,
      addedAt: new Date().toISOString()
    }

    set({ projects: [...projects, project] })
    get().persistProjects()
  },

  removeProject: (id) => {
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id)
    }))
    get().persistProjects()
  },

  reorderProject: (draggedId, targetId, position) => {
    if (draggedId === targetId) return
    const { projects } = get()
    const fromIndex = projects.findIndex((p) => p.id === draggedId)
    const toIndex = projects.findIndex((p) => p.id === targetId)
    if (fromIndex === -1 || toIndex === -1) return

    const reordered = [...projects]
    const [moved] = reordered.splice(fromIndex, 1)
    // After removing, recalculate insert index
    const insertIndex = reordered.findIndex((p) => p.id === targetId)
    reordered.splice(position === 'below' ? insertIndex + 1 : insertIndex, 0, moved)
    set({ projects: reordered })
    get().persistProjects()
  },

  toggleExpanded: (id) => {
    set((state) => {
      const next = new Set(state.expandedProjectIds)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return { expandedProjectIds: next }
    })
  },

  startAISession: (project) => {
    const settings = useSettingsStore.getState().settings
    const providerId = settings.defaultAITool

    // Get command and display name synchronously from IPC cache
    window.dplex.sessions.getNewSessionCommand(providerId).then((cmd) => {
      window.dplex.sessions.getProviders().then((providers) => {
        const command = cmd || (providerId === 'copilot-cli' ? 'copilot' : providerId)
        const providerName = providers?.find((p) => p.id === providerId)?.name ?? 'AI'
        const title = `${providerName} · ${folderName(project.path)}`

        useTerminalStore.getState().createTerminal(
          undefined,
          title,
          command,
          undefined,
          project.path
        )
      })
    })
  },

  getActiveSessionsForProject: (projectPath) => {
    const { activeSessions } = get()
    const normProject = normalizePath(projectPath)
    return activeSessions.filter((s) => {
      const normCwd = normalizePath(s.cwd)
      return normCwd === normProject || normCwd.startsWith(normProject + '/')
    })
  },

  refreshActiveSessions: async () => {
    const { projects } = get()
    if (projects.length === 0) return
    try {
      const paths = projects.map((p) => p.path)
      const sessions = await window.dplex.sessions.checkStatuses(paths)
      set({ activeSessions: sessions as unknown as ActiveSession[] })
    } catch {
      // ignore
    }
  },

  startStatusPolling: () => {
    get().refreshActiveSessions()
    const interval = setInterval(() => {
      get().refreshActiveSessions()
    }, 5000)
    return () => clearInterval(interval)
  }
}))
