import type { JSX } from 'react'
import { useTerminalStore } from '../../stores/terminalStore'
import { StatusDot } from '../common/StatusDot'

interface TerminalRowProps {
  /** The tab id this row represents — used to read active state from the store. */
  tabId: string
  /** Display title — taken from the terminal tab's title field. */
  title: string
  onClick: () => void
}

/**
 * Plain-terminal row inside a project's expanded body. Shares the
 * single-line compact rhythm of `SessionItem.compact` so AI sessions
 * and shells line up in a mixed list. The leading status dot is muted
 * (no live state) and the avatar slot is a small mono `>_` glyph so a
 * glance separates "ephemeral shell" from "AI session card".
 */
export function TerminalRow({ tabId, title, onClick }: TerminalRowProps): JSX.Element {
  const isActiveTab = useTerminalStore((s) => {
    const group = s.groups.find((g) => g.id === s.activeGroupId)
    return group?.activeTabId === tabId
  })
  return (
    <div
      data-row-tab-id={tabId}
      className="group flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--dplex-hover)] cursor-pointer rounded-md mx-1"
      style={
        isActiveTab
          ? {
              backgroundColor: 'var(--dplex-accent-faint)',
              boxShadow: '0 0 0 1px var(--dplex-accent-ring), 0 4px 12px -2px rgba(0,0,0,0.35)'
            }
          : undefined
      }
      onClick={onClick}
    >
      <StatusDot visual="terminal" title="Terminal" />
      <span
        aria-hidden
        title="Terminal"
        className="flex-shrink-0 inline-flex items-center justify-center"
        style={{
          width: 16,
          height: 16,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '-0.04em',
          color: 'var(--dplex-text-dim)'
        }}
      >
        {'>_'}
      </span>
      <span
        className="text-[12.5px] truncate flex-1 min-w-0"
        style={{ color: 'var(--dplex-text)', fontWeight: 500 }}
      >
        {title}
      </span>
    </div>
  )
}

