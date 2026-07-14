import { useMemo } from 'react'
import type { Space, WorkspaceSnapshot } from '../types'
import { useSpaceStore } from '../stores/spaceStore'
import { useTerminalStore } from '../stores/terminalStore'

/**
 * The resolved workspace arrangement for a space. The space in focus reads its
 * live groups from the terminal store (so counts/tabs update as you work);
 * background spaces read their stashed snapshot. Keeps every space surface
 * (switcher, panel, overview) consistent with what is actually running.
 */
export function useSpaceWorkspace(space: Space): WorkspaceSnapshot {
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId)
  const liveGroups = useTerminalStore((s) => s.groups)
  const liveLayout = useTerminalStore((s) => s.layout)
  const liveActiveGroupId = useTerminalStore((s) => s.activeGroupId)
  return useMemo(() => {
    if (space.id === activeSpaceId) {
      return { groups: liveGroups, layout: liveLayout, activeGroupId: liveActiveGroupId }
    }
    return space.workspace
  }, [space, activeSpaceId, liveGroups, liveLayout, liveActiveGroupId])
}
