import { useMemo } from 'react'
import { useProvidersStore } from '../../stores/providersStore'
import { useChartTooltip } from './useChartTooltip'
import type { DashboardMetrics } from '../../../../preload'

interface ActivityChartProps {
  overTime: DashboardMetrics['overTime']
  providerSplit: DashboardMetrics['providerSplit']
}

/** Deterministic provider color ramp (theme tokens + fixed brand hues). */
const PROVIDER_COLORS = [
  'var(--dplex-accent)',
  '#C084FC',
  'var(--dplex-accent-alt)',
  'var(--dplex-status-success)',
  'var(--dplex-status-warning)'
]

const PLOT_HEIGHT = 150

function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'short' })
}

function fullDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * Stacked daily-activity bars, split by provider. The x-axis labels live in a
 * dedicated row beneath the plot (never over the bars), spacing adapts to the
 * day count so 90-day windows still render visible bars, and each bar shows an
 * instant tooltip with the per-provider breakdown.
 */
export function ActivityChart({ overTime, providerSplit }: ActivityChartProps): React.JSX.Element {
  const getLabel = useProvidersStore((s) => s.getLabel)
  const tip = useChartTooltip()

  const providerOrder = useMemo(() => providerSplit.map((p) => p.providerId), [providerSplit])
  const colorFor = useMemo(() => {
    const map = new Map<string, string>()
    providerOrder.forEach((id, i) => map.set(id, PROVIDER_COLORS[i % PROVIDER_COLORS.length]))
    return map
  }, [providerOrder])

  const maxTotal = useMemo(() => Math.max(1, ...overTime.map((b) => b.total)), [overTime])

  // Spacing adapts to bucket count: dense windows (90d) get a 1px gap so bars
  // don't collapse to zero width; sparse windows breathe with a wider gap.
  const n = overTime.length
  const gap = n > 60 ? 1 : n > 30 ? 2 : n > 14 ? 3 : 5
  // Label only ~10 ticks so the axis never crowds.
  const tickEvery = Math.max(1, Math.ceil(n / 10))

  return (
    <div>
      <div className="flex items-end" style={{ height: PLOT_HEIGHT, gap }}>
        {overTime.map((bucket) => {
          const heightPct = (bucket.total / maxTotal) * 100
          const onMove = (e: React.MouseEvent): void => {
            tip.show(
              e,
              <span>
                <b>{fullDate(bucket.dateMs)}</b> · {bucket.total} session
                {bucket.total === 1 ? '' : 's'}
                {bucket.total > 0 &&
                  providerOrder
                    .filter((pid) => (bucket.byProvider[pid] ?? 0) > 0)
                    .map((pid) => (
                      <span
                        key={pid}
                        style={{ display: 'block', color: 'var(--dplex-text-muted)' }}
                      >
                        {getLabel(pid)}: {bucket.byProvider[pid]}
                      </span>
                    ))}
              </span>
            )
          }
          return (
            <div
              key={bucket.dateMs}
              className="flex-1 h-full flex flex-col justify-end min-w-0"
              onMouseEnter={onMove}
              onMouseMove={onMove}
              onMouseLeave={tip.hide}
            >
              <div
                className="w-full flex flex-col justify-end rounded-t-[3px] overflow-hidden"
                style={{ height: `${heightPct}%` }}
              >
                {bucket.total === 0 ? (
                  <div
                    className="w-full"
                    style={{ height: 2, backgroundColor: 'var(--dplex-bg-elev-3)' }}
                  />
                ) : (
                  providerOrder.map((pid) => {
                    const v = bucket.byProvider[pid] ?? 0
                    if (v <= 0) return null
                    return (
                      <div
                        key={pid}
                        style={{
                          height: `${(v / bucket.total) * 100}%`,
                          backgroundColor: colorFor.get(pid)
                        }}
                      />
                    )
                  })
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Dedicated x-axis row — labels sit under the bars, never over them. */}
      <div className="flex mt-1.5" style={{ gap }}>
        {overTime.map((bucket, i) => (
          <span
            key={bucket.dateMs}
            className="flex-1 text-center font-mono min-w-0 truncate"
            style={{ fontSize: 9, color: 'var(--dplex-text-faint)' }}
          >
            {i % tickEvery === 0 ? dayLabel(bucket.dateMs) : ''}
          </span>
        ))}
      </div>

      <div
        className="flex flex-wrap gap-4 mt-3 text-[11px] font-mono"
        style={{ color: 'var(--dplex-text-muted)' }}
      >
        {providerOrder.map((pid) => (
          <span key={pid} className="flex items-center gap-1.5">
            <i
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: colorFor.get(pid) }}
            />
            {getLabel(pid)}
          </span>
        ))}
      </div>
      {tip.node}
    </div>
  )
}
