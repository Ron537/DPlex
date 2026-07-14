import { useCallback, useEffect, useMemo, useState } from 'react'
import { defaultRegistry } from '../../services/search'
import type { SearchCategory, SearchResultGroup } from '../../services/search/types'
import { useProjectStore } from '../../stores/projectStore'
import { useSpaceStore } from '../../stores/spaceStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { countItems, flattenGroups } from './searchResultUtils'

interface UseGlobalSearchOptions {
  enabled: boolean
  /** Restrict results to these categories. Undefined = all. */
  categories?: ReadonlyArray<SearchCategory>
  /** Override the per-group cap (typed-query results). */
  maxPerGroup?: number
  /** Override the cap applied when the query is empty. */
  emptyQueryLimit?: number
}

interface GlobalSearchState {
  query: string
  setQuery: (q: string) => void
  groups: SearchResultGroup[]
  selectedIndex: number
  setSelectedIndex: (n: number) => void
  /** Move selection by `delta` rows (clamped to bounds). */
  moveSelection: (delta: number) => void
  /** Activate the item at the current `selectedIndex`. */
  activateSelected: () => void
  totalItems: number
}

/**
 * Owns search input state + result freshness for one surface (modal or side
 * panel). Subscribes to the source stores so results update live.
 */
export function useGlobalSearch({
  enabled,
  categories,
  maxPerGroup,
  emptyQueryLimit
}: UseGlobalSearchOptions): GlobalSearchState {
  const [query, setQueryRaw] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Reset query + selection whenever the surface re-opens. Synchronizing
  // transient UI with an external open/close signal is the canonical
  // exception to the no-setState-in-effect rule.
  useEffect(() => {
    if (enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQueryRaw('')
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedIndex(0)
    }
  }, [enabled])

  // Wrap setQuery so a fresh query always resets the selection back to the
  // first match — otherwise typing while a low-down row is highlighted
  // would activate a stale row on Enter.
  const setQuery = useCallback((next: string) => {
    setQueryRaw(next)
    setSelectedIndex(0)
  }, [])

  // Subscribe to the upstream stores so results recompute when their data
  // changes (e.g. user adds a project while the palette is open).
  const projects = useProjectStore((s) => s.projects)
  const spaces = useSpaceStore((s) => s.spaces)
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId)
  const sessions = useSessionStore((s) => s.sessions)
  const groups = useTerminalStore((s) => s.groups)
  const activeGroupId = useTerminalStore((s) => s.activeGroupId)

  const ctx = useMemo(
    () => ({ projects, spaces, activeSpaceId, sessions, groups, activeGroupId }),
    [projects, spaces, activeSpaceId, sessions, groups, activeGroupId]
  )

  // While the surface is closed, skip work entirely.
  const results: SearchResultGroup[] = useMemo(() => {
    if (!enabled) return []
    return defaultRegistry.run(query, ctx, {
      categories: categories ?? undefined,
      maxPerGroup,
      emptyQueryLimit
    })
  }, [enabled, query, ctx, categories, maxPerGroup, emptyQueryLimit])

  const total = countItems(results)
  // Clamp the selection during render rather than via a sync effect — this
  // avoids the cascading-render anti-pattern when results shrink.
  const effectiveSelected = total === 0 ? 0 : Math.min(Math.max(selectedIndex, 0), total - 1)

  const moveSelection = useCallback(
    (delta: number) => {
      setSelectedIndex((prev) => {
        if (total === 0) return 0
        const base = Math.min(Math.max(prev, 0), total - 1)
        let next = base + delta
        if (next < 0) next = 0
        if (next > total - 1) next = total - 1
        return next
      })
    },
    [total]
  )

  const activateSelected = useCallback(() => {
    const flat = flattenGroups(results)
    const target = flat[effectiveSelected]
    if (!target) return
    void Promise.resolve(target.item.run())
  }, [results, effectiveSelected])

  return {
    query,
    setQuery,
    groups: results,
    selectedIndex: effectiveSelected,
    setSelectedIndex,
    moveSelection,
    activateSelected,
    totalItems: total
  }
}
