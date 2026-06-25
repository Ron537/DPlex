import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface KpiCardProps {
  label: string
  value: ReactNode
  unit?: string
  sub?: ReactNode
  Icon: LucideIcon
  /** Accent color for the left bar + icon. Defaults to the brand accent. */
  accent?: string
  /** Optional emphasized value color (e.g. amber for "needs you"). */
  valueColor?: string
  /** When set, the card becomes an interactive button (e.g. open Sessions). */
  onClick?: () => void
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
  onClick
}: KpiCardProps): React.JSX.Element {
  const interactive = !!onClick
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      className={`relative rounded-xl p-4 overflow-hidden w-full h-full text-left transition-colors ${
        interactive ? 'cursor-pointer hover:bg-[var(--dplex-bg-elev-2)]' : 'cursor-default'
      }`}
      style={{
        backgroundColor: 'var(--dplex-bg-elev)',
        border: '1px solid var(--dplex-border)'
      }}
    >
      <span
        aria-hidden
        className="absolute left-0 top-3 bottom-3 rounded-r"
        style={{ width: 3, backgroundColor: accent }}
      />
      <div
        className="flex items-center gap-2 text-[10.5px] font-mono uppercase tracking-wider min-w-0"
        style={{ color: 'var(--dplex-text-dim)' }}
      >
        <Icon size={14} style={{ color: accent }} className="flex-shrink-0" />
        <span className="leading-tight">{label}</span>
      </div>
      <div className="mt-3 flex items-baseline gap-1.5 font-mono flex-wrap">
        <span
          className="text-[28px] sm:text-[32px] font-bold leading-none break-all"
          style={{ color: valueColor }}
        >
          {value}
        </span>
        {unit && (
          <span
            className="text-[12px] whitespace-nowrap"
            style={{ color: 'var(--dplex-text-dim)' }}
          >
            {unit}
          </span>
        )}
      </div>
      {sub && (
        <div
          className="mt-2.5 text-[11.5px] font-mono leading-tight line-clamp-2 break-words"
          style={{ color: 'var(--dplex-text-muted)' }}
        >
          {sub}
        </div>
      )}
    </button>
  )
}
