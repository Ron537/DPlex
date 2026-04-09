import { useEffect, useState } from 'react'
import { ChevronRight, ChevronDown, Play, X, FolderOpen, GitBranch } from 'lucide-react'
import type { Project, AISession } from '../../types'
import { useProjectStore } from '../../stores/projectStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTerminalStore } from '../../stores/terminalStore'

interface ProjectItemProps {
  project: Project
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

function isInsideProject(sessionCwd: string, projectPath: string): boolean {
  const normSession = normalizePath(sessionCwd)
  const normProject = normalizePath(projectPath)
  return normSession === normProject || normSession.startsWith(normProject + '/')
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function ProjectItem({ project }: ProjectItemProps): JSX.Element {
  const expandedIds = useProjectStore((s) => s.expandedProjectIds)
  const toggleExpanded = useProjectStore((s) => s.toggleExpanded)
  const removeProject = useProjectStore((s) => s.removeProject)
  const startAISession = useProjectStore((s) => s.startAISession)
  const sessions = useSessionStore((s) => s.sessions)
  const createTerminal = useTerminalStore((s) => s.createTerminal)
  const [branch, setBranch] = useState<string | null>(null)

  const isExpanded = expandedIds.has(project.id)

  useEffect(() => {
    window.dplex.app.getGitBranch(project.path).then(setBranch)
    // Poll branch every 10 seconds
    const interval = setInterval(() => {
      window.dplex.app.getGitBranch(project.path).then(setBranch)
    }, 10000)
    return () => clearInterval(interval)
  }, [project.path])

  const projectSessions = sessions.filter(
    (s) => s.cwd && isInsideProject(s.cwd, project.path)
  )

  const handleResumeSession = (session: AISession): void => {
    const cmd = `copilot --resume=${session.id}`
    createTerminal(undefined, `↻ ${session.displayName}`, cmd, undefined, project.path)
  }

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
            {branch && (
              <span
                className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full text-[9px] font-medium flex-shrink-0"
                style={{
                  backgroundColor: 'var(--dplex-accent)',
                  color: 'var(--dplex-bg)',
                  opacity: 0.85
                }}
              >
                <GitBranch size={8} />
                {branch}
              </span>
            )}
          </div>
          <div className="text-[9px] truncate" style={{ color: 'var(--dplex-text-muted)' }}>
            {project.path}
          </div>
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

      {/* Expanded sessions */}
      {isExpanded && (
        <div className="ml-5 border-l" style={{ borderColor: 'var(--dplex-border)' }}>
          {projectSessions.length === 0 ? (
            <div className="px-3 py-2 text-[10px]" style={{ color: 'var(--dplex-text-muted)' }}>
              No sessions found for this project.
            </div>
          ) : (
            projectSessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center gap-2 px-3 py-1 hover:bg-white/5 cursor-pointer rounded-sm mx-1"
                onClick={() => handleResumeSession(session)}
                title={`Resume: ${session.displayName}`}
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    session.status === 'active' ? 'bg-green-400' : 'bg-zinc-500'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] truncate" style={{ color: 'var(--dplex-text)' }}>
                    {session.displayName}
                  </div>
                  <div className="text-[9px]" style={{ color: 'var(--dplex-text-muted)' }}>
                    {timeAgo(session.updatedAt)}
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
