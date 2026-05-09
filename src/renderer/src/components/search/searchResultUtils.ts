import type { RankedItem, SearchResultGroup } from '../../services/search/types'

/** Flatten grouped results into a monotonic list. Used by keyboard
 *  navigation to scan items across category boundaries. */
export function flattenGroups(groups: SearchResultGroup[]): RankedItem[] {
  const out: RankedItem[] = []
  for (const g of groups) for (const it of g.items) out.push(it)
  return out
}

/** Total number of items across all groups. */
export function countItems(groups: SearchResultGroup[]): number {
  let n = 0
  for (const g of groups) n += g.items.length
  return n
}
