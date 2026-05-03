import React, { useMemo, useState } from 'react'
import { ChevronDown, GitBranch } from 'lucide-react'
import type { Project } from '../../types'
import { useProjectStore } from '../../stores/projectStore'
import { useGitPanelStore } from '../../stores/gitPanelStore'

interface WorktreeSwitcherProps {
  project: Project
}

/**
 * Lets the user switch between the project root and any DPlex-registered
 * worktrees that share its parent. Worktrees that exist on disk but were
 * never added to the project list are intentionally excluded — the panel
 * mirrors what the user has explicitly registered.
 */
export function WorktreeSwitcher({ project }: WorktreeSwitcherProps): React.JSX.Element | null {
  const projects = useProjectStore((s) => s.projects)
  const setActiveProject = useProjectStore((s) => s.setActiveProject)
  const resolveActiveRoot = useGitPanelStore((s) => s.resolveActiveRoot)
  const [open, setOpen] = useState(false)

  // Collect the project itself + any sibling worktrees (same parent or
  // worktrees of this project). Includes the parent if this is a worktree.
  const candidates = useMemo(() => {
    const familyId = project.parentProjectId ?? project.id
    return projects.filter((p) => p.id === familyId || p.parentProjectId === familyId)
  }, [projects, project])

  if (candidates.length <= 1) return null

  const activeRoot = resolveActiveRoot(project)
  const activeMatch = candidates.find((p) => p.path === activeRoot) ?? project

  return (
    <div
      className="px-3 py-2 flex-shrink-0"
      style={{ borderBottom: '1px solid var(--dplex-border)' }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-[12px] hover:bg-[var(--dplex-hover)]"
        style={{ color: 'var(--dplex-text)' }}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="git-panel-worktree-switcher"
      >
        <GitBranch size={12} style={{ color: 'var(--dplex-text-muted)' }} />
        <span className="truncate flex-1 text-left">{activeMatch.name}</span>
        <ChevronDown size={12} style={{ color: 'var(--dplex-text-muted)' }} />
      </button>
      {open && (
        <ul
          role="listbox"
          className="mt-1 rounded-md overflow-hidden"
          style={{
            backgroundColor: 'var(--dplex-bg-elev)',
            border: '1px solid var(--dplex-border-strong)'
          }}
        >
          {candidates.map((p) => (
            <li
              key={p.id}
              role="option"
              aria-selected={p.id === activeMatch.id}
              onClick={() => {
                setActiveProject(p.id)
                setOpen(false)
              }}
              className="px-2.5 py-1.5 text-[12px] cursor-pointer hover:bg-[var(--dplex-hover)] truncate"
              style={{
                color: p.id === activeMatch.id ? 'var(--dplex-text)' : 'var(--dplex-text-muted)'
              }}
              title={p.path}
            >
              {p.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
