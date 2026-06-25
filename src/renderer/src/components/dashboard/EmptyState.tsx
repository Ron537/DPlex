import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  Icon: LucideIcon
  title: string
  subtitle?: string
  /** Minimum vertical space so the state reads as intentional, not broken. */
  minHeight?: number
}

/**
 * Shared, understated empty state for dashboard cards. A soft icon chip over a
 * short title and optional hint, vertically centered — consistent and
 * professional across every card instead of ad-hoc one-liners.
 */
export function EmptyState({
  Icon,
  title,
  subtitle,
  minHeight = 120
}: EmptyStateProps): React.JSX.Element {
  return (
    <div
      className="flex flex-col items-center justify-center text-center gap-2 px-4"
      style={{ minHeight }}
    >
      <span
        className="grid place-items-center rounded-xl"
        style={{
          width: 38,
          height: 38,
          backgroundColor: 'var(--dplex-bg-elev-2)',
          border: '1px solid var(--dplex-border)'
        }}
      >
        <Icon size={18} style={{ color: 'var(--dplex-text-dim)' }} />
      </span>
      <div className="text-[13px] font-medium" style={{ color: 'var(--dplex-text-2)' }}>
        {title}
      </div>
      {subtitle && (
        <div className="text-[12px] max-w-[280px]" style={{ color: 'var(--dplex-text-dim)' }}>
          {subtitle}
        </div>
      )}
    </div>
  )
}
