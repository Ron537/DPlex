import { useEffect, useRef } from 'react'
import type { MatchRange, RankedItem, SearchResultGroup } from '../../services/search/types'

interface SearchResultsListProps {
  groups: SearchResultGroup[]
  /** Index of the highlighted item across the **flattened** result list. */
  selectedIndex: number
  onSelect: (index: number) => void
  onActivate: (item: RankedItem['item']) => void
  /** DOM id used by the input for `aria-controls` / `aria-activedescendant`. */
  listId: string
  /** Empty-state message when groups is empty. */
  emptyMessage?: string
}

/** Render highlighted runs of `text` based on a sorted, non-overlapping list
 *  of {@link MatchRange}s. */
function HighlightedText({
  text,
  ranges
}: {
  text: string
  ranges: MatchRange[]
}): React.JSX.Element {
  if (ranges.length === 0) return <>{text}</>
  const out: React.ReactNode[] = []
  let cursor = 0
  ranges.forEach((r, i) => {
    if (r.start > cursor) out.push(text.slice(cursor, r.start))
    out.push(
      <mark
        key={`hl-${i}`}
        style={{
          backgroundColor: 'transparent',
          color: 'var(--dplex-accent)',
          fontWeight: 600
        }}
      >
        {text.slice(r.start, r.end)}
      </mark>
    )
    cursor = r.end
  })
  if (cursor < text.length) out.push(text.slice(cursor))
  return <>{out}</>
}

export function SearchResultsList({
  groups,
  selectedIndex,
  onSelect,
  onActivate,
  listId,
  emptyMessage
}: SearchResultsListProps): React.JSX.Element {
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  // Keep the highlighted row in view when it changes (e.g. via arrow keys).
  useEffect(() => {
    const node = itemRefs.current[selectedIndex]
    if (!node) return
    node.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (groups.length === 0) {
    return (
      <div
        className="px-4 py-6 text-center text-[12px]"
        style={{ color: 'var(--dplex-text-muted)' }}
      >
        {emptyMessage ?? 'No results'}
      </div>
    )
  }

  let flatIndex = -1
  return (
    <div
      role="listbox"
      id={listId}
      aria-label="Search results"
      className="flex flex-col"
    >
      {groups.map((group, groupIdx) => (
        <div key={group.category} className="flex flex-col">
          <div
            className="px-3 pt-2 pb-1.5 text-[10px] font-bold uppercase tracking-wider sticky top-0 z-[1]"
            style={{
              color: 'var(--dplex-text-muted)',
              backgroundColor: 'var(--dplex-activity-bar-bg)',
              borderTop:
                groupIdx === 0 ? 'none' : '1px solid var(--dplex-border-strong)',
              borderBottom: '1px solid var(--dplex-border)',
              letterSpacing: '0.1em'
            }}
          >
            {group.label}
          </div>
          {group.items.map((ranked) => {
            flatIndex++
            const myIndex = flatIndex
            const isSelected = myIndex === selectedIndex
            const optionId = `${listId}-opt-${myIndex}`
            return (
              <div
                key={ranked.item.id}
                ref={(el) => {
                  itemRefs.current[myIndex] = el
                }}
                id={optionId}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => onSelect(myIndex)}
                onClick={() => onActivate(ranked.item)}
                className="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none"
                style={{
                  backgroundColor: isSelected ? 'var(--dplex-accent-soft)' : 'transparent',
                  color: 'var(--dplex-text)'
                }}
                data-testid="search-result"
                data-search-item-id={ranked.item.id}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] truncate">
                    <HighlightedText text={ranked.item.label} ranges={ranked.ranges} />
                  </div>
                  {ranked.item.description && (
                    <div
                      className="text-[10.5px] truncate"
                      style={{ color: 'var(--dplex-text-muted)' }}
                    >
                      {ranked.item.description}
                    </div>
                  )}
                </div>
                {ranked.item.hint && (
                  <span
                    className="text-[10.5px] flex-shrink-0 ml-2"
                    style={{ color: 'var(--dplex-text-dim)' }}
                  >
                    {ranked.item.hint}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
