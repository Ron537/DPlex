import React, { useMemo } from 'react'
import { useGitPanelStore } from '../../stores/gitPanelStore'
import { useProjectStore } from '../../stores/projectStore'

/**
 * 28px vertical strip rendered when the panel is collapsed.
 * Click to expand; shows a count badge for the active project's changes.
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

  return (
    <button
      type="button"
      onClick={expand}
      title="Expand Git panel (⇧⌘G)"
      aria-label="Expand Git panel"
      data-testid="git-panel-collapsed-strip"
      className="w-7 h-full flex flex-col items-center py-2 gap-2 hover:bg-[var(--dplex-hover)] flex-shrink-0"
      style={{
        borderLeft: '1px solid var(--dplex-border)',
        backgroundColor: 'var(--dplex-bg-alt)',
        color: 'var(--dplex-text-muted)'
      }}
    >
      <span
        className="text-[9px] font-bold uppercase tracking-wider"
        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
      >
        Git
      </span>
      {count > 0 && (
        <span
          className="text-[9px] font-semibold rounded-full px-1.5 py-0.5 tabular-nums"
          style={{
            backgroundColor: 'var(--dplex-accent)',
            color: 'var(--dplex-bg)',
            minWidth: 16,
            textAlign: 'center'
          }}
          data-testid="git-panel-count-badge"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  )
}
