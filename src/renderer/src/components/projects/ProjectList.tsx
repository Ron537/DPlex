import { useEffect, useState, useMemo, useCallback } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { ProjectItem } from './ProjectItem'
import { FolderPlus } from 'lucide-react'
import { useReorderable } from '../../hooks/useReorderable'
import { buildProjectSessionIndex } from '../../hooks/useProjectSessions'
import type { ProviderInfo } from '../../types'

interface ProjectListProps {
  searchQuery?: string
  activeOnly?: boolean
}

export function ProjectList({ searchQuery, activeOnly }: ProjectListProps): React.JSX.Element {
  const projects = useProjectStore((s) => s.projects)
  const loaded = useProjectStore((s) => s.loaded)
  const loadProjects = useProjectStore((s) => s.loadProjects)
  const addProject = useProjectStore((s) => s.addProject)
  const reorderProject = useProjectStore((s) => s.reorderProject)
  const sessions = useSessionStore((s) => s.sessions)
  const groups = useTerminalStore((s) => s.groups)
  const [providers, setProviders] = useState<ProviderInfo[]>([])

  useEffect(() => {
    if (!loaded) {
      loadProjects()
    }
  }, [loaded])

  // Load providers once
  useEffect(() => {
    window.dplex.sessions.getProviders().then(setProviders)
  }, [])

  // Build session index once for all projects
  const projectPaths = useMemo(() => projects.map((p) => p.path), [projects])
  const sessionIndex = useMemo(
    () => buildProjectSessionIndex(sessions, groups, projectPaths),
    [sessions, groups, projectPaths]
  )

  // Filter projects
  const filteredProjects = useMemo(() => {
    let result = projects

    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter((p) => p.name.toLowerCase().includes(q))
    }

    if (activeOnly) {
      result = result.filter((p) => {
        const activity = sessionIndex.get(p.path)
        return activity?.hasActive
      })
    }

    return result
  }, [projects, searchQuery, activeOnly, sessionIndex])

  const handleReorder = useCallback(
    (draggedId: string, targetId: string, position: 'above' | 'below') => {
      reorderProject(draggedId, targetId, position)
    },
    [reorderProject]
  )

  const { handlers, isDragging, dragOverPosition } = useReorderable(handleReorder)

  const handleAddProject = useCallback(() => {
    addProject()
  }, [addProject])

  return (
    <div
      className="flex flex-col gap-0.5 min-h-full"
      onDragOver={(e) => handlers.onContainerDragOver(e, filteredProjects)}
      onDrop={(e) => handlers.onContainerDrop(e)}
    >
      {/* Add Project button */}
      <button
        onClick={handleAddProject}
        className="flex items-center gap-2 mx-2 mb-1 px-2 py-1.5 rounded text-[11px] hover:bg-white/5 transition-colors"
        style={{ color: 'var(--dplex-text-muted)', border: '1px dashed var(--dplex-border)' }}
      >
        <FolderPlus size={13} />
        Add Project
      </button>

      {filteredProjects.length === 0 && (
        <div className="px-3 py-6 text-xs text-center" style={{ color: 'var(--dplex-text-muted)' }}>
          {projects.length === 0 ? (
            <>
              No projects yet.
              <br />
              <span className="text-[10px]">Add a folder to get started.</span>
            </>
          ) : (
            'No matching projects.'
          )}
        </div>
      )}

      {filteredProjects.map((project) => (
        <ProjectItem
          key={project.id}
          project={project}
          activity={sessionIndex.get(project.path) ?? {
            sessions: [],
            openTabs: [],
            activeCount: 0,
            hasActive: false,
            latestStatus: undefined,
            lastActivity: undefined
          }}
          providers={providers}
          isDragging={isDragging(project.id)}
          dragOverPosition={dragOverPosition(project.id)}
          onDragStart={handlers.onDragStart}
          onDragOver={handlers.onDragOver}
          onDrop={handlers.onDrop}
          onDragEnd={handlers.onDragEnd}
        />
      ))}
    </div>
  )
}
