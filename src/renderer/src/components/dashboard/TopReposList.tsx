import { useMemo } from 'react'
import { FolderGit2 } from 'lucide-react'
import { EmptyState } from './EmptyState'
import type { DashboardMetrics } from '../../../../preload'

interface TopReposCardProps {
  repos: DashboardMetrics['topRepos']
  onSelect?: (repo: DashboardMetrics['topRepos'][number]) => void
}

/** Horizontal-bar ranking of the repositories used most in the window. */
export function TopReposList({ repos, onSelect }: TopReposCardProps): React.JSX.Element {
  const max = useMemo(() => Math.max(1, ...repos.map((r) => r.sessions)), [repos])

  if (repos.length === 0) {
    return (
      <EmptyState
        Icon={FolderGit2}
        title="No repository activity yet"
        subtitle="Sessions you run will be grouped by repository here."
      />
    )
  }

  return (
    <div className="flex flex-col">
      {repos.map((r, i) => {
        const branchLine =
          r.branches.length > 0
            ? r.branches.length > 1
              ? `${r.branches[0]} +${r.branches.length - 1}`
              : r.branches[0]
            : '—'
        return (
          <button
            key={r.repo}
            type="button"
            onClick={() => onSelect?.(r)}
            className="flex items-center gap-3 py-2 text-left rounded-md hover:bg-[var(--dplex-hover)] transition-colors px-1 -mx-1"
            title={r.cwd ?? r.repo}
          >
            <span
              className="font-mono flex-shrink-0 text-right"
              style={{ fontSize: 11, color: 'var(--dplex-text-faint)', width: 18 }}
            >
              {String(i + 1).padStart(2, '0')}
            </span>
            <div className="min-w-0" style={{ width: 150 }}>
              <div
                className="font-mono text-[13px] truncate"
                style={{ color: 'var(--dplex-text-2)' }}
              >
                {r.repo}
              </div>
              <div className="text-[11px] truncate" style={{ color: 'var(--dplex-text-dim)' }}>
                {branchLine}
              </div>
            </div>
            <div
              className="flex-1 h-1.5 rounded-full overflow-hidden mx-1"
              style={{ backgroundColor: 'var(--dplex-bg-elev-3)' }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(r.sessions / max) * 100}%`,
                  background:
                    'linear-gradient(90deg, var(--dplex-accent-3), var(--dplex-accent), var(--dplex-accent-alt))'
                }}
              />
            </div>
            <span
              className="font-mono text-[12px] flex-shrink-0 text-right"
              style={{ color: 'var(--dplex-text)', width: 28 }}
            >
              {r.sessions}
            </span>
          </button>
        )
      })}
    </div>
  )
}
