import { useMemo } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { useTerminalStore } from '../stores/terminalStore'
import type { AISession, TerminalTab } from '../types'

/**
 * Normalize a path for comparison: resolve separators, trim trailing slashes.
 * Case-fold only on case-insensitive platforms (macOS, Windows).
 */
function normalizePath(p: string): string {
  let normalized = p.replace(/\\/g, '/').replace(/\/+$/, '')
  // Case-insensitive on macOS (darwin) and Windows (win32)
  if (typeof navigator !== 'undefined') {
    const platform = navigator.platform?.toLowerCase() ?? ''
    if (platform.includes('mac') || platform.includes('win')) {
      normalized = normalized.toLowerCase()
    }
  }
  return normalized
}

/** Check if a CWD belongs to a project path (exact match or subdirectory). */
function cwdMatchesProject(cwd: string, projectPath: string): boolean {
  const normCwd = normalizePath(cwd)
  const normProject = normalizePath(projectPath)
  return normCwd === normProject || normCwd.startsWith(normProject + '/')
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
 * Merges discovered sessions with open DPlex tabs, deduping by sessionId.
 *
 * NOTE: For O(1) per-project lookups, prefer getProjectSessionsFromIndex()
 * when rendering a list of projects. This hook is for individual project use.
 */
export function useProjectSessions(projectPath: string): ProjectActivity {
  const sessions = useSessionStore((s) => s.sessions)
  const groups = useTerminalStore((s) => s.groups)

  return useMemo(() => {
    return computeProjectActivity(sessions, groups, projectPath)
  }, [sessions, groups, projectPath])
}

/**
 * Pure function to compute project activity.
 * Used by both the hook and the batch index builder.
 */
export function computeProjectActivity(
  sessions: AISession[],
  groups: { id: string; tabs: TerminalTab[] }[],
  projectPath: string
): ProjectActivity {
  // 1. Find discovered sessions matching this project
  const matchedSessions = sessions.filter(
    (s) => s.cwd && cwdMatchesProject(s.cwd, projectPath)
  )

  // 2. Find open DPlex tabs matching this project
  const matchedTabs = groups.flatMap((g) =>
    g.tabs
      .filter((t) => t.command && t.cwd && cwdMatchesProject(t.cwd, projectPath))
      .map((t) => ({ ...t, groupId: g.id }))
  )

  // 4. Compute activity metrics
  const activeSessions = matchedSessions.filter((s) => s.status === 'active')
  // activeCount reflects sessions with known active status (not unresolved tabs)
  const activeCount = activeSessions.length
  const hasActive = activeCount > 0

  // 5. Most recent activity across all matched sessions
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
  groups: { id: string; tabs: TerminalTab[] }[],
  projectPaths: string[]
): Map<string, ProjectActivity> {
  // Sort project paths by length descending — longest match wins
  const sorted = [...projectPaths].sort((a, b) =>
    normalizePath(b).length - normalizePath(a).length
  )

  // Assign each session to the longest matching project
  const sessionsByProject = new Map<string, AISession[]>()
  const tabsByProject = new Map<string, (TerminalTab & { groupId: string })[]>()
  for (const pp of projectPaths) {
    sessionsByProject.set(pp, [])
    tabsByProject.set(pp, [])
  }

  const assignedSessionIds = new Set<string>()
  for (const s of sessions) {
    if (!s.cwd || assignedSessionIds.has(s.id)) continue
    for (const pp of sorted) {
      if (cwdMatchesProject(s.cwd, pp)) {
        sessionsByProject.get(pp)!.push(s)
        assignedSessionIds.add(s.id)
        break
      }
    }
  }

  const assignedTabIds = new Set<string>()
  const allTabs = groups.flatMap((g) =>
    g.tabs
      .filter((t) => t.command && t.cwd)
      .map((t) => ({ ...t, groupId: g.id }))
  )
  for (const tab of allTabs) {
    if (!tab.cwd || assignedTabIds.has(tab.id)) continue
    for (const pp of sorted) {
      if (cwdMatchesProject(tab.cwd, pp)) {
        tabsByProject.get(pp)!.push(tab)
        assignedTabIds.add(tab.id)
        break
      }
    }
  }

  // Build activity for each project from its assigned sessions/tabs
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
