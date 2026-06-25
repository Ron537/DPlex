import { useMemo } from 'react'
import { useChartTooltip } from './useChartTooltip'
import type { DashboardMetrics } from '../../../../preload'

interface WorkHeatmapProps {
  cells: DashboardMetrics['heatmap']
}

const ROWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * Hour × weekday activity heatmap (Monday-first). Cell opacity scales with the
 * session count relative to the busiest hour. Hovering a cell shows an instant
 * tooltip (native `title` was too slow to appear).
 */
export function WorkHeatmap({ cells }: WorkHeatmapProps): React.JSX.Element {
  const tip = useChartTooltip()
  const { grid, max } = useMemo(() => {
    const g: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0))
    let m = 0
    for (const c of cells) {
      if (c.weekday < 0 || c.weekday > 6 || c.hour < 0 || c.hour > 23) continue
      g[c.weekday][c.hour] = c.count
      if (c.count > m) m = c.count
    }
    return { grid: g, max: m }
  }, [cells])

  return (
    <div className="overflow-x-auto">
      <div
        className="grid gap-[3px] min-w-[640px]"
        style={{ gridTemplateColumns: '34px repeat(24, 1fr)' }}
      >
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span
            key={`h-${h}`}
            className="text-center font-mono self-center"
            style={{ fontSize: 9, color: 'var(--dplex-text-faint)' }}
          >
            {h % 6 === 0 ? String(h).padStart(2, '0') : ''}
          </span>
        ))}

        {ROWS.map((label, wd) => (
          <Row key={label} label={label} wd={wd} counts={grid[wd]} max={max} tip={tip} />
        ))}
      </div>
      {tip.node}
    </div>
  )
}

function Row({
  label,
  wd,
  counts,
  max,
  tip
}: {
  label: string
  wd: number
  counts: number[]
  max: number
  tip: ReturnType<typeof useChartTooltip>
}): React.JSX.Element {
  return (
    <>
      <span
        className="font-mono self-center"
        style={{ fontSize: 10, color: 'var(--dplex-text-dim)' }}
      >
        {label}
      </span>
      {counts.map((count, h) => {
        const intensity = max > 0 ? count / max : 0
        const opacity = count === 0 ? 0.05 : 0.18 + intensity * 0.82
        const onMove = (e: React.MouseEvent): void => {
          tip.show(
            e,
            <span>
              <b>
                {label} {String(h).padStart(2, '0')}:00
              </b>{' '}
              · {count} session{count === 1 ? '' : 's'}
            </span>
          )
        }
        return (
          <div
            key={h}
            className="rounded-sm"
            style={{
              aspectRatio: '1',
              backgroundColor: `color-mix(in srgb, var(--dplex-accent) ${Math.round(opacity * 100)}%, transparent)`
            }}
            data-wd={wd}
            onMouseEnter={onMove}
            onMouseMove={onMove}
            onMouseLeave={tip.hide}
          />
        )
      })}
    </>
  )
}
