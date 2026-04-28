import { create } from 'zustand'
import type { Project, ProjectGitPanelState, ProjectWorktreeOverrides } from '../types'
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
  /** Id of the most recently expanded project. Used to visually emphasize it. */
  lastExpandedProjectId: string | null
  /**
   * Id of the project the Git panel and other ambient project-scoped UI bind
   * to. Distinct from `lastExpandedProjectId` (which only tracks visual
   * emphasis in the project list). Set when the user explicitly chooses a
   * project context — e.g. clicks a project row, focuses a terminal whose
   * cwd matches a project, or restores the workspace.
   */
  activeProjectId: string | null
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
  setLastExpanded: (id: string) => void
  setActiveProject: (id: string | null) => void
  setProjectGitState: (id: string, patch: ProjectGitPanelState) => void
  togglePin: (id: string) => void
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
  lastExpandedProjectId: null,
  activeProjectId: null,
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
      p.id === projectId ? { ...p, worktreeOverrides: overrides ?? undefined } : p
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
    set((state) => {
      const nextExpanded = new Set(state.expandedProjectIds)
      nextExpanded.delete(id)
      return {
        projects: state.projects.filter((p) => p.id !== id),
        expandedProjectIds: nextExpanded,
        lastExpandedProjectId:
          state.lastExpandedProjectId === id ? null : state.lastExpandedProjectId,
        activeProjectId: state.activeProjectId === id ? null : state.activeProjectId
      }
    })
    get().persistProjects()
  },

  togglePin: (id) => {
    set((state) => {
      const target = state.projects.find((p) => p.id === id)
      if (!target) return {}
      const willBePinned = !target.pinned
      const updated = state.projects.map((p) => (p.id === id ? { ...p, pinned: willBePinned } : p))
      if (!willBePinned) {
        // Unpin in place — the project stays where it is in raw order, it just
        // falls out of the Pinned section in the rendered list.
        return { projects: updated }
      }
      // Pinning: move the target to the top of the pinned group so the UX
      // matches the "Pin to top" menu label. The pinned group always renders
      // before the unpinned group, so inserting at index 0 achieves that.
      const pinnedTarget = updated.find((p) => p.id === id)!
      const without = updated.filter((p) => p.id !== id)
      return { projects: [pinnedTarget, ...without] }
    })
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
        // Collapsing the currently-emphasized project clears emphasis; if other
        // projects remain expanded the emphasis simply disappears until the
        // next expand.
        const nextLast = state.lastExpandedProjectId === id ? null : state.lastExpandedProjectId
        return { expandedProjectIds: next, lastExpandedProjectId: nextLast }
      }
      next.add(id)
      return { expandedProjectIds: next, lastExpandedProjectId: id }
    })
  },

  // Promote an already-expanded project to be the emphasized one without
  // toggling its expansion state. If the project is not yet expanded, this
  // expands it too (same semantics as toggleExpanded on a collapsed id).
  setLastExpanded: (id) => {
    set((state) => {
      if (state.lastExpandedProjectId === id && state.expandedProjectIds.has(id)) {
        return state
      }
      const next = new Set(state.expandedProjectIds)
      next.add(id)
      return { expandedProjectIds: next, lastExpandedProjectId: id }
    })
  },

  // Set the active project context. Pass null to clear.
  // This is the binding signal for the Git panel and any other ambient,
  // project-scoped UI. We tolerate ids that don't (yet) exist in `projects`
  // so callers can race-set during workspace restore; consumers should
  // gracefully handle a missing project.
  setActiveProject: (id) => {
    set((state) => {
      if (state.activeProjectId === id) return state
      return { activeProjectId: id }
    })
  },

  setProjectGitState: (id, patch) => {
    set((state) => {
      const idx = state.projects.findIndex((p) => p.id === id)
      if (idx === -1) return state
      const current = state.projects[idx]
      const next: ProjectGitPanelState = {
        ...(current.gitPanelState ?? {}),
        ...patch
      }
      // Drop the field entirely when there's nothing meaningful to persist —
      // keeps the saved JSON tidy and avoids cluttering older builds with
      // empty objects after a single refresh cycle.
      const isEmpty = next.selectedGitPath === undefined && next.activeWorktreeRoot === undefined
      const newProj: Project = isEmpty
        ? { ...current, gitPanelState: undefined }
        : { ...current, gitPanelState: next }
      const newProjects = [...state.projects]
      newProjects[idx] = newProj
      return { projects: newProjects }
    })
    get().persistProjects()
  },

  startAISession: async (project, providerId?) => {
    const settings = useSettingsStore.getState().settings
    const configuredPid = providerId ?? settings.defaultAITool

    const providers = (await window.dplex.sessions.getProviders()) ?? []
    // Fall back to the first registered provider if the configured default
    // isn't registered (e.g. user had a provider that's since been removed).
    const resolved = providers.find((p) => p.id === configuredPid) ?? providers[0]
    if (!resolved) return null
    const pid = resolved.id

    const cmd = await window.dplex.sessions.getNewSessionCommand(pid)
    const command = cmd || resolved.command || pid
    const title = `${resolved.name} · ${folderName(project.path)}`

    const tabId = useTerminalStore
      .getState()
      .createTerminal(undefined, title, command, undefined, project.path, pid)
    return tabId ?? null
  }
}))
