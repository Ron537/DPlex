import React, { useMemo } from 'react'
import { GitBranch } from 'lucide-react'
import { useGitPanelStore } from '../../stores/gitPanelStore'
import { useProjectStore } from '../../stores/projectStore'

/**
 * 44px vertical activity-bar style strip rendered when the panel is collapsed.
 * Click to expand. Shows a GitBranch icon, a corner count badge for the
 * active project's changes, and an accent stripe on the left when count > 0.
 */
export function GitPanelCollapsedStrip(): React.JSX.Element {
  const expand = useGitPanelStore((s) => s.expand)
  const byRepo = useGitPanelStore((s) => s.byRepo)
  const resolveActiveRoot = useGitPanelStore((s) => s.resolveActiveRoot)
  const activeProject = useProjectStore(
    (s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null
  )
  const count = useMemo(() => {
    if (!activeProject) return 0
    const root = resolveActiveRoot(activeProject)
    return byRepo[root]?.files.length ?? 0
  }, [activeProject, byRepo, resolveActiveRoot])

  const hasChanges = count > 0
  const display = count > 99 ? '99+' : String(count)

  return (
    <div
      data-testid="git-panel-collapsed-strip"
      className="relative w-11 h-full flex flex-col items-center pt-2 flex-shrink-0"
      style={{
        borderLeft: '1px solid var(--dplex-border)',
        backgroundColor: 'var(--dplex-bg-alt)'
      }}
    >
      {hasChanges && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-2 h-9 w-[2px] rounded-r-sm"
          style={{ backgroundColor: 'var(--dplex-accent)' }}
        />
      )}
      <button
        type="button"
        onClick={expand}
        title="Expand Git panel (⇧⌘G)"
        aria-label="Expand Git panel"
        className="relative flex items-center justify-center w-9 h-9 rounded hover:bg-[var(--dplex-hover)] transition-colors"
        style={{ color: hasChanges ? 'var(--dplex-text)' : 'var(--dplex-text-muted)' }}
      >
        <GitBranch size={20} strokeWidth={1.8} />
        {hasChanges && (
          <span
            data-testid="git-panel-count-badge"
            className="absolute -top-0.5 -right-0.5 text-[9px] font-bold rounded-full px-1 tabular-nums leading-[14px] h-[14px]"
            style={{
              backgroundColor: 'var(--dplex-accent)',
              color: 'var(--dplex-bg)',
              minWidth: 14,
              textAlign: 'center',
              boxShadow: '0 0 0 2px var(--dplex-bg-alt)'
            }}
          >
            {display}
          </span>
        )}
      </button>
    </div>
  )
}
