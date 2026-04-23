import { useEffect, useState, useMemo } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { ProjectItem } from './ProjectItem'
import { FolderPlus, Pin } from 'lucide-react'
import { buildProjectSessionIndex } from '../../hooks/useProjectSessions'
import type { Project, ProviderInfo } from '../../types'

interface ProjectListProps {
  searchQuery?: string
  activeOnly?: boolean
}

interface ProjectEntry {
  project: Project
  children?: Project[]
}

export function ProjectList({ searchQuery, activeOnly }: ProjectListProps): React.JSX.Element {
  const projects = useProjectStore((s) => s.projects)
  const loaded = useProjectStore((s) => s.loaded)
  const loadProjects = useProjectStore((s) => s.loadProjects)
  const sessions = useSessionStore((s) => s.sessions)
  const groups = useTerminalStore((s) => s.groups)
  const [providers, setProviders] = useState<ProviderInfo[]>([])

  useEffect(() => {
    if (!loaded) {
      loadProjects()
    }
  }, [loaded])

  useEffect(() => {
    window.dplex.sessions.getProviders().then(setProviders)
  }, [])

  const projectPaths = useMemo(() => projects.map((p) => p.path), [projects])
  const sessionIndex = useMemo(
    () => buildProjectSessionIndex(sessions, groups, projectPaths),
    [sessions, groups, projectPaths]
  )

  // Build parentId→children map keyed by project id. Orphan children (whose
  // parent was removed) fall back to being rendered as top-level projects.
  const childrenByParent = useMemo(() => {
    const idSet = new Set(projects.map((p) => p.id))
    const m = new Map<string, Project[]>()
    for (const p of projects) {
      if (p.parentProjectId && idSet.has(p.parentProjectId)) {
        const arr = m.get(p.parentProjectId) ?? []
        arr.push(p)
        m.set(p.parentProjectId, arr)
      }
    }
    return m
  }, [projects])

  const hasFilter = Boolean(searchQuery) || Boolean(activeOnly)

  // Render-order projects. Only top-level origins render directly here — their
  // worktree children render INSIDE the parent's expanded body (so they share
  // the parent's contrasted background container). Orphans whose parent was
  // removed still get surfaced at top level.
  //
  // The result is split into { pinned, rest } so the Pinned section renders
  // its own header. Filter mode collapses the split to avoid confusing hidden
  // context (a match in "rest" under a hidden pinned header would read wrong).
  const { pinned, rest } = useMemo(() => {
    const q = searchQuery?.toLowerCase() ?? ''
    const matchesFilter = (p: Project): boolean => {
      if (q && !p.name.toLowerCase().includes(q)) return false
      if (activeOnly && !sessionIndex.get(p.path)?.hasActive) return false
      return true
    }

    const idSet = new Set(projects.map((p) => p.id))
    const isOrphan = (p: Project): boolean =>
      Boolean(p.parentProjectId) && !idSet.has(p.parentProjectId!)
    const isTopLevel = (p: Project): boolean => !p.parentProjectId || isOrphan(p)

    const pinnedOut: ProjectEntry[] = []
    const restOut: ProjectEntry[] = []

    for (const p of projects) {
      if (!isTopLevel(p)) continue

      const kids = childrenByParent.get(p.id) ?? []
      const visibleKids = kids.filter(matchesFilter)
      const parentMatches = matchesFilter(p)

      if (hasFilter) {
        // Flat match list while filtering — pinning ignored for clarity.
        if (parentMatches) restOut.push({ project: p })
        for (const kid of visibleKids) restOut.push({ project: kid })
      } else {
        const entry: ProjectEntry = { project: p, children: kids }
        if (p.pinned) pinnedOut.push(entry)
        else restOut.push(entry)
      }
    }
    return { pinned: pinnedOut, rest: restOut }
  }, [projects, childrenByParent, searchQuery, activeOnly, sessionIndex, hasFilter])

  const totalVisible = pinned.length + rest.length

  const renderEntry = (
    { project, children }: ProjectEntry,
    index: number,
    list: ProjectEntry[]
  ): React.JSX.Element => (
    <ProjectItem
      key={project.id}
      project={project}
      childProjects={children}
      getActivity={(path) =>
        sessionIndex.get(path) ?? {
          sessions: [],
          openTabs: [],
          activeCount: 0,
          hasActive: false,
          lastActivity: undefined
        }
      }
      activity={
        sessionIndex.get(project.path) ?? {
          sessions: [],
          openTabs: [],
          activeCount: 0,
          hasActive: false,
          lastActivity: undefined
        }
      }
      providers={providers}
      moveUpTargetId={index > 0 ? list[index - 1].project.id : null}
      moveDownTargetId={index < list.length - 1 ? list[index + 1].project.id : null}
    />
  )

  return (
    <div className="flex flex-col min-h-full pt-1 px-2">
      {totalVisible === 0 && (
        <div className="px-4 py-8 text-center" style={{ color: 'var(--dplex-text-muted)' }}>
          {projects.length === 0 ? (
            <div className="flex flex-col items-center gap-2">
              <FolderPlus size={20} style={{ opacity: 0.4 }} />
              <div>
                <div className="text-xs">No projects yet</div>
                <div className="text-[10px] mt-0.5" style={{ opacity: 0.7 }}>
                  Click + to add a folder
                </div>
              </div>
            </div>
          ) : (
            <span className="text-xs">No matching projects.</span>
          )}
        </div>
      )}

      {pinned.length > 0 && (
        <>
          <div
            className="flex items-center gap-1 px-1 pt-1 pb-1 text-[9px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: 'var(--dplex-text-muted)' }}
          >
            <Pin size={8} style={{ transform: 'rotate(45deg)' }} />
            <span>Pinned</span>
          </div>
          {pinned.map(renderEntry)}
          {rest.length > 0 && (
            <div
              className="mx-1 my-1"
              style={{ borderTop: '1px solid var(--dplex-border)', opacity: 0.7 }}
            />
          )}
        </>
      )}

      {/* When we have a pinned section AND other projects, label the remainder
          "All projects" so the two groups read as a clear hierarchy. When no
          projects are pinned, the list is flat and needs no header. */}
      {pinned.length > 0 && rest.length > 0 && (
        <div
          className="px-1 pt-1 pb-1 text-[9px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: 'var(--dplex-text-muted)' }}
        >
          All projects
        </div>
      )}

      {rest.map(renderEntry)}
    </div>
  )
}
