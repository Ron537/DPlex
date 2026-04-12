import { useEffect, useState, useRef } from 'react'
import { ChevronRight, ChevronDown, Play, FolderOpen, GitBranch, Monitor, Globe, GripVertical, MoreVertical, Terminal, Copy, Trash2 } from 'lucide-react'
import type { Project } from '../../types'
import { useProjectStore } from '../../stores/projectStore'
import { useTerminalStore } from '../../stores/terminalStore'

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

interface ProjectItemProps {
  project: Project
  isDragging: boolean
  dragOverPosition: 'above' | 'below' | null
  onDragStart: (id: string) => void
  onDragOver: (id: string, position: 'above' | 'below') => void
  onDrop: (id: string) => void
  onDragEnd: () => void
}

export function ProjectItem({ project, isDragging, dragOverPosition, onDragStart, onDragOver, onDrop, onDragEnd }: ProjectItemProps): JSX.Element {
  const expandedIds = useProjectStore((s) => s.expandedProjectIds)
  const toggleExpanded = useProjectStore((s) => s.toggleExpanded)
  const removeProject = useProjectStore((s) => s.removeProject)
  const startAISession = useProjectStore((s) => s.startAISession)
  const getActiveSessionsForProject = useProjectStore((s) => s.getActiveSessionsForProject)
  const groups = useTerminalStore((s) => s.groups)
  const setActiveGroup = useTerminalStore((s) => s.setActiveGroup)
  const setActiveTerminalInGroup = useTerminalStore((s) => s.setActiveTerminalInGroup)
  const [branch, setBranch] = useState<string | null>(null)
  const dragHandleRef = useRef<HTMLSpanElement>(null)
  const [canDrag, setCanDrag] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const createTerminal = useTerminalStore((s) => s.createTerminal)

  const isExpanded = expandedIds.has(project.id)
  const externalSessions = getActiveSessionsForProject(project.path)

  // Get DPlex-managed AI terminals for this project
  const normProject = normalizePath(project.path)
  const dplexTabs = groups.flatMap((g) =>
    g.tabs
      .filter((t) => {
        if (!t.command || !t.cwd) return false
        const normCwd = normalizePath(t.cwd)
        return normCwd === normProject || normCwd.startsWith(normProject + '/')
      })
      .map((t) => ({ ...t, groupId: g.id }))
  )

  // Deduplicate: exclude external sessions that match a DPlex tab's sessionId
  const dplexSessionIds = new Set(dplexTabs.map((t) => t.sessionId).filter(Boolean))
  const filteredExternal = externalSessions.filter((s) => !dplexSessionIds.has(s.id))

  const totalActive = dplexTabs.length + filteredExternal.length

  const handleFocusTab = (tabId: string, groupId: string): void => {
    setActiveGroup(groupId)
    setActiveTerminalInGroup(groupId, tabId)
  }

  useEffect(() => {
    window.dplex.app.getGitBranch(project.path).then(setBranch)
    const interval = setInterval(() => {
      window.dplex.app.getGitBranch(project.path).then(setBranch)
    }, 10000)
    return () => clearInterval(interval)
  }, [project.path])

  return (
    <div
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      {/* Drop indicator above */}
      {dragOverPosition === 'above' && (
        <div className="mx-2 h-0.5 rounded" style={{ backgroundColor: 'var(--dplex-accent)' }} />
      )}
      {/* Project header row */}
      <div
        data-project-id={project.id}
        className="group flex items-center gap-1.5 px-2 py-1.5 hover:bg-white/5 cursor-pointer rounded-sm mx-1 relative"
        draggable={canDrag}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          onDragStart(project.id)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          const rect = e.currentTarget.getBoundingClientRect()
          const midY = rect.top + rect.height / 2
          onDragOver(project.id, e.clientY < midY ? 'above' : 'below')
        }}
        onDrop={(e) => {
          e.preventDefault()
          onDrop(project.id)
        }}
        onDragEnd={() => {
          setCanDrag(false)
          onDragEnd()
        }}
        onClick={() => toggleExpanded(project.id)}
      >
        {/* Drag handle */}
        <span
          ref={dragHandleRef}
          className="flex-shrink-0 cursor-grab opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
          style={{ color: 'var(--dplex-text-muted)' }}
          onMouseDown={() => setCanDrag(true)}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical size={12} />
        </span>

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
            {totalActive > 0 && (
              <span
                className="inline-flex items-center justify-center min-w-[18px] h-[16px] px-1 rounded-full text-[10px] font-bold flex-shrink-0"
                style={{
                  backgroundColor: '#22c55e',
                  color: '#fff'
                }}
              >
                {totalActive}
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
              setShowMenu(!showMenu)
            }}
            className="p-1 hover:bg-white/10 rounded transition-colors"
            style={{ color: 'var(--dplex-text-muted)' }}
            title="More actions"
          >
            <MoreVertical size={11} />
          </button>
        </div>

        {/* Context menu */}
        {showMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setShowMenu(false) }} />
            <div className="absolute right-2 top-8 z-50 rounded shadow-xl py-1 min-w-[150px]" style={{ backgroundColor: 'var(--dplex-bg)', border: '1px solid var(--dplex-border)' }}>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  createTerminal(undefined, project.name, undefined, undefined, project.path)
                  setShowMenu(false)
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-white/10"
                style={{ color: 'var(--dplex-text)' }}
              >
                <Terminal size={11} /> Open Terminal
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  navigator.clipboard.writeText(project.path)
                  setShowMenu(false)
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-white/10"
                style={{ color: 'var(--dplex-text)' }}
              >
                <Copy size={11} /> Copy Path
              </button>
              <div className="my-1" style={{ borderTop: '1px solid var(--dplex-border)' }} />
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  removeProject(project.id)
                  setShowMenu(false)
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-400 hover:bg-white/10"
              >
                <Trash2 size={11} /> Remove Project
              </button>
            </div>
          </>
        )}
      </div>

      {/* Expanded: DPlex terminals + external sessions */}
      {isExpanded && (
        <div className="ml-5 border-l" style={{ borderColor: 'var(--dplex-border)' }}>
          {totalActive === 0 ? (
            <div className="px-3 py-2 text-[10px]" style={{ color: 'var(--dplex-text-muted)' }}>
              No active sessions.
            </div>
          ) : (
            <>
              {/* DPlex-managed terminals */}
              {dplexTabs.map((tab) => (
                <div
                  key={tab.id}
                  className="flex items-center gap-2 px-3 py-1 hover:bg-white/5 rounded-sm mx-1 cursor-pointer"
                  onClick={() => handleFocusTab(tab.id, tab.groupId)}
                >
                  <Monitor size={10} style={{ color: '#22c55e' }} className="flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] truncate" style={{ color: 'var(--dplex-text)' }}>
                      {tab.title}
                    </div>
                  </div>
                  <span className="text-[9px] px-1 py-0.5 rounded" style={{ color: '#22c55e', backgroundColor: 'rgba(34,197,94,0.1)' }}>
                    DPlex
                  </span>
                </div>
              ))}

              {/* External AI sessions */}
              {filteredExternal.map((session) => (
                <div
                  key={session.id}
                  className="flex items-center gap-2 px-3 py-1 hover:bg-white/5 rounded-sm mx-1 cursor-pointer"
                  onClick={() => {
                    const cmd = `copilot --resume=${session.id}`
                    useTerminalStore.getState().createTerminal(
                      undefined,
                      `↻ ${session.displayName}`,
                      cmd,
                      undefined,
                      session.cwd
                    )
                  }}
                >
                  <Globe size={10} style={{ color: '#3b82f6' }} className="flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] truncate" style={{ color: 'var(--dplex-text)' }}>
                      {session.displayName}
                    </div>
                  </div>
                  <span className="text-[9px] px-1 py-0.5 rounded" style={{ color: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)' }}>
                    External
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
      {/* Drop indicator below */}
      {dragOverPosition === 'below' && (
        <div className="mx-2 h-0.5 rounded" style={{ backgroundColor: 'var(--dplex-accent)' }} />
      )}
    </div>
  )
}
