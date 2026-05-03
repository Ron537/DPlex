import type { JSX } from 'react'
import type { AISession, ProviderInfo } from '../../types'
import { SessionItem } from '../sessions/SessionItem'
import { PendingSessionItem } from '../sessions/PendingSessionItem'
import { TerminalRow } from '../sessions/TerminalRow'
import { pairTabsToSessions, type OpenTabWithGroup } from '../../utils/sessionPairing'

interface ProjectSessionListProps {
  /** Active AI sessions in this scope (a project or one of its worktrees). */
  sessions: AISession[]
  /** Open AI terminal tabs in this scope. */
  openTabs: OpenTabWithGroup[]
  /** Set when no rows would render (so callers can choose not to draw a section). */
  emptyMessage?: string
  /** Fired when the user clicks an open-tab row to focus it. */
  onFocusTab: (tabId: string, groupId: string) => void
  /** Fired when the user clicks the trash on an unpaired session row. */
  onDeleteSession: (sessionId: string) => void
  /** Fired when the user opens the prompts dialog for a session. */
  onShowPrompts: (session: AISession) => void
  /** Provider registry — used to resolve display names for pending tabs. */
  providers: ProviderInfo[]
  /**
   * When true, session rows render with a small provider corner badge.
   * Caller is responsible for computing this — typically by checking
   * `isMixedProviderList(sessions)` over the surrounding context.
   */
  showProviderBadge?: boolean
}

/**
 * Renders the paired list of (open tab ↔ AI session) rows for a project
 * scope. Pairing logic lives in `utils/sessionPairing` so this component
 * and `WorktreeSection` (which surfaces a count badge) stay consistent.
 */
export function ProjectSessionList({
  sessions,
  openTabs,
  emptyMessage,
  onFocusTab,
  onDeleteSession,
  onShowPrompts,
  providers,
  showProviderBadge
}: ProjectSessionListProps): JSX.Element {
  const hasActive = sessions.some((s) => s.status === 'active')
  if (!hasActive && openTabs.length === 0) {
    if (!emptyMessage) return <></>
    return (
      <div
        className="px-3 py-1.5 text-[10px]"
        style={{ color: 'var(--dplex-text-muted)', opacity: 0.7 }}
      >
        {emptyMessage}
      </div>
    )
  }

  const { pairs, unpaired } = pairTabsToSessions(sessions, openTabs)

  return (
    <>
      {pairs.map(({ tab, match }) =>
        match ? (
          <SessionItem
            key={tab.id}
            session={match}
            onDelete={onDeleteSession}
            onShowPrompts={onShowPrompts}
            compact
            showProviderBadge={showProviderBadge}
            onClick={() => onFocusTab(tab.id, tab.groupId)}
          />
        ) : tab.providerId ? (
          <PendingSessionItem
            key={tab.id}
            tabId={tab.id}
            providerId={tab.providerId}
            providerLabel={providers.find((p) => p.id === tab.providerId)?.name ?? tab.providerId}
            onClick={() => onFocusTab(tab.id, tab.groupId)}
          />
        ) : (
          <TerminalRow
            key={tab.id}
            tabId={tab.id}
            title={tab.title}
            onClick={() => onFocusTab(tab.id, tab.groupId)}
          />
        )
      )}
      {unpaired.map((session) => (
        <SessionItem
          key={session.id}
          session={session}
          onDelete={onDeleteSession}
          onShowPrompts={onShowPrompts}
          compact
          showProviderBadge={showProviderBadge}
        />
      ))}
    </>
  )
}
