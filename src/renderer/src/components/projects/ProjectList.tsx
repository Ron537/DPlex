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

  return (
    <div
      className="flex flex-col min-h-full pt-1"
      onDragOver={(e) => handlers.onContainerDragOver(e, filteredProjects)}
      onDrop={(e) => handlers.onContainerDrop(e)}
    >
      {filteredProjects.length === 0 && (
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

      {filteredProjects.map((project) => (
        <ProjectItem
          key={project.id}
          project={project}
          activity={sessionIndex.get(project.path) ?? {
            sessions: [],
            openTabs: [],
            activeCount: 0,
            hasActive: false,
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
