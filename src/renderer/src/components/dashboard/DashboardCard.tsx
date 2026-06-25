import type { ReactNode } from 'react'

interface DashboardCardProps {
  title?: string
  meta?: ReactNode
  /** Tailwind grid-column span class, e.g. 'lg:col-span-8'. */
  className?: string
  children: ReactNode
  /** Optional action node rendered on the right of the header. */
  action?: ReactNode
}

/**
 * Shared surface for every dashboard tile. Owns the panel chrome (border,
 * radius, padding) so the individual metric components stay focused on
 * content. Uses theme tokens only — adapts to light/dark automatically.
 */
export function DashboardCard({
  title,
  meta,
  className = '',
  children,
  action
}: DashboardCardProps): React.JSX.Element {
  return (
    <div
      className={`rounded-xl p-4 min-w-0 flex flex-col ${className}`}
      style={{
        backgroundColor: 'var(--dplex-bg-elev)',
        border: '1px solid var(--dplex-border)'
      }}
    >
      {(title || meta || action) && (
        <div className="flex items-center justify-between mb-3 gap-2">
          {title && (
            <h3
              className="text-[14px] font-semibold truncate"
              style={{ color: 'var(--dplex-text)' }}
            >
              {title}
            </h3>
          )}
          <div className="flex items-center gap-2 flex-shrink-0">
            {meta && (
              <span className="text-[11px] font-mono" style={{ color: 'var(--dplex-text-dim)' }}>
                {meta}
              </span>
            )}
            {action}
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  )
}
