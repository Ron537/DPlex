import type { JSX } from 'react'
import { useTerminalStore } from '../../stores/terminalStore'

interface TerminalRowProps {
  /** The tab id this row represents — used to read active state from the store. */
  tabId: string
  /** Display title — taken from the terminal tab's title field. */
  title: string
  onClick: () => void
}

/**
 * Plain-terminal row inside a project's expanded body. Shares the row
 * rhythm of `SessionItem.compact` (same gap, same two-line typography)
 * but uses a deliberately distinct avatar — transparent dashed-border
 * card with a mono `>_` glyph — so a glance separates "ephemeral shell"
 * from "AI session card" in a mixed list.
 *
 * The meta line shows the literal "Terminal" where AI rows show their
 * provider name. No relative-time suffix because terminal tabs don't
 * carry a meaningful "last activity" — they're either focused or not.
 */
export function TerminalRow({ tabId, title, onClick }: TerminalRowProps): JSX.Element {
  const isActiveTab = useTerminalStore((s) => {
    const group = s.groups.find((g) => g.id === s.activeGroupId)
    return group?.activeTabId === tabId
  })
  return (
    <div
      data-row-tab-id={tabId}
      className="group flex items-start gap-2.5 px-3 py-2 hover:bg-[var(--dplex-hover)] cursor-pointer rounded-md mx-1"
      style={
        isActiveTab
          ? {
              boxShadow: '0 0 0 1px rgba(123,162,255,0.18), 0 4px 12px -2px rgba(0,0,0,0.35)'
            }
          : undefined
      }
      onClick={onClick}
    >
      <div className="flex-shrink-0 mt-0.5">
        <span className="dplex-term-av" aria-hidden title="Terminal">
          {'>_'}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className="text-[12.5px] font-medium truncate"
            style={{ color: 'var(--dplex-text)' }}
          >
            {title}
          </span>
        </div>
        <div
          className="flex items-center gap-2 mt-0.5 flex-wrap text-[10.5px]"
          style={{ color: 'var(--dplex-text-muted)' }}
        >
          <span>Terminal</span>
        </div>
      </div>
    </div>
  )
}
