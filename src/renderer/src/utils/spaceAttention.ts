import type { AttentionEvent, AttentionKind } from '../../../preload/attentionTypes'
import { makeCompositeId } from '../../../preload/attentionTypes'
import type { Space, WorkspaceSnapshot } from '../types'
import { isTerminalTab } from '../types'

/**
 * Rolled-up attention for a single Space. Aggregated from the shared attention
 * snapshot (keyed by `providerId:sessionId`) filtered to the space's own
 * sessions — so a backgrounded space still reports approvals/input waiting on
 * it with no extra plumbing. DPlex only reads the attention *signal*; it never
 * inspects session content.
 */
export interface SpaceAttention {
  waitingForApproval: number
  waitingForInput: number
  finished: number
  /** Sum of the three counts above. */
  total: number
  /** Highest-priority kind present (approval > input > finished), for the
   *  ring / badge color. Null when the space needs no attention. */
  topKind: AttentionKind | null
}

export const EMPTY_SPACE_ATTENTION: SpaceAttention = {
  waitingForApproval: 0,
  waitingForInput: 0,
  finished: 0,
  total: 0,
  topKind: null
}

/** Human label for an attention kind. Title-case by default (standalone
 *  badges); pass `lower` for mid-sentence use (e.g. toast bodies). */
const ATTENTION_KIND_LABEL: Record<AttentionKind, string> = {
  waitingForApproval: 'Needs approval',
  waitingForInput: 'Waiting for you',
  finished: 'Finished'
}

export function attentionKindLabel(kind: AttentionKind, lower = false): string {
  const label = ATTENTION_KIND_LABEL[kind]
  return lower ? label.toLowerCase() : label
}

/** Highest-priority attention kind present, approval > input > finished.
 *  Null when nothing needs attention. Single source of the ordering ladder. */
export function pickTopKind(
  waitingForApproval: number,
  waitingForInput: number,
  finished: number
): AttentionKind | null {
  if (waitingForApproval > 0) return 'waitingForApproval'
  if (waitingForInput > 0) return 'waitingForInput'
  if (finished > 0) return 'finished'
  return null
}

/** Composite attention ids (`providerId:sessionId`) for every AI session tab
 *  in a workspace snapshot. Only `groups` is read, so callers may pass live
 *  terminal-store groups directly. */
export function collectSessionCompositeIds(
  snapshot: Pick<WorkspaceSnapshot, 'groups'>
): Set<string> {
  const ids = new Set<string>()
  for (const g of snapshot.groups) {
    for (const t of g.tabs) {
      if (isTerminalTab(t) && t.providerId && t.sessionId) {
        ids.add(makeCompositeId(t.providerId, t.sessionId))
      }
    }
  }
  return ids
}

/** Aggregate attention events for the given set of composite session ids.
 *  Suppressed (dismissed) events are ignored. Pure — safe to unit test. */
export function aggregateAttention(
  events: readonly AttentionEvent[],
  ids: ReadonlySet<string>
): SpaceAttention {
  if (ids.size === 0) return EMPTY_SPACE_ATTENTION
  let waitingForApproval = 0
  let waitingForInput = 0
  let finished = 0
  for (const e of events) {
    if (e.suppressed) continue
    if (!ids.has(e.compositeId)) continue
    if (e.kind === 'waitingForApproval') waitingForApproval += 1
    else if (e.kind === 'waitingForInput') waitingForInput += 1
    else if (e.kind === 'finished') finished += 1
  }
  const total = waitingForApproval + waitingForInput + finished
  const topKind = pickTopKind(waitingForApproval, waitingForInput, finished)
  return { waitingForApproval, waitingForInput, finished, total, topKind }
}

/** Roll up attention for a single space from its own session tabs. Reads the
 *  space's stashed snapshot — correct for background spaces, but stale for the
 *  space in focus (whose live tabs live in the terminal store). Prefer
 *  {@link aggregateActiveAwareAttention} when the active space may be involved. */
export function aggregateSpaceAttention(
  space: Space,
  events: readonly AttentionEvent[]
): SpaceAttention {
  return aggregateAttention(events, collectSessionCompositeIds(space.workspace))
}

/**
 * High-water mark for a space's pending (non-suppressed) attention: the newest
 * `createdAt` among the events currently needing attention on this space's
 * sessions, or 0 when nothing pends. Each raised request carries a fresh
 * timestamp, so this rises only when a genuinely new request arrives — letting
 * a dismissed toast stay hidden while existing requests persist or partially
 * resolve, and reappear the moment something new pings.
 */
export function spaceAttentionHighWater(space: Space, events: readonly AttentionEvent[]): number {
  const ids = collectSessionCompositeIds(space.workspace)
  if (ids.size === 0) return 0
  let max = 0
  for (const e of events) {
    if (e.suppressed) continue
    if (!ids.has(e.compositeId)) continue
    if (e.createdAt > max) max = e.createdAt
  }
  return max
}

/**
 * Roll up attention for a space, preferring the live terminal groups for the
 * space in focus (so a brand-new session counts immediately, before the next
 * snapshot is stashed) and the stashed snapshot for background spaces. Pass the
 * terminal store's live `groups` for the active space, or `null` otherwise.
 */
export function aggregateActiveAwareAttention(
  space: Space,
  events: readonly AttentionEvent[],
  activeGroups: Pick<WorkspaceSnapshot, 'groups'> | null
): SpaceAttention {
  const ids = activeGroups
    ? collectSessionCompositeIds(activeGroups)
    : collectSessionCompositeIds(space.workspace)
  return aggregateAttention(events, ids)
}
