import { useState } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import type { WorktreeInfo } from '../../../../preload'
import { useTerminalStore } from '../../stores/terminalStore'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { normalizePath } from '../../hooks/useProjectSessions'

interface DeleteWorktreeModalProps {
  repoRoot: string
  worktree: WorktreeInfo
  onClose: () => void
  onDeleted: () => void
}

export function DeleteWorktreeModal({
  repoRoot,
  worktree,
  onClose,
  onDeleted
}: DeleteWorktreeModalProps): React.JSX.Element {
  const dirty =
    (worktree.status.dirtyCount ?? 0) +
      (worktree.status.untrackedCount ?? 0) +
      (worktree.status.stagedCount ?? 0) >
    0
  const unpushed = (worktree.status.ahead ?? 0) > 0
  const hasUpstream = Boolean(worktree.status.upstream)

  // Match tabs whose worktree metadata points at this worktree OR whose cwd
  // falls under the worktree path — normal project launches from a worktree
  // project don't stamp `worktreePath` metadata, so the prefix check catches
  // those too. Keeps the dirty/close-session warning in sync with what
  // `RemoveWorktreeProjectModal` does.
  const normalizedWorktreePath = normalizePath(worktree.path)
  const openTabs = useTerminalStore((s) => s.groups).flatMap((g) =>
    g.tabs.filter((t) => {
      if (t.kind === 'fileDiff') {
        return normalizePath(t.repoRootFs) === normalizedWorktreePath
      }
      if (t.kind === 'fileEditor') {
        const root = normalizePath(t.rootFs)
        return root === normalizedWorktreePath || root.startsWith(normalizedWorktreePath + '/')
      }
      if (t.kind === 'dashboard') return false
      if (t.worktreePath && normalizePath(t.worktreePath) === normalizedWorktreePath) {
        return true
      }
      if (t.cwd) {
        const cwd = normalizePath(t.cwd)
        return cwd === normalizedWorktreePath || cwd.startsWith(normalizedWorktreePath + '/')
      }
      return false
    })
  )
  const closeTerminal = useTerminalStore((s) => s.closeTerminal)
  const activeSessions = openTabs.length

  const [forceDelete, setForceDelete] = useState(dirty)
  const [deleteBranch, setDeleteBranch] = useState(false)
  const [forceDeleteBranch, setForceDeleteBranch] = useState(false)
  const [closeSessions, setCloseSessions] = useState(activeSessions > 0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEscapeKey(onClose, !submitting)

  // Branch deletion is allowed in two cases:
  //   (a) safe: has upstream and not ahead — a plain `git branch -d` will succeed
  //   (b) unsafe but explicit: user ticks "Force delete branch" which passes `-D`.
  // We only truly DISABLE when the worktree is detached (no branch at all).
  const hasBranch = Boolean(worktree.branch) && !worktree.detached
  const safeBranchDelete = hasUpstream && !unpushed
  const requiresForceBranch = !safeBranchDelete
  const canDeleteBranch = hasBranch && (safeBranchDelete || forceDeleteBranch)

  const canSubmit = dirty ? forceDelete : true

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    setError(null)
    try {
      const resp = await window.dplex.worktrees.delete({
        repoRoot,
        worktreePath: worktree.path,
        force: forceDelete,
        deleteBranch: deleteBranch && canDeleteBranch,
        forceDeleteBranch: deleteBranch && canDeleteBranch && forceDeleteBranch
      })
      if ('code' in resp) {
        setError(resp.message)
        setSubmitting(false)
        return
      }
      // Delete succeeded — close related tabs now.
      if (closeSessions) {
        for (const tab of openTabs) {
          closeTerminal(tab.id)
        }
      }
      // Surface any soft-warning (worktree was removed, but the branch
      // deletion step was skipped/failed). Keep the modal open so the user
      // can read it; they can close manually.
      if (resp.warning) {
        setError(`Worktree deleted. ${resp.warning.message}`)
        setSubmitting(false)
        onDeleted()
        return
      }
      onDeleted()
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
            Delete {worktree.branch ?? worktree.path}?
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
          <div className="space-y-1">
            {dirty &&
              (() => {
                const total =
                  (worktree.status.dirtyCount ?? 0) +
                  (worktree.status.untrackedCount ?? 0) +
                  (worktree.status.stagedCount ?? 0)
                return (
                  <Warning>
                    {total} uncommitted change{total === 1 ? '' : 's'}
                  </Warning>
                )
              })()}
            {activeSessions > 0 && (
              <Warning>
                {activeSessions} running DPlex session{activeSessions === 1 ? '' : 's'}
              </Warning>
            )}
            {unpushed && worktree.branch && (
              <Warning>
                {worktree.status.ahead} commit
                {worktree.status.ahead === 1 ? '' : 's'} not pushed to{' '}
                {worktree.status.upstream ?? 'remote'}
              </Warning>
            )}
          </div>

          <div
            className="text-[11px] font-mono px-2 py-1 rounded"
            style={{ backgroundColor: 'var(--dplex-bg-alt)', color: 'var(--dplex-text-muted)' }}
          >
            {worktree.path}
          </div>

          <label className="flex items-start gap-2 text-[11px]">
            <input
              type="checkbox"
              checked={forceDelete}
              disabled={dirty}
              onChange={(e) => setForceDelete(e.target.checked)}
              className="mt-0.5"
            />
            <span>Force delete{dirty ? ' (required — worktree has changes)' : ''}</span>
          </label>

          {hasBranch && (
            <div className="space-y-1">
              <label className="flex items-start gap-2 text-[11px]">
                <input
                  type="checkbox"
                  checked={deleteBranch}
                  onChange={(e) => {
                    setDeleteBranch(e.target.checked)
                    if (!e.target.checked) setForceDeleteBranch(false)
                  }}
                  className="mt-0.5"
                />
                <span>Also delete branch {worktree.branch}</span>
              </label>
              {deleteBranch && requiresForceBranch && (
                <label
                  className="flex items-start gap-2 text-[11px] pl-5"
                  title={
                    !hasUpstream
                      ? 'No upstream — branch state cannot be verified against remote'
                      : `Branch has ${worktree.status.ahead} unpushed commit(s)`
                  }
                >
                  <input
                    type="checkbox"
                    checked={forceDeleteBranch}
                    onChange={(e) => setForceDeleteBranch(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span style={{ color: 'var(--dplex-status-waiting)' }}>
                    Force delete branch (unmerged / no upstream)
                  </span>
                </label>
              )}
            </div>
          )}

          {activeSessions > 0 && (
            <label className="flex items-start gap-2 text-[11px]">
              <input
                type="checkbox"
                checked={closeSessions}
                onChange={(e) => setCloseSessions(e.target.checked)}
                className="mt-0.5"
              />
              <span>Close related DPlex sessions</span>
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
            disabled={submitting || !canSubmit}
            className="px-3 py-1 text-[11px] rounded disabled:opacity-40"
            style={{ backgroundColor: 'var(--dplex-status-error-strong)', color: '#fff' }}
          >
            {submitting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Warning({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      className="flex items-center gap-1.5 text-[11px]"
      style={{ color: 'var(--dplex-status-waiting)' }}
    >
      <AlertTriangle size={11} /> {children}
    </div>
  )
}
