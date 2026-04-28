import React, { useEffect, useMemo, useRef } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { useGitPanelStore } from '../../stores/gitPanelStore'
import { useProjectStore } from '../../stores/projectStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { GitPanelCollapsedStrip } from './GitPanelCollapsedStrip'
import { GitPanelChangesSection } from './GitPanelChangesSection'
import { GitPanelEmptyState } from './GitPanelEmptyState'
import { WorktreeSwitcher } from './WorktreeSwitcher'
import type { Project } from '../../types'
import { MOD, SHIFT } from '../../utils/shortcuts'

const MIN_WIDTH = 220
const MAX_WIDTH = 640

export function GitPanel(): React.JSX.Element | null {
  const open = useSettingsStore((s) => s.settings.gitPanel.open)
  const width = useSettingsStore((s) => s.settings.gitPanel.width)
  const sectionCollapse = useSettingsStore((s) => s.settings.gitPanel.sectionCollapse)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const settingsLoaded = useSettingsStore((s) => s.loaded)
  const collapse = useGitPanelStore((s) => s.collapse)
  const setWidth = useGitPanelStore((s) => s.setWidth)
  const refresh = useGitPanelStore((s) => s.refresh)
  const resolveActiveRoot = useGitPanelStore((s) => s.resolveActiveRoot)
  const byRepo = useGitPanelStore((s) => s.byRepo)
  const loading = useGitPanelStore((s) => s.loading)

  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const activeProject = useProjectStore(
    (s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null
  )

  const root = useMemo(
    () => (activeProject ? resolveActiveRoot(activeProject) : null),
    [activeProject, resolveActiveRoot]
  )
  const repoEntry = root ? byRepo[root] : null
  const isLoading = root ? loading[root] === true : false

  // Drag-to-resize. Use a ref to track active drag so we can clean up the
  // window-level listeners if the panel unmounts mid-drag (e.g., user
  // collapses panel via shortcut, project deleted).
  const dragStateRef = useRef<{
    onMove: (ev: MouseEvent) => void
    onUp: () => void
  } | null>(null)
  useEffect(() => {
    return () => {
      const drag = dragStateRef.current
      if (drag) {
        window.removeEventListener('mousemove', drag.onMove)
        window.removeEventListener('mouseup', drag.onUp)
        dragStateRef.current = null
      }
    }
  }, [])
  const onResizeStart = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    const onMove = (ev: MouseEvent): void => {
      // Panel sits on the right edge; dragging LEFT widens it.
      const delta = startX - ev.clientX
      setWidth(startWidth + delta)
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      dragStateRef.current = null
    }
    if (dragStateRef.current) {
      window.removeEventListener('mousemove', dragStateRef.current.onMove)
      window.removeEventListener('mouseup', dragStateRef.current.onUp)
    }
    dragStateRef.current = { onMove, onUp }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  if (!settingsLoaded) return null
  if (!open) return <GitPanelCollapsedStrip />

  const clampedWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width))

  // Show changes section even for non-ok states (merge/rebase/detached/
  // cherry-pick/bisect) — those are exactly when users want diffs the most.
  // Reserve the empty-state pane only for terminal states (no project, the
  // path doesn't exist, the path isn't a repo, generic error).
  const status = repoEntry?.status
  const useEmptyState =
    !activeProject ||
    (status &&
      (status.kind === 'missing-path' || status.kind === 'not-a-repo' || status.kind === 'error'))

  return (
    <div
      className="flex flex-row h-full flex-shrink-0"
      style={{ width: clampedWidth, borderLeft: '1px solid var(--dplex-border)' }}
      data-testid="git-panel"
    >
      <div
        onMouseDown={onResizeStart}
        className="w-1 cursor-col-resize hover:bg-[var(--dplex-accent)] flex-shrink-0"
        style={{ opacity: 0.4 }}
        title="Drag to resize"
      />
      <div
        className="flex flex-col h-full flex-1 min-w-0"
        style={{ backgroundColor: 'var(--dplex-bg-alt)' }}
      >
        <PanelHeader
          project={activeProject}
          isLoading={isLoading}
          onRefresh={() => activeProjectId && refresh(activeProjectId)}
          onCollapse={collapse}
        />
        {activeProject && <WorktreeSwitcher project={activeProject} />}
        {activeProject && status && status.kind !== 'ok' && !useEmptyState && (
          <NonOkStatusBanner status={status} />
        )}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {!activeProject ? (
            <GitPanelEmptyState kind="no-project" />
          ) : useEmptyState && status ? (
            <GitPanelEmptyState kind={status.kind} status={status} />
          ) : (
            <GitPanelChangesSection
              project={activeProject}
              files={repoEntry?.files ?? []}
              isLoading={isLoading}
              collapsed={sectionCollapse.changes}
              onToggleCollapsed={() => {
                updateSettings({
                  gitPanel: {
                    ...useSettingsStore.getState().settings.gitPanel,
                    sectionCollapse: {
                      ...sectionCollapse,
                      changes: !sectionCollapse.changes
                    }
                  }
                })
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

interface NonOkStatusBannerProps {
  status: NonNullable<ReturnType<typeof useGitPanelStore.getState>['byRepo'][string]['status']>
}

function NonOkStatusBanner({ status }: NonOkStatusBannerProps): React.JSX.Element {
  let label: string
  switch (status.kind) {
    case 'detached-head':
      label = `Detached HEAD${status.headRef ? ` @ ${status.headRef}` : ''}`
      break
    case 'merge':
      label = 'Merge in progress'
      break
    case 'rebase':
      label = 'Rebase in progress'
      break
    case 'cherry-pick':
      label = 'Cherry-pick in progress'
      break
    case 'bisect':
      label = 'Bisect in progress'
      break
    default:
      label = ''
  }
  if (!label) return <></>
  return (
    <div
      className="px-2 py-1 text-[11px] flex-shrink-0"
      style={{
        backgroundColor: 'var(--dplex-bg)',
        color: 'var(--dplex-text-muted)',
        borderBottom: '1px solid var(--dplex-border)'
      }}
      data-testid="git-panel-status-banner"
    >
      {label}
    </div>
  )
}

interface PanelHeaderProps {
  project: Project | null
  isLoading: boolean
  onRefresh: () => void
  onCollapse: () => void
}

function PanelHeader({
  project,
  isLoading,
  onRefresh,
  onCollapse
}: PanelHeaderProps): React.JSX.Element {
  return (
    <div
      className="flex items-center gap-1.5 px-2 h-8 flex-shrink-0"
      style={{ borderBottom: '1px solid var(--dplex-border)' }}
    >
      <span
        className="text-[10px] font-semibold uppercase tracking-wider truncate"
        style={{ color: 'var(--dplex-text-muted)' }}
      >
        Git
      </span>
      {project && (
        <span
          className="text-[11px] truncate flex items-center gap-1"
          style={{ color: 'var(--dplex-text-muted)' }}
          title={project.path}
        >
          <span className="opacity-60">·</span>
          <span className="truncate">{project.name}</span>
        </span>
      )}
      <div className="ml-auto flex items-center gap-0.5">
        <button
          type="button"
          className="p-1 rounded hover:bg-[var(--dplex-hover)] disabled:opacity-50"
          onClick={onRefresh}
          disabled={!project}
          title="Refresh"
          aria-label="Refresh changes"
        >
          <RefreshCw size={12} className={isLoading ? 'animate-spin' : undefined} />
        </button>
        <button
          type="button"
          className="p-1 rounded hover:bg-[var(--dplex-hover)]"
          onClick={onCollapse}
          title={`Collapse Git panel (${SHIFT}${MOD}G)`}
          aria-label="Collapse Git panel"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  )
}
