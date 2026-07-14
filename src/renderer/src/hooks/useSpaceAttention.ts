import { useMemo } from 'react'
import type { AttentionKind } from '../../../preload/attentionTypes'
import { useAttentionStore } from '../stores/attentionStore'
import { useSpaceStore } from '../stores/spaceStore'
import { useTerminalStore } from '../stores/terminalStore'
import type { Space } from '../types'
import {
  aggregateActiveAwareAttention,
  aggregateSpaceAttention,
  pickTopKind,
  type SpaceAttention
} from '../utils/spaceAttention'

/**
 * Rolled-up attention for one space. The active space reads its live session
 * tabs from the terminal store (so brand-new sessions count immediately);
 * background spaces read their stashed snapshot.
 */
export function useSpaceAttention(space: Space): SpaceAttention {
  const events = useAttentionStore((s) => s.active)
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId)
  const isActiveSpace = space.id === activeSpaceId
  // Only the active space needs live groups; subscribing background cards to
  // `groups` would recompute them all on any terminal op elsewhere.
  const liveGroups = useTerminalStore((s) => (isActiveSpace ? s.groups : null))
  return useMemo(
    () => aggregateActiveAwareAttention(space, events, liveGroups ? { groups: liveGroups } : null),
    [space, events, liveGroups]
  )
}

export interface BackgroundAttention {
  total: number
  topKind: AttentionKind | null
  /** Number of background spaces with at least one pending event. */
  spacesNeedingAttention: number
}

/**
 * Attention rolled up across every space that is NOT in focus — powers the
 * activity-bar ring / badge that pings you when a backgrounded space needs a
 * decision.
 */
export function useBackgroundAttention(): BackgroundAttention {
  const events = useAttentionStore((s) => s.active)
  const spaces = useSpaceStore((s) => s.spaces)
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId)
  return useMemo(() => {
    let approval = 0
    let input = 0
    let finished = 0
    let spacesNeedingAttention = 0
    for (const s of spaces) {
      if (s.id === activeSpaceId) continue
      const a = aggregateSpaceAttention(s, events)
      if (a.total > 0) spacesNeedingAttention += 1
      approval += a.waitingForApproval
      input += a.waitingForInput
      finished += a.finished
    }
    const total = approval + input + finished
    const topKind = pickTopKind(approval, input, finished)
    return { total, topKind, spacesNeedingAttention }
  }, [events, spaces, activeSpaceId])
}
