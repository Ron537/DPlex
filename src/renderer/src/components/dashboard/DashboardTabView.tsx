import { useEffect, useMemo } from 'react'
import {
  Activity,
  AlertTriangle,
  TrendingUp,
  Hammer,
  RefreshCw,
  Hourglass,
  MoonStar,
  Timer,
  GitCompare
} from 'lucide-react'
import { useSessionStore } from '../../stores/sessionStore'
import { useDashboardStore } from '../../stores/dashboardStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUncommittedStore } from '../../stores/uncommittedStore'
import {
  computeLiveKpis,
  computeHousekeeping,
  formatDuration,
  pctDelta,
  average
} from '../../utils/dashboardMetrics'
import { DashboardCard } from './DashboardCard'
import { KpiCard } from './KpiCard'
import { StatusDonut } from './StatusDonut'
import { ActivityChart } from './ActivityChart'
import { TopReposList } from './TopReposList'
import { AttentionFeed } from './AttentionFeed'
import { WorkHeatmap } from './WorkHeatmap'
import { RecentSessionsTable } from './RecentSessionsTable'
import { CadenceCard } from './CadenceCard'
import { ProviderMixCard } from './ProviderMixCard'
import type { DashboardMetrics } from '../../../../preload'

interface DashboardTabViewProps {
  isActive: boolean
}

const WINDOW_OPTIONS = [7, 14, 30, 90]

/**
 * Root of the Overview Dashboard tab. Live KPIs/donut/feed/table read directly
 * from the session + attention stores (always real-time, decoupled from the
 * historical snapshot). Historical charts come from the dashboard store, which
 * refreshes event-driven (no polling).
 */
