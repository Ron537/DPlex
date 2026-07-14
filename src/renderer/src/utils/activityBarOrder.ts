import type { ActivityBarId } from '../types'

/**
 * Canonical default order of the activity-bar view icons. Spaces leads by
 * design — it is the primary "where am I working" surface — followed by the
 * remaining views. This is also the source of truth for the full set of valid
 * {@link ActivityBarId}s used to reconcile any persisted order.
 */
export const DEFAULT_ACTIVITY_BAR_ORDER: readonly ActivityBarId[] = [
  'spaces',
  'projects',
  'sessions',
  'explorer',
  'git',
  'search'
]

/**
 * Normalize a persisted (or partial/stale) order against the canonical set:
 * keep the known ids in their saved order, drop anything unknown or duplicated,
 * then append any canonical ids the saved order is missing. This keeps the rail
 * complete and de-duplicated even as views are added or removed across
 * versions, without ever losing the user's chosen order for the ids they did
 * arrange.
 */
export function reconcileActivityBarOrder(
  saved: readonly ActivityBarId[] | undefined | null,
  canonical: readonly ActivityBarId[] = DEFAULT_ACTIVITY_BAR_ORDER
): ActivityBarId[] {
  const allowed = new Set(canonical)
  const seen = new Set<ActivityBarId>()
  const result: ActivityBarId[] = []
  for (const id of saved ?? []) {
    if (allowed.has(id) && !seen.has(id)) {
      seen.add(id)
      result.push(id)
    }
  }
  for (const id of canonical) {
    if (!seen.has(id)) {
      seen.add(id)
      result.push(id)
    }
  }
  return result
}

/**
 * Move `draggedId` to sit relative to `targetId` (classic remove-then-insert
 * array move, matching the tab reorder). `position` picks the edge of the
 * target the item lands on — `'before'` (default) or `'after'` — which lets a
 * vertical rail reach every slot, including the very end. Returns a new array.
 * No-ops (returning a copy of the input) when either id is absent or they are
 * the same, so a drop onto self never churns state.
 */
export function reorderActivityBar(
  order: readonly ActivityBarId[],
  draggedId: ActivityBarId,
  targetId: ActivityBarId,
  position: 'before' | 'after' = 'before'
): ActivityBarId[] {
  if (draggedId === targetId) return order.slice()
  const fromIndex = order.indexOf(draggedId)
  const targetIndex = order.indexOf(targetId)
  if (fromIndex === -1 || targetIndex === -1) return order.slice()
  const next = order.slice()
  next.splice(fromIndex, 1)
  const insertAt = next.indexOf(targetId) + (position === 'after' ? 1 : 0)
  next.splice(insertAt, 0, draggedId)
  return next
}
