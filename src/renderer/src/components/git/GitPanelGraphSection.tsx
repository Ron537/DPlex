import React, { useEffect } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ChangedFile } from '../../../../preload'
import type { Project } from '../../types'
import { CommitGraph } from './CommitGraph'
import { useGitGraphStore } from '../../stores/gitGraphStore'
import { useTerminalStore } from '../../stores/terminalStore'

interface GitPanelGraphSectionProps {
  project: Project
  collapsed: boolean
  onToggleCollapsed: () => void
}

/** Basename of a POSIX path. */
function basename(p: string): string {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(i + 1) : p
}

export function GitPanelGraphSection({
  project,
  collapsed,
  onToggleCollapsed
}: GitPanelGraphSectionProps): React.JSX.Element {
  const root = useGitGraphStore((s) => s.resolveActiveRoot(project))
  const entry = useGitGraphStore((s) => s.byRepo[root])
  const load = useGitGraphStore((s) => s.load)
  const loadMore = useGitGraphStore((s) => s.loadMore)
  const toggleExpand = useGitGraphStore((s) => s.toggleExpand)

  // Load (and revalidate) the first page whenever the section is open for this
  // repo. `force: true` re-runs `git log` on open / project switch so a branch
  // change made while the section was collapsed is reflected; the head-SHA
  // dedupe keeps this cheap and preserves loaded pages when nothing changed.
  useEffect(() => {
    if (collapsed) return
    load(root, { force: true })
  }, [collapsed, root, load])

  const onSelectFile = (sha: string, file: ChangedFile, promote: boolean): void => {
    useTerminalStore.getState().openOrFocusDiffTab({
      repoRootFs: root,
      repoLabel: project.name,
      scope: { kind: 'commit', sha },
      file,
      title: `${basename(file.gitPath)} @ ${sha.slice(0, 7)}`,
      preview: !promote
    })
  }

  const commits = entry?.commits ?? []
  const isLoading = entry?.loading ?? false

  return (
    <div data-testid="git-panel-graph-section" className="flex flex-col min-h-0 h-full">
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="flex items-center gap-1 w-full px-2 h-6 flex-shrink-0 hover:bg-[var(--dplex-hover)]"
        aria-expanded={!collapsed}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <span
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: 'var(--dplex-text-muted)' }}
        >
          Graph
        </span>
        {commits.length > 0 && (
          <span
            className="ml-auto text-[10px] tabular-nums"
            style={{ color: 'var(--dplex-text-muted)' }}
          >
            {commits.length}
            {entry?.hasMore ? '+' : ''}
          </span>
        )}
      </button>
      {!collapsed && (
        <div className="flex-1 min-h-0 overflow-y-auto dplex-scroll-autohide">
          {isLoading && commits.length === 0 && (
            <div className="px-3 py-2 text-[11px]" style={{ color: 'var(--dplex-text-muted)' }}>
              Loading history…
            </div>
          )}
          {entry?.error && commits.length === 0 && (
            <div
              className="px-3 py-2 text-[11px]"
              style={{ color: 'var(--dplex-status-error, #f87171)' }}
            >
              {entry.error}
            </div>
          )}
          {commits.length > 0 && (
            <CommitGraph
              commits={commits}
              expanded={entry?.expanded ?? []}
              filesBySha={entry?.files ?? {}}
              hasMore={entry?.hasMore ?? false}
              loadingMore={entry?.loadingMore ?? false}
              onToggle={(sha) => toggleExpand(root, sha)}
              onLoadMore={() => loadMore(root)}
              onSelectFile={onSelectFile}
            />
          )}
        </div>
      )}
    </div>
  )
}
