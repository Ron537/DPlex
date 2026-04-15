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

interface ProjectState {
  projects: Project[]
  expandedProjectIds: Set<string>
  loaded: boolean

  loadProjects: () => Promise<void>
  addProject: (path?: string) => Promise<void>
  removeProject: (id: string) => void
  reorderProject: (draggedId: string, targetId: string, position: 'above' | 'below') => void
  toggleExpanded: (id: string) => void
  startAISession: (project: Project, providerId?: string) => void
  persistProjects: () => void
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  expandedProjectIds: new Set(),
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
    window.dplex.settings.merge({ projects })
  },

  addProject: async (selectedPath?: string) => {
    const pathToAdd = selectedPath ?? (await window.dplex.app.selectFolder())
    if (!pathToAdd) return

    const { projects } = get()
    const normalized = pathToAdd.replace(/\\/g, '/').replace(/\/+$/, '')
    if (projects.some((p) => p.path.replace(/\\/g, '/').replace(/\/+$/, '') === normalized)) {
      return
    }

    const project: Project = {
      id: generateId(),
      name: folderName(pathToAdd),
      path: pathToAdd,
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

  startAISession: (project, providerId?) => {
    const settings = useSettingsStore.getState().settings
    const pid = providerId ?? settings.defaultAITool

    window.dplex.sessions.getNewSessionCommand(pid).then((cmd) => {
      window.dplex.sessions.getProviders().then((providers) => {
        const command = cmd || (pid === 'copilot-cli' ? 'copilot' : pid)
        const providerName = providers?.find((p) => p.id === pid)?.name ?? 'AI'
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
  }
}))