export function DashboardTabView({ isActive }: DashboardTabViewProps): React.JSX.Element {
  const sessions = useSessionStore((s) => s.sessions)
  const idleTooLongMinutes = useSettingsStore((s) => s.settings.idleTooLongMinutes)

  const metrics = useDashboardStore((s) => s.metrics)
  const loading = useDashboardStore((s) => s.loading)
  const error = useDashboardStore((s) => s.error)
  const windowDays = useDashboardStore((s) => s.windowDays)
  const dirty = useDashboardStore((s) => s.dirty)
  const init = useDashboardStore((s) => s.init)
  const ensureFresh = useDashboardStore((s) => s.ensureFresh)
  const refresh = useDashboardStore((s) => s.refresh)
  const setWindowDays = useDashboardStore((s) => s.setWindowDays)

  const uncommittedTotal = useUncommittedStore((s) => s.total)
  const uncommittedRepoCount = useUncommittedStore((s) => s.repoCount)
  const refreshUncommitted = useUncommittedStore((s) => s.refresh)

  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const setSearchQuery = useSessionStore((s) => s.setSearchQuery)
  const requestStatusFilter = useSessionStore((s) => s.requestStatusFilter)

  // Subscribe to invalidation once; idempotent inside the store.
  useEffect(() => {
    init()
  }, [init])

  // Refresh when the tab becomes visible if never loaded or marked dirty —
  // events that arrived while hidden are honored here (no dropped updates).
  useEffect(() => {
    if (isActive) ensureFresh()
  }, [isActive, dirty, ensureFresh])

  // Uncommitted counts are git reads — refresh them only when the tab becomes
  // active (and via the manual button), NOT on every session add/remove
  // `dirty` flip, which has nothing to do with working-tree state.
  useEffect(() => {
    if (isActive) void refreshUncommitted()
  }, [isActive, refreshUncommitted])

  const kpis = useMemo(() => computeLiveKpis(sessions), [sessions])
  const housekeeping = useMemo(
    () => computeHousekeeping(sessions, idleTooLongMinutes),
    [sessions, idleTooLongMinutes]
  )
  // Only treat the snapshot as usable when it matches the currently selected
  // window. While a window switch is in flight the prior snapshot is NOT shown
  // under the new label — historical cards fall back to the loading state.
  const m = metrics && metrics.windowDays === windowDays ? metrics : null
  const promptsDelta = m ? pctDelta(m.totals.messages, m.previousTotals.messages) : null
  const avgPrompts = m ? average(m.totals.messages, m.totals.sessions) : 0

  // Reveal the Sessions sidebar, optionally pre-filtered by status and/or a
  // search term. The status request goes through the session store (consumed
  // by the panel on its next render) so it survives the panel not being
  // mounted at click time.
  const revealSessions = (opts: { status?: string[]; search?: string }): void => {
    updateSettings({
      sidebarActiveTab: 'sessions',
      sidebarPanelCollapsed: false,
      sidebarVisible: true
    })
    setSearchQuery(opts.search ?? '')
    requestStatusFilter(opts.status ?? ['all'])
  }

  // Focus a single, specific session in the panel by searching its (unique)
  // session id and clearing any status filter so it can't be filtered out.
  // Used by the single-session housekeeping cards (oldest-waiting / longest-
  // active). No-op when the id is unknown.
  const focusSession = (sessionId: string | null): void => {
    if (!sessionId) return
    revealSessions({ search: sessionId, status: ['all'] })
  }

  const selectRepo = (repo: DashboardMetrics['topRepos'][number]): void => {
    // Search by the local folder name (cwd basename), not the Git remote
    // handle (e.g. "owner/repo") — sessions are matched on cwd/branch/name, so
    // searching the handle would find nothing. Fall back to the last path
    // segment of the repo label when no cwd is known.
    const term = repo.cwd ? basename(repo.cwd) : repo.repo.split('/').pop() || repo.repo
    revealSessions({ search: term })
  }

  return (
    <div className="h-full overflow-y-auto" style={{ backgroundColor: 'var(--dplex-bg)' }}>
      <div className="@container max-w-[1200px] mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
          <div>
            <h1
              className="text-[22px] font-bold tracking-tight"
              style={{ color: 'var(--dplex-text)' }}
            >
              Overview
            </h1>
            <p className="text-[13px] mt-0.5" style={{ color: 'var(--dplex-text-muted)' }}>
              What&apos;s running, what needs you, and where you work.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="text-[11px] font-mono uppercase tracking-wider hidden @md:inline"
              style={{ color: 'var(--dplex-text-dim)' }}
            >
              History
            </span>
            <div
              className="flex items-center rounded-lg overflow-hidden"
              style={{ border: '1px solid var(--dplex-border)' }}
              title="Time range for the historical cards (live cards are unaffected)"
            >
              {WINDOW_OPTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setWindowDays(d)}
                  className="px-2.5 py-1 text-[11px] font-mono transition-colors"
                  style={{
                    color: d === windowDays ? 'var(--dplex-accent-fg)' : 'var(--dplex-text-muted)',
                    backgroundColor: d === windowDays ? 'var(--dplex-accent)' : 'transparent'
                  }}
                >
                  {d}d
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                void refresh()
                void refreshUncommitted()
              }}
              disabled={loading}
              className="grid place-items-center rounded-lg w-8 h-8 transition-colors hover:bg-[var(--dplex-hover)] disabled:opacity-50"
              style={{ border: '1px solid var(--dplex-border)', color: 'var(--dplex-text-muted)' }}
              title="Refresh historical metrics"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {error && (
          <div
            className="mb-4 px-3 py-2 rounded-lg text-[12px] font-mono"
            style={{
              color: 'var(--dplex-status-error)',
              backgroundColor: 'color-mix(in srgb, var(--dplex-status-error) 12%, transparent)'
            }}
          >
            Couldn&apos;t load history: {error}
          </div>
        )}

        {/* KPI row (live). Container-query columns adapt to the dashboard
            PANE width (not the window), so KPIs never cram when the pane is
            narrow (split view, sidebar open): 1-up → 2-up → 4-up. */}
        <div className="grid grid-cols-1 @md:grid-cols-2 @4xl:grid-cols-4 gap-3.5 mb-3.5">
          <KpiCard
            label="Active now"
            value={kpis.activeCount}
            unit="running"
            Icon={Activity}
            accent="var(--dplex-status-success)"
            onClick={() => revealSessions({ status: ['active'] })}
            sub={
              kpis.activeCount > 0
                ? `${kpis.statusCounts.executingTool} executing · ${kpis.statusCounts.thinking} thinking`
                : 'No active sessions'
            }
          />
          <KpiCard
            label="Needs you"
            value={kpis.needsYouCount}
            unit="waiting"
            Icon={AlertTriangle}
            accent="var(--dplex-status-approval)"
            onClick={() => revealSessions({ status: ['waiting'] })}
            valueColor={
              kpis.needsYouCount > 0 ? 'var(--dplex-status-approval)' : 'var(--dplex-text)'
            }
            sub={`${kpis.approvalCount} approval · ${kpis.inputCount} input`}
          />
          <KpiCard
            label="Sessions today"
            value={kpis.sessionsToday}
            unit="started"
            Icon={TrendingUp}
            sub={m ? `${m.totals.sessions} in ${windowDays}d` : '—'}
          />
          <KpiCard
            label={`Prompts · ${windowDays}d`}
            value={m ? formatCompact(m.totals.messages) : '—'}
            unit="sent"
            Icon={Hammer}
            sub={
              m ? (
                <DeltaSub
                  delta={promptsDelta}
                  fallback={`${formatCompact(m.totals.sessions)} sessions`}
                  windowDays={windowDays}
                />
              ) : (
                '—'
              )
            }
          />
        </div>

        {/* Housekeeping — actionable, live (no new data sources). */}
        <div className="grid grid-cols-1 @md:grid-cols-2 @4xl:grid-cols-4 gap-3.5 mb-3.5">
          <KpiCard
            label="Oldest awaiting you"
            value={
              housekeeping.oldestWaitingMs !== null
                ? formatDuration(housekeeping.oldestWaitingMs)
                : '—'
            }
            Icon={Hourglass}
            accent="var(--dplex-status-approval)"
            valueColor={
              housekeeping.oldestWaitingMs !== null
                ? 'var(--dplex-status-approval)'
                : 'var(--dplex-text)'
            }
            onClick={
              housekeeping.oldestWaitingSessionId
                ? () => focusSession(housekeeping.oldestWaitingSessionId)
                : undefined
            }
            sub={housekeeping.oldestWaitingLabel ?? 'Nothing waiting'}
          />
          <KpiCard
            label="Stale sessions"
            value={housekeeping.staleCount}
            unit={`quiet >${idleTooLongMinutes}m`}
            Icon={MoonStar}
            accent={
              housekeeping.staleCount > 0 ? 'var(--dplex-status-warning)' : 'var(--dplex-text-dim)'
            }
            onClick={() => revealSessions({ status: ['active'] })}
            sub={
              housekeeping.staleCount > 0
                ? 'running but idle — check or close'
                : 'no idle running sessions'
            }
          />
          <KpiCard
            label="Longest active"
            value={
              housekeeping.longestActiveMs !== null
                ? formatDuration(housekeeping.longestActiveMs)
                : '—'
            }
            Icon={Timer}
            accent="var(--dplex-status-success)"
            onClick={
              housekeeping.longestActiveSessionId
                ? () => focusSession(housekeeping.longestActiveSessionId)
                : undefined
            }
            sub={housekeeping.longestActiveName ?? 'No active sessions'}
          />
          <KpiCard
            label="Uncommitted"
            value={uncommittedTotal}
            unit="files"
            Icon={GitCompare}
            accent="var(--dplex-accent)"
            sub={
              uncommittedTotal > 0
                ? `across ${uncommittedRepoCount} repo${uncommittedRepoCount === 1 ? '' : 's'}`
                : 'working trees clean'
            }
          />
        </div>

        {/* Content grid — 12 columns once the pane is wide enough, otherwise
            every card stacks full-width. */}
        <div className="grid grid-cols-1 @3xl:grid-cols-12 gap-3.5">
          {/* Activity + status */}
          <DashboardCard
            className="@3xl:col-span-8"
            title="Session activity"
            meta={`last ${windowDays} days · by provider`}
          >
            {m ? (
              <ActivityChart overTime={m.overTime} providerSplit={m.providerSplit} />
            ) : (
              <Placeholder loading={loading} />
            )}
          </DashboardCard>
          <DashboardCard className="@3xl:col-span-4" title="Status right now" meta="live">
            <StatusDonut counts={kpis.statusCounts} />
          </DashboardCard>

          {/* Top repos + attention */}
          <DashboardCard
            className="@3xl:col-span-6"
            title="Repositories you use most"
            meta={`${windowDays}d · by sessions`}
          >
            {m ? (
              <TopReposList repos={m.topRepos} onSelect={selectRepo} />
            ) : (
              <Placeholder loading={loading} />
            )}
          </DashboardCard>
          <DashboardCard className="@3xl:col-span-6" title="Needs attention" meta="live">
            <AttentionFeed />
          </DashboardCard>

          {/* Cadence + provider mix */}
          <DashboardCard className="@3xl:col-span-8" title="Your cadence">
            {m ? (
              <CadenceCard overTime={m.overTime} heatmap={m.heatmap} avgPrompts={avgPrompts} />
            ) : (
              <Placeholder loading={loading} />
            )}
          </DashboardCard>
          <DashboardCard className="@3xl:col-span-4" title="Provider mix" meta={`${windowDays}d`}>
            {m ? (
              <ProviderMixCard providerSplit={m.providerSplit} />
            ) : (
              <Placeholder loading={loading} />
            )}
          </DashboardCard>

          {/* Heatmap */}
          <DashboardCard
            className="@3xl:col-span-12"
            title="When you work"
            meta={`by hour × weekday · last ${windowDays} days`}
          >
            {m ? <WorkHeatmap cells={m.heatmap} /> : <Placeholder loading={loading} />}
          </DashboardCard>

          {/* Recent sessions */}
          <DashboardCard
            className="@3xl:col-span-12"
            title="Recent sessions"
            meta="click a row to open / resume"
          >
            <RecentSessionsTable />
          </DashboardCard>
        </div>
      </div>
    </div>
  )
}

function Placeholder({ loading }: { loading: boolean }): React.JSX.Element {
  return (
    <div
      className="grid place-items-center text-[12px] font-mono"
      style={{ height: 120, color: 'var(--dplex-text-dim)' }}
    >
      {loading ? 'Loading…' : 'No data yet'}
    </div>
  )
}

/** Sub-line for the Prompts KPI: a period-over-period delta, or a fallback. */
function DeltaSub({
  delta,
  fallback,
  windowDays
}: {
  delta: number | null
  fallback: string
  windowDays: number
}): React.JSX.Element {
  if (delta === null) return <span>{fallback}</span>
  const up = delta >= 0
  const color = up ? 'var(--dplex-status-success)' : 'var(--dplex-status-error)'
  return (
    <span style={{ color }}>
      {up ? '▲' : '▼'} {Math.abs(delta)}% vs prior {windowDays}d
    </span>
  )
}

/** Compact number formatting: 1234 → "1.2k". */
function formatCompact(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** Basename of a path, tolerating both `/` and `\` separators. */
function basename(p: string): string {
  const parts = p.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || p
}
