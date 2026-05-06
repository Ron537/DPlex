import { useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import { useGitPanelStore } from '../../stores/gitPanelStore'
import { useProjectStore } from '../../stores/projectStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { GitPanelChangesSection } from './GitPanelChangesSection'
import { GitPanelEmptyState } from './GitPanelEmptyState'
import { GitProjectPicker } from './GitProjectPicker'
import type { RepoStatus } from '../../../../preload/index'

/**
 * Left-side variant of the Git panel body. Mounted by `SidePanel` when the
 * activity-bar selection is `'git'`. Header has a project picker (covering
 * parents + worktrees) so the user can switch which repo's changes are
 * shown without leaving the Git view.
 */
export function GitSidePanelView(): React.JSX.Element {
  const sectionCollapse = useSettingsStore((s) => s.settings.gitPanel.sectionCollapse)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
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

  // Reserve the empty-state pane only for terminal states (no project, the
  // path doesn't exist, the path isn't a repo, generic error). Active git
  // states (merge/rebase/detached/etc.) still want the changes view.
  const status = repoEntry?.status
  const useEmptyState =
    !activeProject ||
    (status &&
      (status.kind === 'missing-path' || status.kind === 'not-a-repo' || status.kind === 'error'))

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
              onClick={() => activeProjectId && refresh(activeProjectId)}
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
      <div className="flex-1 min-h-0 overflow-y-auto dplex-scroll-autohide">
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
  )
}

interface NonOkStatusBannerProps {
  status: NonNullable<RepoStatus>
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
