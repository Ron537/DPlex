import { useMemo } from 'react'
import { useProvidersStore } from '../../stores/providersStore'
import { providerShares } from '../../utils/dashboardMetrics'
import { EmptyState } from './EmptyState'
import { PieChart } from 'lucide-react'
import type { DashboardMetrics } from '../../../../preload'

interface ProviderMixCardProps {
  providerSplit: DashboardMetrics['providerSplit']
}

const COLORS = [
  'var(--dplex-accent)',
  '#C084FC',
  'var(--dplex-accent-alt)',
  'var(--dplex-status-success)',
  'var(--dplex-status-warning)'
]

/** Share of sessions by provider — a stacked bar plus a labelled legend. */
export function ProviderMixCard({ providerSplit }: ProviderMixCardProps): React.JSX.Element {
  const getLabel = useProvidersStore((s) => s.getLabel)
  const shares = useMemo(() => providerShares(providerSplit), [providerSplit])
  const total = useMemo(() => shares.reduce((s, p) => s + p.sessions, 0), [shares])

  if (total === 0) {
    return <EmptyState Icon={PieChart} title="No sessions in this window yet" />
  }

  return (
    <div className="flex flex-col">
      <div
        className="flex h-3 rounded-md overflow-hidden"
        style={{ border: '1px solid var(--dplex-border)' }}
      >
        {shares.map((p, i) => (
          <div
            key={p.providerId}
            style={{ width: `${p.pct}%`, backgroundColor: COLORS[i % COLORS.length] }}
            title={`${getLabel(p.providerId)} · ${p.pct}%`}
          />
        ))}
      </div>
      <div className="flex flex-col gap-2 mt-3.5">
        {shares.map((p, i) => (
          <div key={p.providerId} className="flex items-center gap-2 text-[12.5px]">
            <span
              className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
              style={{ backgroundColor: COLORS[i % COLORS.length] }}
            />
            <span className="truncate" style={{ color: 'var(--dplex-text-2)' }}>
              {getLabel(p.providerId)}
            </span>
            <span className="ml-auto font-mono" style={{ color: 'var(--dplex-text)' }}>
              {p.pct}%
            </span>
            <span
              className="font-mono text-[11px] w-10 text-right"
              style={{ color: 'var(--dplex-text-dim)' }}
            >
              {p.sessions}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
