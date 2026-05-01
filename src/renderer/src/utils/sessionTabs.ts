import type { TerminalTab, EditorTab, EditorGroup } from '../types'
import { isTerminalTab } from '../types'
import { useTerminalStore } from '../stores/terminalStore'
import { normalizePath } from './normalizePath'

function tabMatchesSession(t: EditorTab, sessionId: string, providerId: string): boolean {
  if (!isTerminalTab(t)) return false
  return t.sessionId === sessionId && (t.providerId === providerId || t.providerId === undefined)
}

/**
 * Find all tabs in `groups` that represent the given AI session.
 * Pure — no store or DOM access, so it can be unit-tested directly.
 */
export function findTabsForSession(
  groups: EditorGroup[],
  sessionId: string,
  providerId: string
): TerminalTab[] {
  const matches: TerminalTab[] = []
  for (const group of groups) {
    for (const t of group.tabs) {
      if (tabMatchesSession(t, sessionId, providerId) && isTerminalTab(t)) {
        matches.push(t)
      }
    }
  }
  return matches
}

/**
 * Find the first tab representing the given AI session. Optionally falls back
 * to a `resumeCommand` match (used by SessionItem for legacy tabs that were
 * launched directly with the provider's resume command string).
 *
 * Returns the `{ groupId, tab }` pair or `null` if no tab matches. Pure.
 */
export function findFirstTabForSession(
  groups: EditorGroup[],
  sessionId: string,
  providerId: string,
  resumeCommand?: string
): { groupId: string; tab: TerminalTab } | null {
  for (const group of groups) {
    const tab = group.tabs.find(
      (t) =>
        tabMatchesSession(t, sessionId, providerId) ||
        (resumeCommand !== undefined && isTerminalTab(t) && t.command === resumeCommand)
    )
    if (tab && isTerminalTab(tab)) return { groupId: group.id, tab }
  }
  return null
}

/**
 * Store-aware: focus an existing tab for the given AI session (if any).
 * Returns `true` if a tab was found and focused.
 */
export function focusSessionTab(
  sessionId: string,
  providerId: string,
  resumeCommand?: string
): boolean {
  const { groups, setActiveGroup, setActiveTerminalInGroup } = useTerminalStore.getState()
  const match = findFirstTabForSession(groups, sessionId, providerId, resumeCommand)
  if (!match) return false
  setActiveGroup(match.groupId)
  setActiveTerminalInGroup(match.groupId, match.tab.id)
  return true
}

/**
 * Store-aware: close any tabs representing the given AI session.
 *
 * Accepts an optional `resumeCommand` to also match legacy tabs that were
 * persisted with only a `command` (e.g. restored from workspace) before
 * `sessionId`/`providerId` were tracked.
 */
export function closeOpenTabsForSession(
  sessionId: string,
  providerId: string,
  resumeCommand?: string
): boolean {
  const { groups, closeTerminal } = useTerminalStore.getState()
  const matchIds = new Set<string>()
  for (const group of groups) {
    for (const t of group.tabs) {
      if (
        tabMatchesSession(t, sessionId, providerId) ||
        (resumeCommand !== undefined && isTerminalTab(t) && t.command === resumeCommand)
      ) {
        matchIds.add(t.id)
      }
    }
  }
  matchIds.forEach((id) => closeTerminal(id))
  return matchIds.size > 0
}

/** Store-aware: does any open tab represent the given AI session? */
export function hasOpenTab(sessionId: string, providerId: string): boolean {
  const { groups } = useTerminalStore.getState()
  return findTabsForSession(groups, sessionId, providerId).length > 0
}

/**
 * Store-aware: focus the first existing tab whose `worktreePath` (or `cwd`)
 * matches one of the supplied project paths. Skips if the currently focused
 * tab already belongs to this set so the user isn't ripped away from a
 * sibling tab they intentionally selected.
 *
 * Callers compute `paths` themselves (project path + worktree children) to
 * keep this util free of `projectStore` imports — important for module
 * load order in tests and to avoid cross-store cycles.
 *
 * Path comparison uses {@link normalizePath} so Windows backslashes and
 * case-insensitive filesystems are handled consistently with the rest of
 * the codebase.
 *
 * Returns `true` when a matching tab was focused.
 */
export function focusFirstTabForPaths(paths: Set<string>): boolean {
  if (paths.size === 0) return false
  const normPaths = new Set<string>()
  for (const p of paths) normPaths.add(normalizePath(p))
  const ts = useTerminalStore.getState()
  const activeGroup = ts.groups.find((g) => g.id === ts.activeGroupId)
  const activeTab = activeGroup?.tabs.find((t) => t.id === activeGroup.activeTabId)
  if (activeTab && isTerminalTab(activeTab)) {
    const tp = activeTab.worktreePath ?? activeTab.cwd
    if (tp && normPaths.has(normalizePath(tp))) return true
  }
  for (const group of ts.groups) {
    for (const tab of group.tabs) {
      if (!isTerminalTab(tab)) continue
      const tp = tab.worktreePath ?? tab.cwd
      if (tp && normPaths.has(normalizePath(tp))) {
        ts.setActiveGroup(group.id)
        ts.setActiveTerminalInGroup(group.id, tab.id)
        return true
      }
    }
  }
  return false
}
