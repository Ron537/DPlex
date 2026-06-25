import { useState } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import type { Project } from '../../types'
import { useProjectStore } from '../../stores/projectStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { getFileEditorHandle } from '../../services/fileEditorRegistry'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { normalizePath } from '../../hooks/useProjectSessions'

interface RemoveWorktreeProjectModalProps {
  project: Project
  /**
   * Repo root passed from the caller. May be null while the IPC watcher is
   * still resolving, or when the origin project has been removed (orphan
   * worktree-project). In the orphan case `project.path` itself is the
   * worktree path and git worktree remove resolves .git/worktrees from it.
   */
  repoRoot: string | null
  onClose: () => void
  onRemoved: () => void
}

/**
 * Removes a worktree-project from DPlex, optionally deleting the
 * worktree on disk too. Mirrors DeleteWorktreeModal's behaviour but
 * is driven off the Project record rather than WorktreeInfo.
 */
export function RemoveWorktreeProjectModal({
  project,
  repoRoot,
  onClose,
  onRemoved
}: RemoveWorktreeProjectModalProps): React.JSX.Element {
  const removeProject = useProjectStore((s) => s.removeProject)
  // Match open tabs by longest-prefix — consistent with how sessions/terminals
  // are attributed elsewhere. Strict equality missed terminals launched in
  // subdirectories of the worktree (the common case).
  const projectPath = normalizePath(project.path)
  const openTabs = useTerminalStore((s) => s.groups).flatMap((g) =>
    g.tabs.filter((t) => {
      if (t.kind === 'fileDiff') {
        return normalizePath(t.repoRootFs) === projectPath
      }
      if (t.kind === 'fileEditor') {
        const root = normalizePath(t.rootFs)
        return root === projectPath || root.startsWith(projectPath + '/')
      }
      if (t.kind === 'dashboard') return false
      if (t.worktreePath && normalizePath(t.worktreePath) === projectPath) return true
      if (!t.cwd) return false
      const cwd = normalizePath(t.cwd)
      return cwd === projectPath || cwd.startsWith(projectPath + '/')
    })
  )
  const closeTerminal = useTerminalStore((s) => s.closeTerminal)

  const [deleteFromDisk, setDeleteFromDisk] = useState<boolean>(
    project.createdByDplexWorktree ?? false
  )
  const [forceDelete, setForceDelete] = useState(false)
  const [closeSessions, setCloseSessions] = useState(openTabs.length > 0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEscapeKey(onClose, !submitting)

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    setError(null)
    try {
      if (deleteFromDisk) {
        // Fall back to the worktree path itself when we don't know the repo
        // root yet (watcher race) or when the origin project is gone
        // (orphan). `git worktree remove` can resolve either one.
        const effectiveRepoRoot = repoRoot ?? project.path
        const resp = await window.dplex.worktrees.delete({
          repoRoot: effectiveRepoRoot,
          worktreePath: project.path,
          force: forceDelete,
          deleteBranch: false,
          forceDeleteBranch: false
        })
        if ('code' in resp) {
          setError(resp.message)
          setSubmitting(false)
          return
        }
      }
      if (closeSessions) {
        for (const tab of openTabs) {
          // When the worktree files stay on disk (the project is only unlinked
          // from DPlex, not deleted), flush unsaved editor edits first so
          // closing the related tabs can't silently drop them. If we deleted
          // the worktree above, the files are gone and saving is moot.
          if (!deleteFromDisk && tab.kind === 'fileEditor') {
            const handle = getFileEditorHandle(tab.id)
            if (handle?.isDirty()) {
              try {
                await handle.save()
              } catch {
                /* fall through and close anyway */
              }
            }
          }
          closeTerminal(tab.id)
        }
      }
      removeProject(project.id)
      onRemoved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(10,10,12,0.65)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="w-[480px] rounded-xl"
        style={{
          backgroundColor: 'var(--dplex-bg-elev)',
          border: '1px solid var(--dplex-border-strong)',
          boxShadow: 'var(--dplex-shadow-xl)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--dplex-border)' }}
        >
          <h2 className="text-sm font-semibold" style={{ color: 'var(--dplex-text)' }}>
            Remove {project.name}?
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[var(--dplex-hover)] rounded"
            style={{ color: 'var(--dplex-text-muted)' }}
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-3 text-[12px]" style={{ color: 'var(--dplex-text)' }}>
          {openTabs.length > 0 && (
            <div
              className="flex items-center gap-1.5 text-[11px]"
              style={{ color: 'var(--dplex-status-waiting)' }}
            >
              <AlertTriangle size={11} /> {openTabs.length} open tab
              {openTabs.length === 1 ? '' : 's'} in this project
            </div>
          )}

          <div
            className="text-[11px] font-mono px-2 py-1 rounded"
            style={{ backgroundColor: 'var(--dplex-bg-alt)', color: 'var(--dplex-text-muted)' }}
          >
            {project.path}
          </div>

          <label className="flex items-start gap-2 text-[11px]">
            <input
              type="checkbox"
              checked={deleteFromDisk}
              onChange={(e) => {
                setDeleteFromDisk(e.target.checked)
                if (!e.target.checked) setForceDelete(false)
              }}
              className="mt-0.5"
            />
            <span>
              Also delete worktree from disk (<code>git worktree remove</code>)
              {project.createdByDplexWorktree && (
                <span className="ml-1 text-[10px]" style={{ color: 'var(--dplex-text-muted)' }}>
                  — created by DPlex
                </span>
              )}
            </span>
          </label>

          {deleteFromDisk && (
            <label className="flex items-start gap-2 text-[11px] pl-5">
              <input
                type="checkbox"
                checked={forceDelete}
                onChange={(e) => setForceDelete(e.target.checked)}
                className="mt-0.5"
              />
              <span style={{ color: 'var(--dplex-status-waiting)' }}>
                Force (discard uncommitted changes)
              </span>
            </label>
          )}

          {openTabs.length > 0 && (
            <label className="flex items-start gap-2 text-[11px]">
              <input
                type="checkbox"
                checked={closeSessions}
                onChange={(e) => setCloseSessions(e.target.checked)}
                className="mt-0.5"
              />
              <span>Close related DPlex tabs</span>
            </label>
          )}

          {error && (
            <div className="text-[11px] text-red-400" role="alert">
              {error}
            </div>
          )}
        </div>

        <div
          className="flex items-center justify-end gap-2 px-4 py-3"
          style={{ borderTop: '1px solid var(--dplex-border)' }}
        >
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1 text-[11px] rounded hover:bg-[var(--dplex-hover)]"
            style={{ color: 'var(--dplex-text)' }}
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={submitting}
            className="px-3 py-1 text-[11px] rounded disabled:opacity-40"
            style={{ backgroundColor: 'var(--dplex-status-error-strong)', color: '#fff' }}
          >
            {submitting ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </div>
    </div>
  )
}
