import type { TerminalTab, EditorTab, EditorGroup, AISession } from '../types'
import { isTerminalTab } from '../types'
import { useTerminalStore } from '../stores/terminalStore'
import {
  useSpaceStore,
  findBackgroundSessionTab,
  closeBackgroundSessionTabs
} from '../stores/spaceStore'
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
 * Searches the active space first, then every backgrounded space — a session
 * parked in the background is switched into focus (which keeps every session
 * running) and focused, rather than being treated as gone.
 * Returns `true` if a tab was found and focused.
 */
export function focusSessionTab(
  sessionId: string,
  providerId: string,
  resumeCommand?: string
): boolean {
  const { groups, setActiveGroup, setActiveTerminalInGroup } = useTerminalStore.getState()
  const match = findFirstTabForSession(groups, sessionId, providerId, resumeCommand)
  if (match) {
    setActiveGroup(match.groupId)
    setActiveTerminalInGroup(match.groupId, match.tab.id)
    return true
  }
  // Not in the active space — it may be parked in a background space. Bring that
  // space into focus (never restarts sessions) and focus the tab there.
  const bg = findBackgroundSessionTab(sessionId, providerId, resumeCommand)
  if (bg) {
    useSpaceStore.getState().switchSpace(bg.spaceId)
    const ts = useTerminalStore.getState()
    ts.setActiveGroup(bg.groupId)
    ts.setActiveTerminalInGroup(bg.groupId, bg.tabId)
    return true
  }
  return false
}

/**
 * Store-aware: close any tabs representing the given AI session, across the
 * active space AND every backgrounded space (so deleting a session from the
 * Sessions list never leaves a dangling parked tab).
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
  const closedBackground = closeBackgroundSessionTabs(sessionId, providerId, resumeCommand)
  return matchIds.size > 0 || closedBackground
}

/** Store-aware: does any open tab (in any space) represent the given AI session? */
export function hasOpenTab(sessionId: string, providerId: string): boolean {
  const { groups } = useTerminalStore.getState()
  if (findTabsForSession(groups, sessionId, providerId).length > 0) return true
  return findBackgroundSessionTab(sessionId, providerId) !== null
}

/**
 * Store-aware: resume an AI session. Focuses an existing tab backing the
 * session if one is open; otherwise spawns a new terminal running the
 * provider's resume command. No-op if the provider can't produce a resume
 * command. Shared by every "click a session row to open it" surface
 * (`SessionItem`, `RecentSessionRow`, `ExternalSessionRow`) so the
 * focus-then-spawn behaviour stays identical across them.
 */
export async function resumeOrFocusSession(
  session: Pick<AISession, 'id' | 'aiTool' | 'displayName' | 'cwd'>
): Promise<void> {
  // Capture the Space in focus at request time: getResumeCommand is async and
  // the user may switch Spaces during that gap. Without this, a newly spawned
  // resume terminal would land in whatever Space happens to be active when the
  // command resolves instead of the one the user launched it from.
  const originSpaceId = useSpaceStore.getState().activeSpaceId
  const cmd = await window.dplex.sessions.getResumeCommand(session.aiTool, session.id)
  if (focusSessionTab(session.id, session.aiTool, cmd ?? undefined)) return
  if (!cmd) return
  useSpaceStore.getState().focusForDeferredWork(originSpaceId)
  useTerminalStore
    .getState()
    .createTerminal(
      undefined,
      `↻ ${session.displayName}`,
      cmd,
      undefined,
      session.cwd,
      session.aiTool
    )
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
