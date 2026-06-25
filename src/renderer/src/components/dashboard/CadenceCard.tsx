import { useMemo } from 'react'
import { Flame, CalendarClock, Gauge } from 'lucide-react'
import { activeStreak, busiestSlot, weekdayName } from '../../utils/dashboardMetrics'
import type { DashboardMetrics } from '../../../../preload'

interface CadenceCardProps {
  overTime: DashboardMetrics['overTime']
  heatmap: DashboardMetrics['heatmap']
  avgPrompts: number
}

function hourRange(hour: number): string {
  const pad = (h: number): string => String((h + 24) % 24).padStart(2, '0')
  return `${pad(hour)}:00–${pad(hour + 1)}:00`
}

/** Engagement callouts derived from the activity buckets + heatmap. */
export function CadenceCard({
  overTime,
  heatmap,
  avgPrompts
}: CadenceCardProps): React.JSX.Element {
  const streak = useMemo(() => activeStreak(overTime), [overTime])
  const busiest = useMemo(() => busiestSlot(heatmap), [heatmap])

  const rows = [
    {
      Icon: Flame,
      t1:
        streak > 0 ? (
          <>
            <b>{streak}-day streak</b> with at least one session
          </>
        ) : (
          <>No active streak yet</>
        ),
      t2: 'consecutive recent days with activity'
    },
    {
      Icon: CalendarClock,
      t1: busiest ? (
        <>
          Busiest on <b>{weekdayName(busiest.weekday)}s</b>, peak <b>{hourRange(busiest.hour)}</b>
        </>
      ) : (
        <>Not enough data to spot a pattern</>
      ),
      t2: 'from your work-time heatmap'
    },
    {
      Icon: Gauge,
      t1: (
        <>
          <b>{avgPrompts}</b> prompts per session on average
        </>
      ),
      t2: 'prompts ÷ sessions in window'
    }
  ]

  return (
    <div className="flex flex-col gap-3.5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-3">
          <span
            className="w-8 h-8 rounded-lg grid place-items-center flex-shrink-0"
            style={{
              backgroundColor: 'var(--dplex-bg-elev-2)',
              border: '1px solid var(--dplex-border)'
            }}
          >
            <r.Icon size={15} style={{ color: 'var(--dplex-accent)' }} />
          </span>
          <div className="min-w-0">
            <div className="text-[13px]" style={{ color: 'var(--dplex-text-2)' }}>
              {r.t1}
            </div>
            <div
              className="text-[11px] font-mono mt-0.5"
              style={{ color: 'var(--dplex-text-dim)' }}
            >
              {r.t2}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
