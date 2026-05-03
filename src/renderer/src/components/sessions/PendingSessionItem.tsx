import React from 'react'
import { StatusAvatar } from '../common/StatusAvatar'
import { useTerminalStore } from '../../stores/terminalStore'

interface PendingSessionItemProps {
  /** The tab id this row represents — used to read active state from the store. */
  tabId: string
  /** Canonical provider id (e.g. "copilotCli", "claudeCode") — drives the avatar's provider badge. */
  providerId: string
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
  tabId,
  providerId,
  providerLabel,
  onClick
}: PendingSessionItemProps): React.JSX.Element {
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
              boxShadow: '0 0 0 1px rgba(167,139,250,0.18), 0 4px 12px -2px rgba(0,0,0,0.35)'
            }
          : undefined
      }
      onClick={onClick}
    >
      <div className="flex-shrink-0 mt-0.5">
        <StatusAvatar visual="thinking" providerId={providerId} title="Starting…" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className="text-[12.5px] font-medium truncate"
            style={{ color: 'var(--dplex-text)' }}
          >
            Starting…
          </span>
          <span
            className="text-[8px] font-bold px-1 rounded flex-shrink-0"
            style={{
              color: 'var(--dplex-accent)',
              backgroundColor: 'var(--dplex-accent-soft)'
            }}
          >
            OPEN
          </span>
        </div>

        <div
          className="flex items-center gap-2 mt-1 flex-wrap text-[10.5px]"
          style={{ color: 'var(--dplex-text-muted)' }}
        >
          <span>{providerLabel}</span>
        </div>
      </div>
    </div>
  )
}
