import { useEffect, useState } from 'react'
import { ChevronRight, ChevronDown, Play, X, FolderOpen, GitBranch } from 'lucide-react'
import type { Project } from '../../types'
import { useProjectStore, type ActiveSession } from '../../stores/projectStore'

interface ProjectItemProps {
  project: Project
}

export function ProjectItem({ project }: ProjectItemProps): JSX.Element {
  const expandedIds = useProjectStore((s) => s.expandedProjectIds)
  const toggleExpanded = useProjectStore((s) => s.toggleExpanded)
  const removeProject = useProjectStore((s) => s.removeProject)
  const startAISession = useProjectStore((s) => s.startAISession)
  const getActiveSessionsForProject = useProjectStore((s) => s.getActiveSessionsForProject)
  const [branch, setBranch] = useState<string | null>(null)

  const isExpanded = expandedIds.has(project.id)
  const activeSessions = getActiveSessionsForProject(project.path)

  useEffect(() => {
    window.dplex.app.getGitBranch(project.path).then(setBranch)
    const interval = setInterval(() => {
      window.dplex.app.getGitBranch(project.path).then(setBranch)
    }, 10000)
    return () => clearInterval(interval)
  }, [project.path])

  return (
    <div>
      {/* Project header row */}
      <div
        className="group flex items-center gap-1.5 px-2 py-1.5 hover:bg-white/5 cursor-pointer rounded-sm mx-1"
        onClick={() => toggleExpanded(project.id)}
      >
        {/* Expand chevron */}
        <span style={{ color: 'var(--dplex-text-muted)' }} className="flex-shrink-0">
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>

        {/* Folder icon */}
        <FolderOpen size={13} style={{ color: 'var(--dplex-accent)' }} className="flex-shrink-0" />

        {/* Project name + branch */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs truncate" style={{ color: 'var(--dplex-text)' }}>
              {project.name}
            </span>
            {activeSessions.length > 0 && (
              <span
                className="inline-flex items-center justify-center min-w-[16px] h-[14px] px-1 rounded-full text-[8px] font-bold flex-shrink-0"
                style={{
                  backgroundColor: '#22c55e',
                  color: '#fff'
                }}
              >
                {activeSessions.length}
              </span>
            )}
          </div>
          {branch ? (
            <div className="flex items-center gap-1 mt-0.5">
              <GitBranch size={9} style={{ color: 'var(--dplex-text-muted)' }} className="flex-shrink-0" />
              <span className="text-[9px] truncate" style={{ color: 'var(--dplex-text-muted)' }}>
                {branch}
              </span>
            </div>
          ) : (
            <div className="text-[9px] truncate" style={{ color: 'var(--dplex-text-muted)' }}>
              {project.path}
            </div>
          )}
        </div>

        {/* Hover actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation()
              startAISession(project)
            }}
            className="p-1 hover:bg-white/10 rounded transition-colors"
            style={{ color: 'var(--dplex-accent)' }}
            title="Start AI Session"
          >
            <Play size={11} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              removeProject(project.id)
            }}
            className="p-1 hover:bg-white/10 rounded transition-colors"
            style={{ color: 'var(--dplex-text-muted)' }}
            title="Close project"
          >
            <X size={11} />
          </button>
        </div>
      </div>

      {/* Expanded: active sessions only */}
      {isExpanded && (
        <div className="ml-5 border-l" style={{ borderColor: 'var(--dplex-border)' }}>
          {activeSessions.length === 0 ? (
            <div className="px-3 py-2 text-[10px]" style={{ color: 'var(--dplex-text-muted)' }}>
              No active sessions.
            </div>
          ) : (
            activeSessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center gap-2 px-3 py-1 hover:bg-white/5 rounded-sm mx-1"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] truncate" style={{ color: 'var(--dplex-text)' }}>
                    {session.displayName}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
