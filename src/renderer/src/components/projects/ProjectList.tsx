import { useEffect, useState, useMemo } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { useAttentionStore } from '../../stores/attentionStore'
import { ProjectItem } from './ProjectItem'
import { ProjectAvatarButton } from './ProjectAvatarButton'
import { FolderPlus } from 'lucide-react'
import { buildProjectSessionIndex } from '../../hooks/useProjectSessions'
import type { Project, ProviderInfo } from '../../types'
import type { ProjectActivity } from '../../hooks/useProjectSessions'
import type { AttentionEvent } from '../../../../preload/attentionTypes'

const EMPTY_ACTIVITY: ProjectActivity = {
  sessions: [],
  openTabs: [],
  activeCount: 0,
  hasActive: false,
  lastActivity: undefined
}
// Shared empty attention array — a fresh `[]` per render would defeat the
// `memo()` shallow comparison on `ProjectAvatarButton` and rerender every
// avatar on unrelated SidePanel updates.
const EMPTY_ATTENTION: AttentionEvent[] = []

interface ProjectListProps {
  searchQuery?: string
  activeOnly?: boolean
  /** Single tag to filter by. A project matches if it carries this tag OR
   *  has a worktree child that carries it. Null/undefined means no tag filter. */
  tagFilter?: string | null
  /** Render the rail-style avatar-only column instead of full rows. */
  compact?: boolean
}

interface ProjectEntry {
  project: Project
  children?: Project[]
}

export function ProjectList({
  searchQuery,
  activeOnly,
  tagFilter,
  compact
}: ProjectListProps): React.JSX.Element {
  const projects = useProjectStore((s) => s.projects)
  const loaded = useProjectStore((s) => s.loaded)
  const loadProjects = useProjectStore((s) => s.loadProjects)
  const sessions = useSessionStore((s) => s.sessions)
  const groups = useTerminalStore((s) => s.groups)
  const attentionEvents = useAttentionStore((s) => s.active)
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

  // Map projectId → AttentionEvents for the rail. Built O(projects × events)
  // and only when the rail is rendered, since attention events are typically
  // a tiny set. Each session/tab inside a project contributes its compositeId
  // (providerId:sessionId) which we match against the active events.
  const attentionByProject = useMemo(() => {
    const out = new Map<string, AttentionEvent[]>()
    if (compact !== true || attentionEvents.length === 0) return out
    for (const project of projects) {
      const activity = sessionIndex.get(project.path)
      if (!activity) continue
      const compositeIds = new Set<string>()
      for (const s of activity.sessions) {
        compositeIds.add(`${s.aiTool}:${s.id}`)
      }
      for (const t of activity.openTabs) {
        if (t.providerId && t.sessionId) compositeIds.add(`${t.providerId}:${t.sessionId}`)
      }
      const matches = attentionEvents.filter(
        (e) => !e.suppressed && compositeIds.has(e.compositeId)
      )
      if (matches.length > 0) out.set(project.id, matches)
    }
    return out
  }, [compact, projects, sessionIndex, attentionEvents])

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

  const hasFilter = Boolean(searchQuery) || Boolean(activeOnly) || Boolean(tagFilter)

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
      if (tagFilter && !(p.tags?.includes(tagFilter) ?? false)) return false
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
      const parentMatches = matchesFilter(p)

      if (hasFilter) {
        if (parentMatches) {
          // Parent matches → render with the FULL worktree subtree, even if
          // individual worktrees don't satisfy the filter. A matching parent
          // is a strong "I want this project" signal, and worktrees inherit
          // that context (a tag like `#client-acme` on the origin clearly
          // applies to its branches too).
          restOut.push({ project: p, children: kids })
        } else {
          // Parent doesn't match → surface any worktree children that DO
          // match as top-level rows so a matching branch isn't hidden
          // behind a non-matching origin.
          for (const kid of kids.filter(matchesFilter)) restOut.push({ project: kid })
        }
      } else {
        const entry: ProjectEntry = { project: p, children: kids }
        if (p.pinned) pinnedOut.push(entry)
        else restOut.push(entry)
      }
    }
    return { pinned: pinnedOut, rest: restOut }
  }, [projects, childrenByParent, searchQuery, activeOnly, tagFilter, sessionIndex, hasFilter])

  const totalVisible = pinned.length + rest.length

  // ── Compact (rail) layout ────────────────────────────────────────────────
  // Used when the side panel is collapsed — projects shrink to avatar-only
  // buttons. Pinned section is preserved and separated by a thin divider.
  if (compact) {
    const renderAvatar = (project: Project): React.JSX.Element => (
      <ProjectAvatarButton
        key={project.id}
        project={project}
        activity={sessionIndex.get(project.path) ?? EMPTY_ACTIVITY}
        attentionEvents={attentionByProject.get(project.id) ?? EMPTY_ATTENTION}
      />
    )
    const showPinnedDivider = pinned.length > 0 && rest.length > 0
    return (
      <div className="flex flex-col items-center gap-1.5 py-2" role="list">
        {pinned.map((entry) => renderAvatar(entry.project))}
        {showPinnedDivider && (
          <div className="my-1" style={{ width: 24, borderTop: '1px solid var(--dplex-border)' }} />
        )}
        {rest.map((entry) => renderAvatar(entry.project))}
      </div>
    )
  }

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
      forceExpanded={hasFilter && children !== undefined && children.length > 0}
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
            className="px-2 pt-2 pb-1.5 text-[10px] font-semibold uppercase"
            style={{
              color: 'var(--dplex-text-faint)',
              letterSpacing: '0.10em'
            }}
          >
            Pinned
          </div>
          {pinned.map(renderEntry)}
        </>
      )}

      {/* When we have a pinned section AND other projects, label the remainder
          "All projects" so the two groups read as a clear hierarchy. When no
          projects are pinned, the list is flat and needs no header. */}
      {pinned.length > 0 && rest.length > 0 && (
        <div
          className="px-2 pt-3 pb-1.5 text-[10px] font-semibold uppercase"
          style={{
            color: 'var(--dplex-text-faint)',
            letterSpacing: '0.10em'
          }}
        >
          All projects
        </div>
      )}

      {rest.map(renderEntry)}
    </div>
  )
}
