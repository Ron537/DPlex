import { useProjectStore } from '../../stores/projectStore'
import { ProjectPicker } from '../common/ProjectPicker'
import { FileTree } from './FileTree'

/**
 * Left-side file-explorer panel. Mounted by `SidePanel` when the activity-bar
 * selection is `'explorer'`. Bounded to the active project's own directory
 * (never expanded to a Git repo root); a shared `ProjectPicker` switches which
 * project's files are shown. The actual binding/watcher is driven by
 * `wireFileExplorerGlobals` following `projectStore.activeProjectId`.
 */
export function ExplorerSidePanelView(): React.JSX.Element {
  const activeProject = useProjectStore(
    (s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null
  )

  return (
    <div
      className="flex flex-col flex-1 min-h-0"
      style={{ backgroundColor: 'var(--dplex-bg-panel)' }}
      data-testid="explorer-side-panel-view"
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
            Explorer
          </span>
        </div>
        <ProjectPicker testIdPrefix="explorer-project-picker" />
      </div>

      {!activeProject ? (
        <div className="flex-1 flex items-center justify-center px-4 text-center">
          <span className="text-[12px]" style={{ color: 'var(--dplex-text-muted)' }}>
            No project selected.
          </span>
        </div>
      ) : (
        <FileTree />
      )}
    </div>
  )
}
