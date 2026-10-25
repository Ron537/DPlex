import type { LucideIcon } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'

interface KpiCardProps {
  label: string
  value: ReactNode
  unit?: string
  sub?: ReactNode
  Icon: LucideIcon
  /** Color of the metric icon. Defaults to the brand accent. */
  accent?: string
  /** Optional emphasized value color (e.g. amber for "needs you"). */
  valueColor?: string
  /** When set, the card becomes an interactive button (e.g. open Sessions). */
  onClick?: () => void
  compact?: boolean
}

/**
 * A single headline metric. Live KPIs re-render the instant their backing
 * store slice changes — they never wait on the historical snapshot. Sizing is
 * responsive and overflow-guarded so narrow cards don't clip the value/unit.
 */
export function KpiCard({
  label,
  value,
  unit,
  sub,
  Icon,
  accent = 'var(--dplex-accent)',
  valueColor = 'var(--dplex-text)',
  onClick,
  compact = false
}: KpiCardProps): React.JSX.Element {
  const interactive = !!onClick
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      data-compact={compact}
      style={{ '--metric-color': accent } as CSSProperties}
      className={`dplex-surface dplex-kpi min-w-0 overflow-hidden w-full h-full text-left transition-colors ${
        interactive ? 'cursor-pointer' : 'cursor-default'
      }`}
    >
      <div
        className="flex items-center justify-between gap-2 text-[12px] font-medium min-w-0"
        style={{ color: 'var(--dplex-text-muted)' }}
      >
        <span className="leading-tight">{label}</span>
        <span className="dplex-kpi-icon">
          <Icon size={14} strokeWidth={1.7} />
        </span>
      </div>
      <div className="mt-4 flex items-baseline gap-2 flex-wrap">
        <span className="dplex-kpi-value break-all" style={{ color: valueColor }}>
          {value}
        </span>
        {unit && (
          <span className="text-[11px] font-sans" style={{ color: 'var(--dplex-text-dim)' }}>
            {unit}
          </span>
        )}
      </div>
      {sub && (
        <div
          className="mt-2.5 text-[11.5px] leading-snug line-clamp-2 break-words"
          style={{ color: 'var(--dplex-text-muted)' }}
        >
          {sub}
        </div>
      )}
    </button>
  )
}
