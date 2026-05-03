import { useMemo, useState } from 'react'
import { X, GitBranch, Plus, Trash2, FolderOpen, AlertCircle } from 'lucide-react'
import type { Project, ProviderInfo, WorktreeDefaults } from '../../types'
import type { WorktreeInfo } from '../../../../preload'
import { useWorktrees } from '../../hooks/useWorktrees'
import { useProjectStore } from '../../stores/projectStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { normalizePath } from '../../hooks/useProjectSessions'
import { NewWorktreeModal } from './NewWorktreeModal'
import { DeleteWorktreeModal } from './DeleteWorktreeModal'
import { handleWorktreeCreated } from '../../services/worktreePostCreate'

interface ManageWorktreesModalProps {
  originProject: Project
  providers: ProviderInfo[]
  onClose: () => void
}

/**
 * Reconciles `git worktree list` for the origin repo against DPlex projects.
 * Each row shows whether a worktree is backed by a project, with actions to
 * add/remove/delete.
 */
export function ManageWorktreesModal({
  originProject,
  providers,
  onClose
}: ManageWorktreesModalProps): React.JSX.Element {
  useEscapeKey(onClose)
  const { worktrees, loading, error, repoRoot, refresh } = useWorktrees(originProject.path)
  const projects = useProjectStore((s) => s.projects)
  const addWorktreeProject = useProjectStore((s) => s.addWorktreeProject)
  const globalDefaults = useSettingsStore((s) => s.settings.worktreeDefaults)

  const [creating, setCreating] = useState(false)
  const [toDelete, setToDelete] = useState<WorktreeInfo | null>(null)

  const defaults: WorktreeDefaults = useMemo(() => {
    const override = originProject.worktreeOverrides
    if (!override) return globalDefaults
    return {
      locationPattern: override.locationPattern ?? globalDefaults.locationPattern,
      envFiles:
        override.envFiles === null || override.envFiles === undefined
          ? globalDefaults.envFiles
          : override.envFiles,
      setupScript: override.setupScript ?? globalDefaults.setupScript,
      afterCreate: override.afterCreate ?? globalDefaults.afterCreate
    }
  }, [originProject.worktreeOverrides, globalDefaults])

  // Quickly test "is this worktree backed by a project?"
  const projectByPath = useMemo(() => {
    const m = new Map<string, Project>()
    for (const p of projects) {
      m.set(normalizePath(p.path), p)
    }
    return m
  }, [projects])

  const findBackingProject = (path: string): Project | undefined => {
    return projectByPath.get(normalizePath(path))
  }

  const addAsProject = (wt: WorktreeInfo): void => {
    addWorktreeProject({
      parentProjectId: originProject.id,
      path: wt.path,
      branch: wt.branch ?? wt.head.slice(0, 7),
      createdByDplexWorktree: wt.createdByDplex ?? false
    })
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="w-[640px] max-h-[85vh] flex flex-col rounded-lg shadow-2xl"
        style={{ backgroundColor: 'var(--dplex-bg)', border: '1px solid var(--dplex-border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--dplex-border)' }}
        >
          <h2 className="text-sm font-semibold" style={{ color: 'var(--dplex-text)' }}>
            Worktrees — {originProject.name}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[var(--dplex-hover)] rounded"
            style={{ color: 'var(--dplex-text-muted)' }}
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {loading && worktrees.length === 0 && (
            <div
              className="px-4 py-6 text-center text-[11px]"
              style={{ color: 'var(--dplex-text-muted)' }}
            >
              Loading worktrees…
            </div>
          )}
          {error && <div className="px-4 py-2 text-[11px] text-red-400">{error}</div>}
          {!loading && worktrees.length === 0 && !error && (
            <div
              className="px-4 py-6 text-center text-[11px]"
              style={{ color: 'var(--dplex-text-muted)' }}
            >
              No worktrees yet.
            </div>
          )}
          {worktrees.map((wt) => {
            const backing = findBackingProject(wt.path)
            const dirty = (wt.status.dirtyCount ?? 0) + (wt.status.untrackedCount ?? 0) > 0
            const isOrphan = !wt.isMain && !backing
            return (
              <div
                key={wt.path}
                className="flex items-center gap-2 px-4 py-2 border-b"
                style={{ borderColor: 'var(--dplex-border)' }}
              >
                <GitBranch
                  size={12}
                  style={{
                    color: wt.detached
                      ? 'var(--dplex-text-muted)'
                      : dirty
                        ? 'var(--dplex-status-waiting)'
                        : 'var(--dplex-text)'
                  }}
                  className="flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[12px] truncate font-medium"
                      style={{ color: 'var(--dplex-text)' }}
                    >
                      {wt.detached ? `(detached @ ${wt.head.slice(0, 7)})` : wt.branch}
                    </span>
                    {wt.isMain && (
                      <span
                        className="text-[9px] uppercase px-1 rounded"
                        style={{
                          color: 'var(--dplex-text-muted)',
                          border: '1px solid var(--dplex-border)'
                        }}
                      >
                        main
                      </span>
                    )}
                    {isOrphan && (
                      <span
                        className="text-[9px] uppercase px-1 rounded"
                        style={{
                          color: 'var(--dplex-status-waiting)',
                          border: '1px solid var(--dplex-status-waiting)'
                        }}
                      >
                        orphan
                      </span>
                    )}
                    {dirty && (
                      <AlertCircle size={10} style={{ color: 'var(--dplex-status-waiting)' }} />
                    )}
                  </div>
                  <div
                    className="text-[10px] font-mono truncate"
                    style={{ color: 'var(--dplex-text-muted)' }}
                    title={wt.path}
                  >
                    {wt.path}
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  {isOrphan && (
                    <button
                      onClick={() => addAsProject(wt)}
                      className="px-2 py-1 text-[10px] rounded hover:bg-[var(--dplex-hover)]"
                      style={{ color: 'var(--dplex-accent)' }}
                      title="Add as DPlex project"
                    >
                      <Plus size={11} className="inline" /> Add as project
                    </button>
                  )}
                  <button
                    onClick={() => void window.dplex.worktrees.reveal(wt.path)}
                    className="p-1 hover:bg-[var(--dplex-hover)] rounded"
                    style={{ color: 'var(--dplex-text-muted)' }}
                    title="Reveal in Finder"
                  >
                    <FolderOpen size={11} />
                  </button>
                  {!wt.isMain && (
                    <button
                      onClick={() => setToDelete(wt)}
                      className="p-1 hover:bg-[var(--dplex-hover)] rounded text-red-400"
                      title="Delete worktree"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div
          className="flex items-center justify-between gap-2 px-4 py-3"
          style={{ borderTop: '1px solid var(--dplex-border)' }}
        >
          <button
            onClick={() => setCreating(true)}
            className="px-3 py-1 text-[11px] rounded flex items-center gap-1"
            style={{ backgroundColor: 'var(--dplex-accent)', color: 'white' }}
          >
            <Plus size={11} /> New worktree
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1 text-[11px] rounded hover:bg-[var(--dplex-hover)]"
            style={{ color: 'var(--dplex-text)' }}
          >
            Close
          </button>
        </div>
      </div>

      {creating && repoRoot && (
        <NewWorktreeModal
          project={originProject}
          repoRoot={repoRoot}
          defaults={defaults}
          providers={providers}
          onClose={() => setCreating(false)}
          onCreated={(result) => {
            setCreating(false)
            void handleWorktreeCreated({
              originProject,
              worktreePath: result.worktreePath,
              branch: result.branch,
              afterCreate: result.afterCreate,
              providerId: result.providerId,
              setupScript: result.setupScript,
              createdByDplexWorktree: true
            })
            void refresh()
          }}
        />
      )}

      {toDelete && repoRoot && (
        <DeleteWorktreeModal
          repoRoot={repoRoot}
          worktree={toDelete}
          onClose={() => setToDelete(null)}
          onDeleted={() => {
            // If a DPlex project backed this worktree, remove it too.
            const backing = findBackingProject(toDelete.path)
            if (backing) useProjectStore.getState().removeProject(backing.id)
            setToDelete(null)
            void refresh()
          }}
        />
      )}
    </div>
  )
}
