import React from 'react'
import { GitBranch, AlertTriangle, FolderOpen, FolderX, GitMerge } from 'lucide-react'
import type { RepoStatus, RepoStatusKind } from '../../../../preload'

interface GitPanelEmptyStateProps {
  kind: RepoStatusKind | 'no-project'
  status?: RepoStatus
}

export function GitPanelEmptyState({ kind, status }: GitPanelEmptyStateProps): React.JSX.Element {
  const config = configFor(kind, status)
  return (
    <div
      className="flex flex-col items-center justify-center text-center px-4 py-8 gap-2"
      style={{ color: 'var(--dplex-text-muted)' }}
      data-testid="git-panel-empty-state"
      data-kind={kind}
    >
      <config.Icon size={20} />
      <div className="text-[12px] font-medium" style={{ color: 'var(--dplex-text)' }}>
        {config.title}
      </div>
      {config.description && (
        <div className="text-[11px] leading-snug max-w-[220px]">{config.description}</div>
      )}
    </div>
  )
}

function configFor(
  kind: RepoStatusKind | 'no-project',
  status?: RepoStatus
): { Icon: typeof GitBranch; title: string; description?: string } {
  switch (kind) {
    case 'no-project':
      return {
        Icon: FolderOpen,
        title: 'No project selected',
        description: 'Click a project in the left panel to see its changes.'
      }
    case 'not-a-repo':
      return {
        Icon: FolderX,
        title: 'Not a Git repository',
        description: 'This folder is not under Git version control.'
      }
    case 'missing-path':
      return {
        Icon: FolderX,
        title: 'Folder not found',
        description: 'The project folder no longer exists on disk.'
      }
    case 'detached-head':
      return {
        Icon: GitBranch,
        title: 'Detached HEAD',
        description: 'You are not on a branch. Check out a branch to see changes.'
      }
    case 'merge':
      return {
        Icon: GitMerge,
        title: 'Merge in progress',
        description: status?.message ?? 'Resolve conflicts to continue.'
      }
    case 'rebase':
      return {
        Icon: GitMerge,
        title: 'Rebase in progress',
        description: status?.message ?? 'Resolve conflicts and continue the rebase.'
      }
    case 'error':
    default:
      return {
        Icon: AlertTriangle,
        title: 'Could not read repository',
        description: status?.message ?? 'An unknown error occurred.'
      }
  }
}
