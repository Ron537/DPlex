import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, FolderGit2, GitBranch } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import type { Project } from '../../types'

interface ProjectPickerProps {
  /**
   * Prefix for `data-testid` attributes, e.g. `'git-project-picker'` or
   * `'explorer-project-picker'`. Keeps the two panels' pickers individually
   * targetable in tests while sharing one implementation.
   */
  testIdPrefix: string
  /** Placeholder shown when no project is active. */
  placeholder?: string
}

/**
 * Reusable header dropdown for picking the active project (parent +
 * worktrees) from a side panel. Selecting a row calls `setActiveProject`,
 * which both the Git and Explorer stores auto-bind to via their global
 * subscriptions. Extracted from `GitProjectPicker` so both panels share one
 * implementation (DRY).
 *
 * Rendering:
 *  - Parents come first, sorted alphabetically.
 *  - Worktrees are nested under their parent, sorted alphabetically.
 *  - Orphan worktrees (parent missing) fall back to top-level rows.
 */
export function ProjectPicker({
  testIdPrefix,
  placeholder = 'Select project…'
}: ProjectPickerProps): React.JSX.Element | null {
  const projects = useProjectStore((s) => s.projects)
  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const setActiveProject = useProjectStore((s) => s.setActiveProject)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent): void => {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const tree = useMemo(() => {
    type Node = { project: Project; children: Project[] }
    const byId = new Map<string, Project>(projects.map((p) => [p.id, p]))
    const parents: Node[] = []
    const childrenByParent = new Map<string, Project[]>()
    for (const p of projects) {
      if (p.parentProjectId && byId.has(p.parentProjectId)) {
        const arr = childrenByParent.get(p.parentProjectId) ?? []
        arr.push(p)
        childrenByParent.set(p.parentProjectId, arr)
      }
    }
    for (const p of projects) {
      if (p.parentProjectId && byId.has(p.parentProjectId)) continue
      const children = (childrenByParent.get(p.id) ?? []).slice().sort(byName)
      parents.push({ project: p, children })
    }
    parents.sort((a, b) => byName(a.project, b.project))
    return parents
  }, [projects])

  const activeProject = activeProjectId ? projects.find((p) => p.id === activeProjectId) : null

  if (projects.length === 0) return null

  const handleSelect = (id: string): void => {
    setActiveProject(id)
    setOpen(false)
  }

  return (
    <div className="relative w-full" ref={containerRef}>
      <FolderGit2
        size={13}
        style={{
          position: 'absolute',
          left: 9,
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'var(--dplex-text-dim)',
          pointerEvents: 'none'
        }}
      />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left text-[12.5px] outline-none transition-colors flex items-center"
        style={{
          backgroundColor: 'var(--dplex-bg-input)',
          border: '1px solid var(--dplex-border)',
          borderRadius: 8,
          color: 'var(--dplex-text)',
          padding: '8px 32px',
          fontFamily: 'inherit',
          height: 34
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'var(--dplex-accent)'
          e.currentTarget.style.boxShadow = '0 0 0 3px var(--dplex-accent-soft)'
          e.currentTarget.style.backgroundColor = 'var(--dplex-bg-elev)'
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'var(--dplex-border)'
          e.currentTarget.style.boxShadow = 'none'
          e.currentTarget.style.backgroundColor = 'var(--dplex-bg-input)'
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={activeProject ? activeProject.path : 'Select project'}
        data-testid={`${testIdPrefix}-trigger`}
      >
        <span
          className="truncate flex-1 min-w-0"
          style={{ color: activeProject ? 'var(--dplex-text)' : 'var(--dplex-text-dim)' }}
        >
          {activeProject ? activeProject.name : placeholder}
        </span>
      </button>
      <ChevronDown
        size={13}
        style={{
          position: 'absolute',
          right: 9,
          top: '50%',
          transform: open ? 'translateY(-50%) rotate(180deg)' : 'translateY(-50%)',
          color: 'var(--dplex-text-dim)',
          pointerEvents: 'none',
          transition: 'transform 120ms ease'
        }}
      />
      {open && (
        <div
          role="listbox"
          aria-label="Project"
          className="absolute z-50 left-0 right-0 mt-1 rounded-lg shadow-xl py-1 max-h-[60vh] overflow-y-auto dplex-scroll-autohide"
          style={{
            backgroundColor: 'var(--dplex-bg-elev)',
            border: '1px solid var(--dplex-border-strong)',
            minWidth: 220
          }}
          data-testid={`${testIdPrefix}-menu`}
        >
          {tree.map(({ project, children }) => (
            <div key={project.id}>
              <PickerRow
                project={project}
                isActive={project.id === activeProjectId}
                isWorktree={false}
                onClick={() => handleSelect(project.id)}
                testIdPrefix={testIdPrefix}
              />
              {children.map((c) => (
                <PickerRow
                  key={c.id}
                  project={c}
                  isActive={c.id === activeProjectId}
                  isWorktree
                  onClick={() => handleSelect(c.id)}
                  testIdPrefix={testIdPrefix}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function byName(a: Project, b: Project): number {
  return a.name.localeCompare(b.name)
}

interface PickerRowProps {
  project: Project
  isActive: boolean
  isWorktree: boolean
  onClick: () => void
  testIdPrefix: string
}

function PickerRow({
  project,
  isActive,
  isWorktree,
  onClick,
  testIdPrefix
}: PickerRowProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      role="option"
      aria-selected={isActive}
      title={project.path}
      className="flex items-center gap-2 w-full text-left hover:bg-[var(--dplex-hover)] transition-colors"
      style={{
        color: 'var(--dplex-text)',
        padding: '6px 10px',
        paddingLeft: isWorktree ? 26 : 10,
        backgroundColor: isActive ? 'var(--dplex-accent-faint)' : undefined
      }}
      data-testid={`${testIdPrefix}-row`}
      data-project-id={project.id}
    >
      {isWorktree ? (
        <GitBranch size={12} style={{ color: 'var(--dplex-text-muted)', flexShrink: 0 }} />
      ) : (
        <FolderGit2 size={13} style={{ color: 'var(--dplex-text-muted)', flexShrink: 0 }} />
      )}
      <div className="flex flex-col min-w-0 flex-1">
        <span
          className="truncate text-[12.5px] leading-tight"
          style={{
            color: isActive ? 'var(--dplex-accent)' : 'var(--dplex-text)',
            fontWeight: isActive ? 600 : 500
          }}
        >
          {project.name}
        </span>
        <span
          className="truncate text-[10.5px] leading-tight mt-0.5"
          style={{ color: 'var(--dplex-text-dim)' }}
        >
          {project.path}
        </span>
      </div>
    </button>
  )
}
