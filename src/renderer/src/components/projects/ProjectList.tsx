import { useEffect } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { ProjectItem } from './ProjectItem'
import { FolderPlus } from 'lucide-react'

export function ProjectList(): JSX.Element {
  const projects = useProjectStore((s) => s.projects)
  const loaded = useProjectStore((s) => s.loaded)
  const loadProjects = useProjectStore((s) => s.loadProjects)
  const addProject = useProjectStore((s) => s.addProject)
  const startStatusPolling = useProjectStore((s) => s.startStatusPolling)

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

  return (
    <div className="flex flex-col gap-0.5">
      {/* Add Project button */}
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
        <ProjectItem key={project.id} project={project} />
      ))}
    </div>
  )
}
