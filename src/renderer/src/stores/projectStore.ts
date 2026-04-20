import { create } from 'zustand'
import type { Project, ProjectWorktreeOverrides } from '../types'
import { useSettingsStore } from './settingsStore'
import { useTerminalStore } from './terminalStore'
import { normalizePath } from '../hooks/useProjectSessions'

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
  addWorktreeProject: (opts: {
    parentProjectId: string
    path: string
    branch: string
    createdByDplexWorktree?: boolean
  }) => Project
  removeProject: (id: string) => void
  reorderProject: (draggedId: string, targetId: string, position: 'above' | 'below') => void
  toggleExpanded: (id: string) => void
  startAISession: (project: Project, providerId?: string) => Promise<string | null>
  updateProjectWorktreeOverrides: (
    projectId: string,
    overrides: ProjectWorktreeOverrides | null
  ) => void
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

  updateProjectWorktreeOverrides: (projectId, overrides) => {
    const { projects, persistProjects } = get()
    const next = projects.map((p) =>
      p.id === projectId
        ? { ...p, worktreeOverrides: overrides ?? undefined }
        : p
    )
    set({ projects: next })
    persistProjects()
  },

  addProject: async (selectedPath?: string) => {
    const pathToAdd = selectedPath ?? (await window.dplex.app.selectFolder())
    if (!pathToAdd) return

    const { projects } = get()
    const normalized = normalizePath(pathToAdd)
    if (projects.some((p) => normalizePath(p.path) === normalized)) {
      return
    }

    // Detect whether the chosen path is a linked worktree of a larger repo.
    // If so, label it with the branch and (if the main repo is already added)
    // nest it as a child so it renders under its parent in the project list.
    const info = await window.dplex.git.inspectPath(pathToAdd).catch(() => null)

    let name = folderName(pathToAdd)
    let parentProjectId: string | undefined
    let parentRepoName: string | undefined
    let parentRepoPath: string | undefined
    if (info?.isWorktree) {
      name = info.branch || folderName(pathToAdd)
      parentRepoName = folderName(info.mainRepoPath)
      parentRepoPath = info.mainRepoPath
      const parent = projects.find(
        (p) => normalizePath(p.path) === normalizePath(info.mainRepoPath)
      )
      parentProjectId = parent?.id
    }

    const newProject: Project = {
      id: generateId(),
      name,
      path: pathToAdd,
      addedAt: new Date().toISOString(),
      parentProjectId,
      parentRepoName,
      parentRepoPath
    }

    // Reconcile: if this newly added project is the main repo for any existing
    // orphan worktree-projects (they stored parentRepoPath at add-time), claim
    // them as children now. Only override when the worktree is currently
    // orphan — i.e., its recorded parentProjectId points to a missing project
    // or is unset entirely.
    const idSet = new Set(projects.map((p) => p.id))
    const isOrphanWorktree = (p: Project): boolean => {
      if (!p.parentRepoPath) return false
      if (p.parentProjectId && idSet.has(p.parentProjectId)) return false
      return normalizePath(p.parentRepoPath) === normalized
    }
    const reconciled = projects.map((p) =>
      isOrphanWorktree(p)
        ? { ...p, parentProjectId: newProject.id, parentRepoName: newProject.name }
        : p
    )

    set({ projects: [...reconciled, newProject] })
    get().persistProjects()
  },

  addWorktreeProject: ({ parentProjectId, path, branch, createdByDplexWorktree }) => {
    const { projects } = get()
    const normalized = normalizePath(path)
    const existing = projects.find((p) => normalizePath(p.path) === normalized)
    if (existing) return existing

    const parent = projects.find((p) => p.id === parentProjectId)
    const project: Project = {
      id: generateId(),
      name: branch || folderName(path),
      path,
      addedAt: new Date().toISOString(),
      parentProjectId,
      parentRepoName: parent?.name,
      parentRepoPath: parent?.path,
      createdByDplexWorktree: createdByDplexWorktree ?? false
    }
    set({ projects: [...projects, project] })
    get().persistProjects()
    return project
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

  startAISession: async (project, providerId?) => {
    const settings = useSettingsStore.getState().settings
    const pid = providerId ?? settings.defaultAITool

    const [cmd, providers] = await Promise.all([
      window.dplex.sessions.getNewSessionCommand(pid),
      window.dplex.sessions.getProviders()
    ])

    const command = cmd || (pid === 'copilot-cli' ? 'copilot' : pid)
    const providerName = providers?.find((p) => p.id === pid)?.name ?? 'AI'
    const title = `${providerName} · ${folderName(project.path)}`

    const tabId = useTerminalStore.getState().createTerminal(
      undefined,
      title,
      command,
      undefined,
      project.path,
      pid
    )
    return tabId ?? null
  }
}))
