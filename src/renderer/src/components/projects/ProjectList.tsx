import { useEffect, useState } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { ProjectItem } from './ProjectItem'
import { FolderPlus } from 'lucide-react'

type DropPosition = 'above' | 'below'

export function ProjectList(): JSX.Element {
  const projects = useProjectStore((s) => s.projects)
  const loaded = useProjectStore((s) => s.loaded)
  const loadProjects = useProjectStore((s) => s.loadProjects)
  const addProject = useProjectStore((s) => s.addProject)
  const startStatusPolling = useProjectStore((s) => s.startStatusPolling)
  const reorderProject = useProjectStore((s) => s.reorderProject)

  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropPosition, setDropPosition] = useState<DropPosition>('above')

  useEffect(() => {
    if (!loaded) {
      loadProjects()
    }
  }, [loaded])

  // Poll session statuses for projects
  useEffect(() => {
    if (projects.length === 0) return
    return startStatusPolling()
  }, [projects.length])

  const handleDragStart = (projectId: string): void => {
    setDraggedId(projectId)
  }

  const handleDragOver = (projectId: string, position: DropPosition): void => {
    if (draggedId && projectId !== draggedId) {
      setDragOverId(projectId)
      setDropPosition(position)
    }
  }

  const handleDrop = (targetId: string): void => {
    if (draggedId && draggedId !== targetId) {
      reorderProject(draggedId, targetId, dropPosition)
    }
    setDraggedId(null)
    setDragOverId(null)
  }

  const handleDragEnd = (): void => {
    setDraggedId(null)
    setDragOverId(null)
  }

  return (
    <div
      className="flex flex-col gap-0.5 min-h-full"
      onDragOver={(e) => {
        if (!draggedId || projects.length === 0) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        // If cursor is in empty space (not over any item), snap to first or last
        const target = e.target as HTMLElement
        if (target.closest('[data-project-id]')) return // already handled by item
        const container = e.currentTarget
        const rect = container.getBoundingClientRect()
        const midY = rect.top + rect.height / 2
        if (e.clientY < midY) {
          const firstId = projects[0].id
          if (firstId !== draggedId) {
            setDragOverId(firstId)
            setDropPosition('above')
          }
        } else {
          const lastId = projects[projects.length - 1].id
          if (lastId !== draggedId) {
            setDragOverId(lastId)
            setDropPosition('below')
          }
        }
      }}
      onDrop={(e) => {
        e.preventDefault()
        if (dragOverId && draggedId && draggedId !== dragOverId) {
          reorderProject(draggedId, dragOverId, dropPosition)
        }
        setDraggedId(null)
        setDragOverId(null)
      }}
    >      {/* Add Project button */}
      <button
        onClick={addProject}
        className="flex items-center gap-2 mx-2 mb-1 px-2 py-1.5 rounded text-[11px] hover:bg-white/5 transition-colors"
        style={{ color: 'var(--dplex-text-muted)', border: '1px dashed var(--dplex-border)' }}
      >
        <FolderPlus size={13} />
        Add Project
      </button>

      {projects.length === 0 && (
        <div className="px-3 py-6 text-xs text-center" style={{ color: 'var(--dplex-text-muted)' }}>
          No projects yet.
          <br />
          <span className="text-[10px]">Add a folder to get started.</span>
        </div>
      )}

      {projects.map((project) => (
        <ProjectItem
          key={project.id}
          project={project}
          isDragging={draggedId === project.id}
          dragOverPosition={dragOverId === project.id ? dropPosition : null}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
        />
      ))}
    </div>
  )
}
