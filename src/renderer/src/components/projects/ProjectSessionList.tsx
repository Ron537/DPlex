import { useMemo, type JSX } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import type { AISession, ProviderInfo } from '../../types'
import { SessionItem } from '../sessions/SessionItem'
import { PendingSessionItem } from '../sessions/PendingSessionItem'
import { TerminalRow } from '../sessions/TerminalRow'
import { RecentSessionRow } from '../sessions/RecentSessionRow'
import { ExternalSessionsDivider } from '../sessions/ExternalSessionsDivider'
import { pairTabsToSessions, type OpenTabWithGroup } from '../../utils/sessionPairing'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProjectStore } from '../../stores/projectStore'

/**
 * Mirrors the pairing rule in `pairTabsToSessions` so any session that a
 * tab could render above (including legacy tabs persisted without a
 * providerId) is filtered out of the "recent" surface. Exported because
 * `ProjectItem` needs it to decide whether the parent's main-checkout
 * `WorktreeSection` should render at all (otherwise a checkout with only
 * recents but no active sessions would be hidden).
 */
export function selectRecentSessions(
  sessions: readonly AISession[],
  openTabs: readonly OpenTabWithGroup[],
  opts: { limit: number; hideEmpty: boolean }
): AISession[] {
  if (opts.limit <= 0) return []
  const isCoveredByTab = (s: AISession): boolean =>
    openTabs.some((t) => t.sessionId === s.id && (!t.providerId || t.providerId === s.aiTool))
  const idle = sessions.filter(
    (s) =>
      s.status === 'idle' && !isCoveredByTab(s) && (!opts.hideEmpty || (s.messageCount ?? 0) > 0)
  )
  idle.sort((a, b) => {
    const at = a.lastActivityTime ? new Date(a.lastActivityTime).getTime() : a.updatedAt.getTime()
    const bt = b.lastActivityTime ? new Date(b.lastActivityTime).getTime() : b.updatedAt.getTime()
    return bt - at
  })
  return idle.slice(0, opts.limit)
}

interface ProjectSessionListProps {
  /** Stable id for this session-list scope (a project id for plain projects,
   *  or a worktree section id). Keys the collapsible "Idle · N resumable"
   *  rollup's per-scope expansion state in the project store. */
  scopeId: string
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
  /**
   * Override the user's "Show recent sessions" / "Recent sessions count"
   * settings. When omitted, the store values are used. Pass `recentLimit: 0`
   * (or `showRecent: false`) to disable for a specific call site.
   */
  recentLimit?: number
  showRecent?: boolean
}

/**
 * Renders the paired list of (open tab ↔ AI session) rows for a project
 * scope. Pairing logic lives in `utils/sessionPairing` so this component
 * and `WorktreeSection` (which surfaces a count badge) stay consistent.
 *
 * Below the active rows we surface up to `recentLimit` idle sessions
 * (most recent first) so the user can resume a session in this scope
 * without leaving the projects panel. Sessions that already render as
 * an open tab above are excluded to avoid duplicate rows.
 */
export function ProjectSessionList({
  scopeId,
  sessions,
  openTabs,
  emptyMessage,
  onFocusTab,
  onDeleteSession,
  onShowPrompts,
  providers,
  showProviderBadge,
  recentLimit,
  showRecent
}: ProjectSessionListProps): JSX.Element {
  const hasActive = sessions.some((s) => s.status === 'active')
  const hideEmptySessions = useSettingsStore((s) => s.settings.hideEmptySessions)
  const settingShowRecent = useSettingsStore((s) => s.settings.showRecentSessionsInProject)
  const settingRecentCount = useSettingsStore((s) => s.settings.recentSessionsCount)
  const effectiveShowRecent = showRecent ?? settingShowRecent
  const effectiveLimit = recentLimit ?? settingRecentCount
  // Idle sessions collapse into a "Idle · N resumable" rollup that is closed
  // by default so idle work doesn't clutter the live rows. Expansion state is
  // per-scope and ephemeral (see projectStore.expandedIdleSections).
  const idleExpanded = useProjectStore((s) => s.expandedIdleSections.has(scopeId))
  const toggleIdleSection = useProjectStore((s) => s.toggleIdleSection)

  const recentSessions = useMemo(
    () =>
      selectRecentSessions(sessions, openTabs, {
        limit: effectiveShowRecent ? effectiveLimit : 0,
        hideEmpty: hideEmptySessions
      }),
    [sessions, openTabs, effectiveShowRecent, effectiveLimit, hideEmptySessions]
  )

  const hasContent = hasActive || openTabs.length > 0 || recentSessions.length > 0
  if (!hasContent) {
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
  // `unpaired` actives are sessions running in this scope with no DPlex tab
  // backing them — i.e. started outside DPlex. They render as normal rows
  // under a quiet caption divider (and carry an "External" chip) so owned
  // sessions stay front-and-center while externals keep all their
  // affordances (resume, prompts, delete).
  const external = unpaired
  const hasRowsAbove = pairs.length > 0 || external.length > 0

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
      {external.length > 0 && (
        <>
          <ExternalSessionsDivider />
          {external.map((session) => (
            <SessionItem
              key={`ext:${session.aiTool}:${session.id}`}
              session={session}
              onDelete={onDeleteSession}
              onShowPrompts={onShowPrompts}
              compact
              external
              showProviderBadge={showProviderBadge}
            />
          ))}
        </>
      )}
      {recentSessions.length > 0 && (
        <>
          {hasRowsAbove && (
            <div
              aria-hidden="true"
              style={{
                margin: '4px 16px 2px',
                borderTop: '1px dashed var(--dplex-border)',
                opacity: 0.7
              }}
            />
          )}
          {/* Collapsible "Idle · N resumable" rollup — closed by default so
              idle sessions stay out of the way until the user asks for them. */}
          <button
            type="button"
            onClick={() => toggleIdleSection(scopeId)}
            aria-expanded={idleExpanded}
            title={idleExpanded ? 'Hide resumable sessions' : 'Show resumable sessions'}
            className="group flex items-center gap-1.5 w-full text-left px-3 py-[3px] mx-1 rounded-[5px] hover:bg-[var(--dplex-hover)] transition-colors"
          >
            {idleExpanded ? (
              <ChevronDown size={11} style={{ color: 'var(--dplex-text-dim)', flexShrink: 0 }} />
            ) : (
              <ChevronRight size={11} style={{ color: 'var(--dplex-text-dim)', flexShrink: 0 }} />
            )}
            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--dplex-text-muted)' }}>
              Idle · {recentSessions.length} resumable
            </span>
          </button>
          {idleExpanded &&
            recentSessions.map((session) => (
              <RecentSessionRow key={`recent:${session.aiTool}:${session.id}`} session={session} />
            ))}
        </>
      )}
    </>
  )
}
