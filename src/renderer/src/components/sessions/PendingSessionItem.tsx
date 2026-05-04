import React from 'react'
import { useTerminalStore } from '../../stores/terminalStore'
import { StatusDot } from '../common/StatusDot'
import { ProviderGlyph } from '../common/ProviderGlyph'
import type { ProviderId } from '../../utils/providerHelpers'

interface PendingSessionItemProps {
  /** The tab id this row represents — used to read active state from the store. */
  tabId: string
  /** Canonical provider id (e.g. "copilotCli", "claudeCode") — drives the provider glyph. */
  providerId: string
  /** Provider display name (e.g. "Claude Code", "Copilot CLI"). */
  providerLabel: string
  onClick: () => void
}

/**
 * Placeholder row shown in the project list for an AI session tab whose
 * backing session file hasn't appeared yet. Matches the compact
 * single-line rhythm of `SessionItem.compact` so it lines up with sibling
 * AI session rows. The status dot pulses (thinking) and the title reads
 * "Starting…" until the real session record materialises.
 *
 * Used primarily for Claude Code, which only writes its session JSONL
 * after the first user message.
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
      <StatusDot visual="thinking" title="Starting…" />
      <ProviderGlyph providerId={providerId as ProviderId} size="xs" title={providerLabel} />
      <span
        className="text-[12.5px] truncate flex-1 min-w-0"
        style={{ color: 'var(--dplex-text)', fontWeight: 500 }}
      >
        Starting…
      </span>
    </div>
  )
}
