import React, { useMemo } from 'react'
import type { ChangedFile, CommitGraphEntry } from '../../../../preload'
import { computeGraphLayout } from './commitGraphLayout'
import { CommitRow } from './CommitRow'

interface CommitGraphProps {
  commits: CommitGraphEntry[]
  expanded: string[]
  filesBySha: Record<string, { files: ChangedFile[]; loading: boolean; error: string | null }>
  hasMore: boolean
  loadingMore: boolean
  onToggle: (sha: string) => void
  onLoadMore: () => void
  onSelectFile: (sha: string, file: ChangedFile, promote: boolean) => void
}

function CommitGraphImpl({
  commits,
  expanded,
  filesBySha,
  hasMore,
  loadingMore,
  onToggle,
  onLoadMore,
  onSelectFile
}: CommitGraphProps): React.JSX.Element {
  const layout = useMemo(() => computeGraphLayout(commits), [commits])
  const expandedSet = useMemo(() => new Set(expanded), [expanded])

  return (
    <div data-testid="commit-graph">
      <ul>
        {commits.map((commit, i) => {
          const row = layout.rows[i]
          if (!row) return null
          const filesEntry = filesBySha[commit.sha]
          return (
            <CommitRow
              key={commit.sha}
              commit={commit}
              row={row}
              expanded={expandedSet.has(commit.sha)}
              files={filesEntry?.files ?? null}
              filesLoading={filesEntry?.loading ?? false}
              filesError={filesEntry?.error ?? null}
              onToggle={() => onToggle(commit.sha)}
              onSelectFile={(file, promote) => onSelectFile(commit.sha, file, promote)}
            />
          )
        })}
      </ul>
      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loadingMore}
          className="w-full px-2 py-1.5 text-[11px] hover:bg-[var(--dplex-hover)] disabled:opacity-50"
          style={{ color: 'var(--dplex-text-muted)' }}
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  )
}

export const CommitGraph = React.memo(CommitGraphImpl)
