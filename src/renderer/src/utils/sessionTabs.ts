import type { TerminalTab, EditorGroup } from '../types'
import { useTerminalStore } from '../stores/terminalStore'

/**
 * Match predicate: a tab belongs to the given AI session when its
 * `sessionId` matches AND its `providerId` either matches or is undefined.
 *
 * The undefined fallback handles legacy tabs created before `providerId` was
 * tracked — we assume a single active provider per session at a time.
 */
function tabMatchesSession(t: TerminalTab, sessionId: string, providerId: string): boolean {
  return (
    t.sessionId === sessionId &&
    (t.providerId === providerId || t.providerId === undefined)
  )
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
      if (tabMatchesSession(t, sessionId, providerId)) {
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
        (resumeCommand !== undefined && t.command === resumeCommand)
    )
    if (tab) return { groupId: group.id, tab }
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
        (resumeCommand !== undefined && t.command === resumeCommand)
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
