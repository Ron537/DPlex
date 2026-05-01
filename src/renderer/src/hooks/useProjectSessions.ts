import { useMemo } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { useTerminalStore } from '../stores/terminalStore'
import { useProjectStore } from '../stores/projectStore'
import type { AISession, TerminalTab, EditorTab } from '../types'
import { isTerminalTab } from '../types'
import { normalizePath } from '../utils/normalizePath'

// Re-exported so existing call sites that import `normalizePath` from this
// module keep working. New code should import directly from
// `../utils/normalizePath` to avoid pulling in the project/terminal stores.
export { normalizePath }

/**
 * Pick the registered project whose path is the longest prefix of cwd.
 * Each worktree is registered as its own project in the new model, so
 * we no longer need a worktree-aware remap layer — a plain path-prefix
 * match is both sufficient and more predictable.
 */
function findMatchingProject(cwd: string, sortedProjects: string[]): string | null {
  const norm = normalizePath(cwd)
  for (const pp of sortedProjects) {
    const n = normalizePath(pp)
    if (norm === n || norm.startsWith(n + '/')) return pp
  }
  return null
}

export interface ProjectActivity {
  /** AI sessions discovered by providers that match this project's CWD. */
  sessions: AISession[]
  /** DPlex terminal tabs (with AI commands) that match this project's CWD. */
  openTabs: (TerminalTab & { groupId: string })[]
  /** Count of active (non-idle) sessions + open tabs (deduped). */
  activeCount: number
  /** Whether any session or tab is actively running. */
  hasActive: boolean
  /** Most recent activity timestamp (uses lastActivityTime, falls back to updatedAt). */
  lastActivity: Date | undefined
}

/**
 * Derives project activity from sessionStore + terminalStore.
 *
 * NOTE: For O(1) per-project lookups, prefer getProjectSessionsFromIndex()
 * when rendering a list of projects. This hook is for individual project use.
 */
export function useProjectSessions(projectPath: string): ProjectActivity {
  const sessions = useSessionStore((s) => s.sessions)
  const groups = useTerminalStore((s) => s.groups)
  const projects = useProjectStore((s) => s.projects)
  const allProjectPaths = useMemo(() => projects.map((p) => p.path), [projects])

  return useMemo(() => {
    return computeProjectActivity(sessions, groups, projectPath, allProjectPaths)
  }, [sessions, groups, projectPath, allProjectPaths])
}

/**
 * Pure function to compute project activity.
 * Used by both the hook and the batch index builder.
 */
export function computeProjectActivity(
  sessions: AISession[],
  groups: { id: string; tabs: EditorTab[] }[],
  projectPath: string,
  allProjectPaths: string[] = [projectPath]
): ProjectActivity {
  const sortedProjects = [...allProjectPaths].sort(
    (a, b) => normalizePath(b).length - normalizePath(a).length
  )
  const matchesThisProject = (cwd: string): boolean => {
    return findMatchingProject(cwd, sortedProjects) === projectPath
  }

  const matchedSessions = sessions.filter((s) => s.cwd && matchesThisProject(s.cwd))

  const matchedTabs = groups.flatMap((g) =>
    g.tabs
      .filter(isTerminalTab)
      .filter((t) => t.cwd && matchesThisProject(t.cwd))
      .map((t) => ({ ...t, groupId: g.id }))
  )

  const activeSessions = matchedSessions.filter((s) => s.status === 'active')
  const activeCount = activeSessions.length
  const hasActive = activeCount > 0

  const lastActivity = matchedSessions.reduce<Date | undefined>((latest, s) => {
    const time = s.lastActivityTime ? new Date(s.lastActivityTime) : s.updatedAt
    return !latest || time > latest ? time : latest
  }, undefined)

  return {
    sessions: matchedSessions,
    openTabs: matchedTabs,
    activeCount,
    hasActive,
    lastActivity
  }
}

/**
 * Build an index of sessions grouped by project path.
 * Each session/tab is assigned to the longest matching project (no double-counting).
 * Call once in ProjectList, pass slices to each ProjectItem.
 */
export function buildProjectSessionIndex(
  sessions: AISession[],
  groups: { id: string; tabs: EditorTab[] }[],
  projectPaths: string[]
): Map<string, ProjectActivity> {
  const sorted = [...projectPaths].sort((a, b) => normalizePath(b).length - normalizePath(a).length)

  const sessionsByProject = new Map<string, AISession[]>()
  const tabsByProject = new Map<string, (TerminalTab & { groupId: string })[]>()
  for (const pp of projectPaths) {
    sessionsByProject.set(pp, [])
    tabsByProject.set(pp, [])
  }

  for (const s of sessions) {
    if (!s.cwd) continue
    const matched = findMatchingProject(s.cwd, sorted)
    if (matched) sessionsByProject.get(matched)!.push(s)
  }

  const allTabs = groups.flatMap((g) =>
    g.tabs
      .filter(isTerminalTab)
      .filter((t) => t.cwd)
      .map((t) => ({ ...t, groupId: g.id }))
  )
  for (const tab of allTabs) {
    if (!tab.cwd) continue
    const matched = findMatchingProject(tab.cwd, sorted)
    if (matched) tabsByProject.get(matched)!.push(tab)
  }

  const index = new Map<string, ProjectActivity>()
  for (const pp of projectPaths) {
    const matchedSessions = sessionsByProject.get(pp)!
    const matchedTabs = tabsByProject.get(pp)!

    const activeSessions = matchedSessions.filter((s) => s.status === 'active')
    const activeCount = activeSessions.length
    const hasActive = activeCount > 0

    const lastActivity = matchedSessions.reduce<Date | undefined>((latest, s) => {
      const time = s.lastActivityTime ? new Date(s.lastActivityTime) : s.updatedAt
      return !latest || time > latest ? time : latest
    }, undefined)

    index.set(pp, {
      sessions: matchedSessions,
      openTabs: matchedTabs,
      activeCount,
      hasActive,
      lastActivity
    })
  }

  return index
}
