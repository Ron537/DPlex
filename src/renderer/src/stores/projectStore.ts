import { create } from 'zustand'
import type { Project, ProjectGitPanelState, ProjectWorktreeOverrides } from '../types'
import { useSettingsStore } from './settingsStore'
import { useTerminalStore } from './terminalStore'
import { useTabFocusStore } from './tabFocusStore'
import { normalizePath } from '../hooks/useProjectSessions'
import { normalizeTag, normalizeTags } from '../utils/projectTags'

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
  /**
   * Worktree-section header collapse state, keyed by either a worktree
   * project id (for child worktrees) or `${parentId}::main` (for the
   * parent's main-checkout section). Defaults to **expanded** — a section
   * appears in this set only after the user explicitly collapses it.
   *
   * Stored separately from `expandedProjectIds` so toggling a worktree
   * section never collapses the parent project, and so the default
   * expanded state doesn't require seeding entries every time a project
   * loads.
   */
  collapsedWorktreeSections: Set<string>
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
  /** Toggle the collapsed/expanded state of a worktree section header. */
  toggleWorktreeSection: (sectionId: string) => void
  setLastExpanded: (id: string) => void
  setActiveProject: (id: string | null) => void
  setProjectGitState: (id: string, patch: ProjectGitPanelState) => void
  togglePin: (id: string) => void
  /** Replace this project's tags with the given list (will be normalized).
   *  Use this from the tag picker after committing edits. */
  setProjectTags: (id: string, tags: readonly string[]) => void
  /** Convenience: add a single tag (idempotent). Returns nothing; callers
   *  read the next render. */
  addProjectTag: (id: string, tag: string) => void
  /** Convenience: remove a single tag. No-op if not present. */
  removeProjectTag: (id: string, tag: string) => void
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
  collapsedWorktreeSections: new Set(),
  lastExpandedProjectId: null,
  activeProjectId: null,
  loaded: false,

  loadProjects: async () => {
    try {
      const allSettings = await window.dplex.settings.getAll()
      const rawSaved = (allSettings.projects as Project[]) || []
      // Strip the legacy `gitPanelState.activeWorktreeRoot` field — it was
      // a vestigial mechanism that pre-dated the "switching active project
      // IS the switch" model. Older builds wrote it; current code never
      // does, but stale values on worktree children pointed at the parent
      // path and made `resolveActiveRoot` return the wrong repo.
      let mutated = false
      const saved: Project[] = rawSaved.map((p) => {
        const gps = p.gitPanelState as
          | (ProjectGitPanelState & { activeWorktreeRoot?: string })
          | undefined
        if (!gps || gps.activeWorktreeRoot === undefined) return p
        mutated = true
        const cleaned: ProjectGitPanelState = { selectedGitPath: gps.selectedGitPath }
        const isEmpty = cleaned.selectedGitPath === undefined
        return { ...p, gitPanelState: isEmpty ? undefined : cleaned }
      })
      const savedActiveId = (allSettings.activeProjectId as string | null | undefined) ?? null
      const restoredActiveId =
        savedActiveId && saved.some((p) => p.id === savedActiveId) ? savedActiveId : null
      // Visual state (expansion + last-expanded emphasis) is driven separately
      // from activeProjectId, so we re-derive it from the restored active id
      // to match what `setActiveProject + toggleExpanded` would have produced
      // when the user originally clicked the row. For nested worktree
      // projects we also walk the parent chain so the active row is actually
      // visible after restore (otherwise the parent stays collapsed).
      const restoredExpanded = new Set<string>()
      if (restoredActiveId) {
        const byId = new Map(saved.map((p) => [p.id, p]))
        let cursor: Project | undefined = byId.get(restoredActiveId)
        const seen = new Set<string>()
        while (cursor && !seen.has(cursor.id)) {
          seen.add(cursor.id)
          restoredExpanded.add(cursor.id)
          cursor = cursor.parentProjectId ? byId.get(cursor.parentProjectId) : undefined
        }
      }
      set({
        projects: saved,
        activeProjectId: restoredActiveId,
        expandedProjectIds: restoredExpanded,
        lastExpandedProjectId: restoredActiveId,
        loaded: true
      })
      if (mutated) {
        window.dplex.settings.merge({ projects: saved })
      }
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
    let activeCleared = false
    set((state) => {
      const nextExpanded = new Set(state.expandedProjectIds)
      nextExpanded.delete(id)
      activeCleared = state.activeProjectId === id
      return {
        projects: state.projects.filter((p) => p.id !== id),
        expandedProjectIds: nextExpanded,
        lastExpandedProjectId:
          state.lastExpandedProjectId === id ? null : state.lastExpandedProjectId,
        activeProjectId: activeCleared ? null : state.activeProjectId
      }
    })
    // Clear the tab focus filter if it pointed at the removed project,
    // otherwise the user is left with a dimmed UI and no in-app way to
    // dismiss it (the focus pill resolves the project lookup to undefined
    // and disappears).
    if (useTabFocusStore.getState().focusedProjectId === id) {
      useTabFocusStore.getState().clear()
    }
    get().persistProjects()
    if (activeCleared) window.dplex.settings.merge({ activeProjectId: null })
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

  setProjectTags: (id, tags) => {
    const normalized = normalizeTags(tags)
    let changed = false
    set((state) => {
      const idx = state.projects.findIndex((p) => p.id === id)
      if (idx === -1) return state
      const current = state.projects[idx]
      const before = current.tags ?? []
      if (before.length === normalized.length && before.every((t, i) => t === normalized[i])) {
        return state
      }
      changed = true
      const next: Project =
        normalized.length === 0 ? { ...current, tags: undefined } : { ...current, tags: normalized }
      const newProjects = [...state.projects]
      newProjects[idx] = next
      return { projects: newProjects }
    })
    if (changed) get().persistProjects()
  },

  addProjectTag: (id, tag) => {
    const t = normalizeTag(tag)
    if (!t) return
    const { projects, setProjectTags } = get()
    const current = projects.find((p) => p.id === id)
    if (!current) return
    if (current.tags?.includes(t)) return
    setProjectTags(id, [...(current.tags ?? []), t])
  },

  removeProjectTag: (id, tag) => {
    const t = normalizeTag(tag)
    if (!t) return
    const { projects, setProjectTags } = get()
    const current = projects.find((p) => p.id === id)
    if (!current || !current.tags?.includes(t)) return
    setProjectTags(
      id,
      current.tags.filter((x) => x !== t)
    )
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
    let clearActive = false
    let promoteActiveTo: string | null = null
    set((state) => {
      const next = new Set(state.expandedProjectIds)
      if (next.has(id)) {
        next.delete(id)
        // Collapsing the currently-emphasized project clears emphasis; if other
        // projects remain expanded the emphasis simply disappears until the
        // next expand.
        const nextLast = state.lastExpandedProjectId === id ? null : state.lastExpandedProjectId
        // If we're collapsing the active project — or any ancestor of the
        // active worktree child — the active selection would become
        // invisible. We promote the active to the nearest still-rendered
        // ancestor when one exists (so collapsing a worktree-child keeps
        // its parent project highlighted), otherwise clear it entirely
        // (collapsing a top-level project means "I'm done with this one").
        const activeId = state.activeProjectId
        if (activeId) {
          const byId = new Map(state.projects.map((p) => [p.id, p]))
          // Walk activeId → root, collecting the parent chain.
          const path: string[] = []
          let cursor = byId.get(activeId)
          const seen = new Set<string>()
          while (cursor && !seen.has(cursor.id)) {
            seen.add(cursor.id)
            path.push(cursor.id)
            cursor = cursor.parentProjectId ? byId.get(cursor.parentProjectId) : undefined
          }
          const collapseIdx = path.indexOf(id)
          if (collapseIdx !== -1) {
            // The collapsed project is on the active path. Try the next
            // ancestor up — if it exists in the project list (always true
            // for worktree-children since their parent is registered as a
            // top-level project), promote active to it; otherwise clear.
            const ancestorId = path[collapseIdx + 1]
            if (ancestorId && byId.has(ancestorId)) {
              promoteActiveTo = ancestorId
            } else {
              clearActive = true
            }
          }
        }
        return {
          expandedProjectIds: next,
          lastExpandedProjectId: nextLast,
          ...(clearActive ? { activeProjectId: null } : {}),
          ...(promoteActiveTo ? { activeProjectId: promoteActiveTo } : {})
        }
      }
      next.add(id)
      return { expandedProjectIds: next, lastExpandedProjectId: id }
    })
    if (clearActive) {
      window.dplex.settings.merge({ activeProjectId: null })
    } else if (promoteActiveTo) {
      window.dplex.settings.merge({ activeProjectId: promoteActiveTo })
    }
  },

  // Toggle a worktree section's collapsed state. Independent of project
  // expansion — collapsing a worktree section never affects the parent
  // project's open/closed state.
  toggleWorktreeSection: (sectionId) => {
    set((state) => {
      const next = new Set(state.collapsedWorktreeSections)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return { collapsedWorktreeSections: next }
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
    window.dplex.settings.merge({ activeProjectId: id })
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
      const isEmpty = next.selectedGitPath === undefined
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

/**
 * Sync the active project from the focused terminal tab. Whenever the user
 * activates a tab — by click, keyboard shortcut, or programmatic switch —
 * locate the project whose path matches the tab's cwd or worktree path and
 * mark it active. Mirrors what `setActiveProject` does inside ProjectItem's
 * onClick, but covers every other path that can change the focused tab.
 */
function getActiveTabPath(): string | undefined {
  const ts = useTerminalStore.getState()
  const group = ts.groups.find((g) => g.id === ts.activeGroupId)
  if (!group) return undefined
  const tab = group.tabs.find((t) => t.id === group.activeTabId)
  if (!tab || tab.kind === 'fileDiff') return undefined
  return tab.worktreePath ?? tab.cwd
}

function syncActiveProjectFromTabPath(tabPath: string | undefined): void {
  if (!tabPath) return
  const projects = useProjectStore.getState().projects
  const norm = normalizePath(tabPath)
  // Prefer an exact path match; fall back to the closest ancestor (handles
  // tabs opened in subdirectories of a project). All comparisons use the
  // platform-aware normalization so Windows backslashes and case-insensitive
  // filesystems behave correctly.
  const exact = projects.find((p) => normalizePath(p.path) === norm)
  const match =
    exact ??
    projects
      .map((p) => ({ p, n: normalizePath(p.path) }))
      .filter(({ n }) => norm === n || norm.startsWith(n + '/'))
      .sort((a, b) => b.n.length - a.n.length)[0]?.p
  if (!match) return
  // Set active. If the matched project is a worktree-child, also surface
  // its parent — selecting a tab inside a worktree should mark both.
  const store = useProjectStore.getState()
  if (store.activeProjectId !== match.id) store.setActiveProject(match.id)

  // Expand the parent project (and the worktree-section if applicable) so
  // the row that backs this tab is in the DOM, then scroll it into view.
  // Mirrors the manual "click the project to find your tab" flow.
  const parentId = match.parentProjectId
  const expanded = useProjectStore.getState().expandedProjectIds
  const next = new Set(expanded)
  let mutated = false
  // Top-level project that owns this tab (either match itself, or its parent).
  const ownerId = parentId ?? match.id
  if (!next.has(ownerId)) {
    next.add(ownerId)
    mutated = true
  }
  if (mutated) {
    useProjectStore.setState({
      expandedProjectIds: next,
      lastExpandedProjectId: ownerId
    })
  }
  // If the tab belongs to a worktree-child, make sure its section is
  // expanded too (collapsed-by-default-not-in-set semantics).
  if (parentId) {
    const collapsed = useProjectStore.getState().collapsedWorktreeSections
    if (collapsed.has(match.id)) {
      const nextCollapsed = new Set(collapsed)
      nextCollapsed.delete(match.id)
      useProjectStore.setState({ collapsedWorktreeSections: nextCollapsed })
    }
  }

  // Defer the scroll-into-view to the next frame so React has a chance to
  // mount the now-visible expanded body. Use the tab id (stable) so both
  // session rows and terminal rows can opt in.
  const ts = useTerminalStore.getState()
  const group = ts.groups.find((g) => g.id === ts.activeGroupId)
  const tabId = group?.activeTabId
  if (tabId) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-row-tab-id="${CSS.escape(tabId)}"]`)
        if (el && 'scrollIntoView' in el) {
          ;(el as HTMLElement).scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        }
      })
    })
  }
}

let prevActiveTabKey: string | null = (() => {
  const ts = useTerminalStore.getState()
  const group = ts.groups.find((g) => g.id === ts.activeGroupId)
  return group ? `${group.id}::${group.activeTabId}` : null
})()
useTerminalStore.subscribe((state) => {
  const group = state.groups.find((g) => g.id === state.activeGroupId)
  const key = group ? `${group.id}::${group.activeTabId}` : null
  if (key === prevActiveTabKey) return
  prevActiveTabKey = key
  syncActiveProjectFromTabPath(getActiveTabPath())
})
