import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useGitPanelStore } from '../../stores/gitPanelStore'
import { useGitGraphStore } from '../../stores/gitGraphStore'
import { useProjectStore } from '../../stores/projectStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { GitPanelChangesSection } from './GitPanelChangesSection'
import { GitPanelGraphSection } from './GitPanelGraphSection'
import { GitPanelEmptyState } from './GitPanelEmptyState'
import { GitProjectPicker } from './GitProjectPicker'
import type { GitPanelSettings } from '../../types'
import type { RepoStatus } from '../../../../preload/index'

/** Clamp the Changes pane fraction so both headers always stay visible. */
const MIN_FRACTION = 0.15
const MAX_FRACTION = 0.85

/**
 * Left-side variant of the Git panel body. Mounted by `SidePanel` when the
 * activity-bar selection is `'git'`. Header has a project picker (covering
 * parents + worktrees) so the user can switch which repo's changes are
 * shown without leaving the Git view.
 */
export function GitSidePanelView(): React.JSX.Element {
  const sectionCollapse = useSettingsStore((s) => s.settings.gitPanel.sectionCollapse)
  const savedFraction = useSettingsStore((s) => s.settings.gitPanel.changesFraction)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const refresh = useGitPanelStore((s) => s.refresh)
  const resolveActiveRoot = useGitPanelStore((s) => s.resolveActiveRoot)
  const byRepo = useGitPanelStore((s) => s.byRepo)
  const loading = useGitPanelStore((s) => s.loading)
  const refreshGraph = useGitGraphStore((s) => s.refresh)

  // Live split fraction (Changes pane share of the vertical space). While
  // dragging the sash we use a local override; otherwise we read the persisted
  // value. Committed to settings on mouse-up.
  const contentRef = useRef<HTMLDivElement>(null)
  const [dragFraction, setDragFraction] = useState<number | null>(null)
  const fraction = dragFraction ?? savedFraction

  // Holds the teardown for an in-progress sash drag so it can be removed if the
  // panel unmounts mid-drag (otherwise the window listeners would leak and try
  // to setState after unmount).
  const dragCleanupRef = useRef<(() => void) | null>(null)
  useEffect(
    () => () => {
      dragCleanupRef.current?.()
      dragCleanupRef.current = null
    },
    []
  )

  const onSashDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const container = contentRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      let latest = savedFraction
      const onMove = (ev: MouseEvent): void => {
        const y = ev.clientY - rect.top
        const raw = rect.height > 0 ? y / rect.height : 0.5
        latest = Math.min(MAX_FRACTION, Math.max(MIN_FRACTION, raw))
        setDragFraction(latest)
      }
      const teardown = (): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        dragCleanupRef.current = null
      }
      const onUp = (): void => {
        teardown()
        const cur = useSettingsStore.getState().settings.gitPanel
        updateSettings({ gitPanel: { ...cur, changesFraction: latest } })
        setDragFraction(null)
      }
      dragCleanupRef.current = teardown
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [savedFraction, updateSettings]
  )

  const toggleSection = useCallback(
    (key: keyof GitPanelSettings['sectionCollapse']) => {
      const cur = useSettingsStore.getState().settings.gitPanel
      updateSettings({
        gitPanel: {
          ...cur,
          sectionCollapse: { ...cur.sectionCollapse, [key]: !cur.sectionCollapse[key] }
        }
      })
    },
    [updateSettings]
  )

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

  // Reserve the empty-state pane only for terminal states (no project, the
  // path doesn't exist, the path isn't a repo, generic error). Active git
  // states (merge/rebase/detached/etc.) still want the changes view.
  const status = repoEntry?.status
  const useEmptyState =
    !activeProject ||
    (status &&
      (status.kind === 'missing-path' || status.kind === 'not-a-repo' || status.kind === 'error'))

  const bothExpanded = !sectionCollapse.changes && !sectionCollapse.graph

  return (
    <div
      className="flex flex-col flex-1 min-h-0"
      style={{ backgroundColor: 'var(--dplex-bg-panel)' }}
      data-testid="git-side-panel-view"
    >
      <div
        className="flex flex-col gap-2 px-3 pt-2 pb-2.5 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--dplex-border)' }}
      >
        <div className="flex items-center" style={{ height: 28 }}>
          <span
            className="text-[11px] font-bold uppercase tracking-wider"
            style={{ color: 'var(--dplex-text)', letterSpacing: '0.08em' }}
          >
            Source Control
          </span>
          <div className="ml-auto flex items-center gap-0.5">
            <button
              type="button"
              className="p-1 rounded hover:bg-[var(--dplex-hover)] disabled:opacity-50 transition-colors"
              style={{ color: 'var(--dplex-text-muted)' }}
              onClick={() => {
                if (!activeProjectId) return
                refresh(activeProjectId)
                if (root && sectionCollapse.graph === false) refreshGraph(root)
              }}
              disabled={!activeProject}
              title="Refresh"
              aria-label="Refresh changes"
            >
              <RefreshCw size={13} className={isLoading ? 'animate-spin' : undefined} />
            </button>
          </div>
        </div>
        <GitProjectPicker />
      </div>
      {activeProject && status && status.kind !== 'ok' && !useEmptyState && (
        <NonOkStatusBanner status={status} />
      )}
      {!activeProject ? (
        <div className="flex-1 min-h-0 overflow-y-auto dplex-scroll-autohide">
          <GitPanelEmptyState kind="no-project" />
        </div>
      ) : useEmptyState && status ? (
        <div className="flex-1 min-h-0 overflow-y-auto dplex-scroll-autohide">
          <GitPanelEmptyState kind={status.kind} status={status} />
        </div>
      ) : (
        <div ref={contentRef} className="flex flex-col flex-1 min-h-0">
          <div
            className="flex flex-col min-h-0"
            style={paneStyle(sectionCollapse.changes, bothExpanded, fraction)}
          >
            <GitPanelChangesSection
              project={activeProject}
              files={repoEntry?.files ?? []}
              isLoading={isLoading}
              collapsed={sectionCollapse.changes}
              onToggleCollapsed={() => toggleSection('changes')}
            />
          </div>
          {bothExpanded && (
            <div
              role="separator"
              aria-orientation="horizontal"
              data-testid="git-panel-sash"
              onMouseDown={onSashDown}
              className="group flex-shrink-0 flex items-center cursor-row-resize select-none"
              style={{ height: 7 }}
            >
              <div className="h-px w-full bg-[var(--dplex-border)] group-hover:bg-[var(--dplex-accent)] group-hover:h-[2px]" />
            </div>
          )}
          <div
            className="flex flex-col min-h-0"
            style={paneStyle(sectionCollapse.graph, bothExpanded, 1 - fraction)}
          >
            <GitPanelGraphSection
              project={activeProject}
              collapsed={sectionCollapse.graph}
              onToggleCollapsed={() => toggleSection('graph')}
            />
          </div>
        </div>
      )}
    </div>
  )
}

interface NonOkStatusBannerProps {
  status: NonNullable<RepoStatus>
}

/**
 * Flex sizing for one of the two stacked panes (Changes / Graph).
 *  - collapsed → only the header (natural height).
 *  - both expanded → proportional share of the height via `grow` (0–1).
 *  - solo expanded → fill the remaining space.
 */
function paneStyle(collapsed: boolean, bothExpanded: boolean, grow: number): React.CSSProperties {
  if (collapsed) return { flex: '0 0 auto' }
  if (bothExpanded) return { flexGrow: grow, flexShrink: 1, flexBasis: 0, minHeight: 24 }
  return { flex: '1 1 0%', minHeight: 24 }
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
