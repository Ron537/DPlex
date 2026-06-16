import React, { useCallback } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ChangedFile } from '../../../../preload'
import type { Project } from '../../types'
import { ChangesList } from '../diff/ChangesList'
import { useGitPanelStore } from '../../stores/gitPanelStore'
import { useProjectStore } from '../../stores/projectStore'

interface GitPanelChangesSectionProps {
  project: Project
  files: ChangedFile[]
  isLoading: boolean
  collapsed: boolean
  onToggleCollapsed: () => void
}

export function GitPanelChangesSection({
  project,
  files,
  isLoading,
  collapsed,
  onToggleCollapsed
}: GitPanelChangesSectionProps): React.JSX.Element {
  const openFile = useGitPanelStore((s) => s.openFile)
  const selectedGitPath = useProjectStore(
    (s) => s.projects.find((p) => p.id === project.id)?.gitPanelState?.selectedGitPath
  )

  // Single-click opens preview; the consumer (ChangesList) emits onSelect on
  // every click — we treat that as "preview". Double-click promotes to
  // permanent. ChangesList doesn't expose onDoubleClick yet, so we attach
  // our own listener at the wrapper level.
  const onSelect = useCallback(
    (gitPath: string) => {
      const file = files.find((f) => f.gitPath === gitPath)
      if (!file) return
      openFile(project, file, { promote: false })
    },
    [files, openFile, project]
  )

  const onWrapperDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const row = (e.target as HTMLElement).closest('[data-git-path]') as HTMLElement | null
      if (!row) return
      const gitPath = row.getAttribute('data-git-path')
      if (!gitPath) return
      const file = files.find((f) => f.gitPath === gitPath)
      if (!file) return
      openFile(project, file, { promote: true })
    },
    [files, openFile, project]
  )

  return (
    <div data-testid="git-panel-changes-section" className="flex flex-col min-h-0 h-full">
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="flex items-center gap-1 w-full px-2 h-6 flex-shrink-0 hover:bg-[var(--dplex-hover)]"
        aria-expanded={!collapsed}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <span
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: 'var(--dplex-text-muted)' }}
        >
          Changes
        </span>
        <span
          className="ml-auto text-[10px] tabular-nums"
          style={{ color: 'var(--dplex-text-muted)' }}
        >
          {files.length}
        </span>
      </button>
      {!collapsed && (
        <div className="flex-1 min-h-0" onDoubleClick={onWrapperDoubleClick}>
          <ChangesList
            files={files}
            selectedPath={selectedGitPath}
            onSelect={onSelect}
            truncated={false}
            totalCount={files.length}
            loading={isLoading}
          />
        </div>
      )}
    </div>
  )
}
