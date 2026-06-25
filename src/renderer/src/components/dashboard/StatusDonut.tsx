import { useMemo } from 'react'
import type { SessionStatus } from '../../types'
import { STATUS_LABEL, STATUS_ORDER, STATUS_VAR } from '../../utils/dashboardMetrics'
import { useChartTooltip } from './useChartTooltip'

interface StatusDonutProps {
  counts: Record<SessionStatus, number>
}

/**
 * SVG donut of the live session status distribution, vertically centered so it
 * sits comfortably even when the card is stretched taller by its row neighbor.
 * Static (no animation loop); hovering a segment or legend row shows an instant
 * tooltip with the share of sessions.
 */
export function StatusDonut({ counts }: StatusDonutProps): React.JSX.Element {
  const tip = useChartTooltip()
  const total = useMemo(() => STATUS_ORDER.reduce((sum, s) => sum + counts[s], 0), [counts])

  const segments = useMemo(() => {
    const out: { status: SessionStatus; pct: number; offset: number }[] = []
    let offset = 25 // start at 12 o'clock
    for (const status of STATUS_ORDER) {
      const value = counts[status]
      if (value <= 0) continue
      const pct = total > 0 ? (value / total) * 100 : 0
      out.push({ status, pct, offset })
      offset -= pct
    }
    return out
  }, [counts, total])

  const tipFor = (status: SessionStatus) => (e: React.MouseEvent) => {
    const pct = total > 0 ? Math.round((counts[status] / total) * 100) : 0
    tip.show(
      e,
      <span>
        <b>{STATUS_LABEL[status]}</b> · {counts[status]} ({pct}%)
      </span>
    )
  }

  return (
    <div className="flex items-center gap-4 h-full min-h-[150px]">
      <svg width={118} height={118} viewBox="0 0 42 42" className="flex-shrink-0">
        <circle
          cx={21}
          cy={21}
          r={15.915}
          fill="none"
          stroke="var(--dplex-bg-elev-3)"
          strokeWidth={5}
        />
        {segments.map((seg) => (
          <circle
            key={seg.status}
            cx={21}
            cy={21}
            r={15.915}
            fill="none"
            stroke={STATUS_VAR[seg.status]}
            strokeWidth={5}
            strokeDasharray={`${seg.pct} ${100 - seg.pct}`}
            strokeDashoffset={seg.offset}
            style={{ cursor: 'pointer' }}
            onMouseEnter={tipFor(seg.status)}
            onMouseMove={tipFor(seg.status)}
            onMouseLeave={tip.hide}
          />
        ))}
        <text
          x={21}
          y={20.5}
          textAnchor="middle"
          fontSize={7}
          fontWeight={700}
          fontFamily="monospace"
          fill="var(--dplex-text)"
        >
          {total}
        </text>
        <text
          x={21}
          y={25}
          textAnchor="middle"
          fontSize={2.6}
          fontFamily="monospace"
          fill="var(--dplex-text-dim)"
        >
          SESSIONS
        </text>
      </svg>
      <div className="flex-1 flex flex-col gap-2 min-w-0">
        {STATUS_ORDER.map((status) => (
          <div
            key={status}
            className="flex items-center gap-2 text-[12.5px] rounded px-1 -mx-1 hover:bg-[var(--dplex-hover)]"
            onMouseEnter={tipFor(status)}
            onMouseMove={tipFor(status)}
            onMouseLeave={tip.hide}
          >
            <span
              className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
              style={{ backgroundColor: STATUS_VAR[status] }}
            />
            <span className="truncate" style={{ color: 'var(--dplex-text-2)' }}>
              {STATUS_LABEL[status]}
            </span>
            <span className="ml-auto font-mono" style={{ color: 'var(--dplex-text-muted)' }}>
              {counts[status]}
            </span>
          </div>
        ))}
      </div>
      {tip.node}
    </div>
  )
}
