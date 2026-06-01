import { useEffect, useRef } from 'react'
import type { MatchRange, RankedItem, SearchResultGroup } from '../../services/search/types'
import { TagPill } from '../projects/TagPill'

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
        className="px-5 py-8 text-center text-[12px]"
        style={{ color: 'var(--dplex-text-muted)' }}
      >
        {emptyMessage ?? 'No results'}
      </div>
    )
  }

  let flatIndex = -1
  return (
    <div role="listbox" id={listId} aria-label="Search results" className="flex flex-col">
      {groups.map((group, groupIdx) => (
        <div key={group.category} className="flex flex-col">
          {/* Solid divider between sections — sits BEFORE the label so the
              sticky label background doesn't paint over it. Uses
              `--dplex-border-strong` which is a real solid border color
              on legacy themes (Dracula, Nord, Monokai, …) and an alpha
              border on v2 themes — visible against every modal surface. */}
          {groupIdx > 0 && (
            <div
              aria-hidden
              style={{
                height: 1,
                margin: '6px 0',
                backgroundColor: 'var(--dplex-border-strong)'
              }}
            />
          )}
          <div
            className="px-5 pt-3 pb-2 text-[10px] font-semibold uppercase sticky top-0 z-[1]"
            style={{
              color: 'var(--dplex-text-faint)',
              backgroundColor: 'var(--dplex-bg-elev)',
              letterSpacing: '0.10em'
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
                className="relative flex items-center gap-3 px-5 py-2.5 cursor-pointer select-none transition-colors"
                style={{
                  // Palette rows differ from sidebar rows: the "selected"
                  // state here also fires on mouse hover (mouse moves the
                  // keyboard cursor), so it reads as a transient highlight
                  // rather than a persistent selection. Use an elevated
                  // background — no accent stripe / glow — so it doesn't
                  // borrow the v2 "active item" vocabulary that project
                  // rows / activity bar / tab stripe reserve for sticky
                  // selection.
                  backgroundColor: isSelected ? 'var(--dplex-bg-elev-2)' : 'transparent',
                  color: 'var(--dplex-text)'
                }}
                data-testid="search-result"
                data-search-item-id={ranked.item.id}
              >
                {ranked.item.icon && (
                  <span className="flex-shrink-0 flex items-center">{ranked.item.icon}</span>
                )}
                <div className="flex-1 min-w-0">
                  <div
                    className="text-[13px] truncate"
                    style={{ fontWeight: 500, lineHeight: 1.35 }}
                  >
                    <HighlightedText text={ranked.item.label} ranges={ranked.ranges} />
                  </div>
                  {ranked.item.description && (
                    <div
                      className="text-[11px] truncate"
                      style={{ color: 'var(--dplex-text-dim)', marginTop: 1, lineHeight: 1.4 }}
                    >
                      {ranked.item.description}
                    </div>
                  )}
                  {ranked.item.tags && ranked.item.tags.length > 0 && (
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      {ranked.item.tags.map((t) => (
                        <TagPill key={t} tag={t} compact variant="dot" />
                      ))}
                    </div>
                  )}
                </div>
                {ranked.item.hint && (
                  <kbd
                    className="text-[10px] flex-shrink-0 ml-2 font-medium tabular-nums"
                    style={{
                      color: 'var(--dplex-text-2)',
                      backgroundColor: 'var(--dplex-bg-elev-2)',
                      border: '1px solid var(--dplex-border)',
                      borderRadius: 4,
                      padding: '2px 6px',
                      fontFamily: 'var(--dplex-font-mono)',
                      fontWeight: 500
                    }}
                  >
                    {ranked.item.hint}
                  </kbd>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
