import React from 'react'
import { STATUS_ACTIVE_COLOR } from '../../utils/statusColors'

interface PendingSessionItemProps {
  /** Provider display name (e.g. "Claude Code", "Copilot CLI"). */
  providerLabel: string
  onClick: () => void
}

/**
 * Placeholder card shown in the project list for an AI session tab whose
 * backing session file hasn't appeared yet. Styled to match a compact
 * SessionItem so the user immediately recognises it as an AI session
 * (with provider badge and "OPEN" pill) rather than a generic terminal.
 *
 * Used primarily for Claude Code, which only writes its session JSONL
 * after the first user message — leaving a brief window where the tab
 * exists but no `AISession` record does yet.
 */
export function PendingSessionItem({
  providerLabel,
  onClick
}: PendingSessionItemProps): React.JSX.Element {
  return (
    <div
      className="group flex items-start gap-2 px-3 py-2 hover:bg-[var(--dplex-hover)] cursor-pointer rounded-sm mx-1"
      onClick={onClick}
    >
      <div className="flex-shrink-0 mt-1.5">
        <div
          className="w-2 h-2 rounded-full"
          style={{
            backgroundColor: STATUS_ACTIVE_COLOR,
            animation: 'pulse 2s ease-in-out infinite'
          }}
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium truncate" style={{ color: 'var(--dplex-text)' }}>
            Starting…
          </span>
          <span
            className="text-[8px] font-bold px-1 rounded flex-shrink-0"
            style={{
              color: 'var(--dplex-accent)',
              backgroundColor: 'color-mix(in srgb, var(--dplex-accent) 15%, transparent)'
            }}
          >
            OPEN
          </span>
        </div>

        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span
            className="text-[9px] px-1 rounded"
            style={{
              color: 'var(--dplex-text-muted)',
              backgroundColor: 'var(--dplex-bg)',
              border: '1px solid var(--dplex-border)'
            }}
          >
            {providerLabel}
          </span>
        </div>
      </div>
    </div>
  )
}
