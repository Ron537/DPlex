import { useTerminalStore } from '../stores/terminalStore'
import { useProjectStore } from '../stores/projectStore'
import { useSpaceStore } from '../stores/spaceStore'
import { getTerminalEntry } from '../services/terminalRegistry'
import { getTabProjectPath, findProjectForTab } from './tabProject'
import { pickInheritedCwd } from './pickInheritedCwd'
import type { EditorGroup } from '../types'

/**
 * Resolve the cwd to inherit from the active tab of the given group. Gathers
 * the three candidate sources (one async IPC probe, two from in-memory state)
 * and feeds them through {@link pickInheritedCwd}.
 */
async function resolveInheritedCwd(group: EditorGroup | undefined): Promise<string | undefined> {
  if (!group) return undefined
  const activeTab = group.tabs.find((t) => t.id === group.activeTabId)
  if (!activeTab) return undefined

  let liveCwd: string | null = null
  const ptyId = getTerminalEntry(activeTab.id)?.ptyId
  if (ptyId) {
    try {
      liveCwd = await window.dplex.pty.getCwd(ptyId)
    } catch {
      // Best-effort — fall through to the synchronous sources.
    }
  }

  return pickInheritedCwd({
    liveCwd,
    tabOwnPath: getTabProjectPath(activeTab),
    projectPath: findProjectForTab(activeTab, useProjectStore.getState().projects)?.path
  })
}

/** Resolve the group a new terminal/split should inherit from. */
function inheritSourceGroup(groupId: string | undefined): EditorGroup | undefined {
  const state = useTerminalStore.getState()
  const id = groupId ?? state.activeGroupId
  return state.groups.find((g) => g.id === id)
}

/**
 * Open a new terminal that inherits the focused terminal's working directory.
 * Mirrors {@link useTerminalStore}'s `createTerminal` signature for the args
 * callers actually use when opening blank terminals.
 */
export async function openInheritedTerminal(groupId?: string, shell?: string): Promise<string> {
  // The cwd probe below is an async IPC round-trip; capture the Space in focus
  // now so a switch during it routes the new terminal back to its origin (never
  // into whatever Space happens to be active when the probe resolves).
  const originSpaceId = useSpaceStore.getState().activeSpaceId
  const cwd = await resolveInheritedCwd(inheritSourceGroup(groupId))
  useSpaceStore.getState().focusForDeferredWork(originSpaceId)
  return useTerminalStore.getState().createTerminal(groupId, undefined, undefined, shell, cwd)
}

/**
 * Split the given group into a new terminal that inherits the focused
 * terminal's working directory.
 */
export async function openInheritedSplit(
  groupId: string,
  direction: 'horizontal' | 'vertical'
): Promise<string> {
  const originSpaceId = useSpaceStore.getState().activeSpaceId
  const cwd = await resolveInheritedCwd(inheritSourceGroup(groupId))
  useSpaceStore.getState().focusForDeferredWork(originSpaceId)
  return useTerminalStore.getState().splitGroup(groupId, direction, cwd)
}
