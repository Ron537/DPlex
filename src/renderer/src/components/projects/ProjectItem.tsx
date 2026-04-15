import { useState, useRef } from 'react'
import {
  ChevronRight,
  ChevronDown,
  Play,
  FolderOpen,
  GitBranch,
  GripVertical,
  MoreVertical,
  Terminal,
  Copy,
  Trash2
} from 'lucide-react'
import type { Project, AISession, ProviderInfo } from '../../types'
import { useProjectStore } from '../../stores/projectStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { useGitBranch } from '../../hooks/useGitBranch'
import { getStatusColor, getStatusLabel } from '../../utils/statusColors'
import type { ProjectActivity } from '../../hooks/useProjectSessions'

interface ProjectItemProps {
  project: Project
  activity: ProjectActivity
  providers: ProviderInfo[]
  isDragging: boolean
  dragOverPosition: 'above' | 'below' | null
  onDragStart: (id: string) => void
  onDragOver: (id: string, e: React.DragEvent) => void
  onDrop: (id: string) => void
  onDragEnd: () => void
}

function relativeTime(date: Date | undefined): string {
  if (!date) return ''
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function ProjectItem({
  project,
  activity,
  providers,
  isDragging,
  dragOverPosition,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd
}: ProjectItemProps): React.JSX.Element {
  const expandedIds = useProjectStore((s) => s.expandedProjectIds)
  const toggleExpanded = useProjectStore((s) => s.toggleExpanded)
  const removeProject = useProjectStore((s) => s.removeProject)
  const startAISession = useProjectStore((s) => s.startAISession)
  const setActiveGroup = useTerminalStore((s) => s.setActiveGroup)
  const setActiveTerminalInGroup = useTerminalStore((s) => s.setActiveTerminalInGroup)
  const createTerminal = useTerminalStore((s) => s.createTerminal)
  const [canDrag, setCanDrag] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const dragHandleRef = useRef<HTMLSpanElement>(null)

  const isExpanded = expandedIds.has(project.id)
  const branch = useGitBranch(project.path)
  const { sessions, openTabs, activeCount, hasActive, latestStatus, lastActivity } = activity

  const statusColor = hasActive
    ? getStatusColor(latestStatus, true)
    : sessions.length > 0
      ? getStatusColor(undefined, false)
      : 'transparent'

  const handleFocusTab = (tabId: string, groupId: string): void => {
    setActiveGroup(groupId)
    setActiveTerminalInGroup(groupId, tabId)
  }

  const handleResumeSession = async (session: AISession): Promise<void> => {
    const cmd = await window.dplex.sessions.getResumeCommand(session.aiTool, session.id)
    if (!cmd) return
    useTerminalStore.getState().createTerminal(
      undefined,
      `↻ ${session.displayName}`,
      cmd,
      undefined,
      session.cwd
    )
  }

  return (
    <div
      data-reorderable-id={project.id}
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
          onDragOver(project.id, e)
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

        {/* Status dot */}
        {statusColor !== 'transparent' && (
          <span
            className={`flex-shrink-0 w-2 h-2 rounded-full ${hasActive ? 'dplex-pulse' : ''}`}
            style={{ backgroundColor: statusColor }}
          />
        )}

        {/* Expand chevron */}
        <span style={{ color: 'var(--dplex-text-muted)' }} className="flex-shrink-0">
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>

        {/* Folder icon */}
        <FolderOpen size={13} style={{ color: 'var(--dplex-accent)' }} className="flex-shrink-0" />

        {/* Project name + branch + last activity */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs truncate" style={{ color: 'var(--dplex-text)' }}>
              {project.name}
            </span>
            {activeCount > 0 && (
              <span
                className="text-[10px] font-medium flex-shrink-0 px-1 rounded"
                style={{ color: '#22c55e', backgroundColor: 'rgba(34,197,94,0.1)' }}
              >
                {activeCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            {branch ? (
              <>
                <GitBranch size={9} style={{ color: 'var(--dplex-text-muted)' }} className="flex-shrink-0" />
                <span className="text-[9px] truncate" style={{ color: 'var(--dplex-text-muted)' }}>
                  {branch}
                </span>
              </>
            ) : (
              <span className="text-[9px] truncate" style={{ color: 'var(--dplex-text-muted)' }}>
                {project.path}
              </span>
            )}
            {lastActivity && (
              <>
                <span className="text-[9px]" style={{ color: 'var(--dplex-text-muted)' }}>·</span>
                <span className="text-[9px] flex-shrink-0" style={{ color: 'var(--dplex-text-muted)' }}>
                  {relativeTime(lastActivity)}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Hover actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          {providers.map((p) => (
            <button
              key={p.id}
              onClick={(e) => {
                e.stopPropagation()
                startAISession(project, p.id)
              }}
              className="p-1 hover:bg-white/10 rounded transition-colors"
              style={{ color: 'var(--dplex-accent)' }}
              title={`Start ${p.name} session`}
            >
              <Play size={11} />
            </button>
          ))}
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
            <div
              className="absolute right-2 top-8 z-50 rounded shadow-xl py-1 min-w-[160px]"
              style={{ backgroundColor: 'var(--dplex-bg)', border: '1px solid var(--dplex-border)' }}
            >
              {providers.map((p) => (
                <button
                  key={p.id}
                  onClick={(e) => {
                    e.stopPropagation()
                    startAISession(project, p.id)
                    setShowMenu(false)
                  }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-white/10"
                  style={{ color: 'var(--dplex-text)' }}
                >
                  <Play size={11} /> Start {p.name}
                </button>
              ))}
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

              <div className="my-1" style={{ borderTop: '1px solid var(--dplex-border)' }} />

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
              {branch && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    navigator.clipboard.writeText(branch)
                    setShowMenu(false)
                  }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-white/10"
                  style={{ color: 'var(--dplex-text)' }}
                >
                  <GitBranch size={11} /> Copy Branch
                </button>
              )}

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

      {/* Expanded: session list */}
      {isExpanded && (
        <div className="ml-5 border-l" style={{ borderColor: 'var(--dplex-border)' }}>
          {!hasActive && openTabs.length === 0 ? (
            <div className="px-3 py-2 text-[10px]" style={{ color: 'var(--dplex-text-muted)' }}>
              No active sessions.
            </div>
          ) : (
            <>
              {openTabs.map((tab) => {
                const matchedSession = sessions.find((s) => s.id === tab.sessionId)
                return (
                  <div
                    key={tab.id}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 rounded-sm mx-1 cursor-pointer"
                    onClick={() => handleFocusTab(tab.id, tab.groupId)}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{
                        backgroundColor: matchedSession
                          ? getStatusColor(matchedSession.detailedStatus, matchedSession.status === 'active')
                          : '#22c55e'
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] truncate" style={{ color: 'var(--dplex-text)' }}>
                        {tab.title}
                      </div>
                      {matchedSession?.detailedStatus && matchedSession.detailedStatus !== 'idle' && (
                        <div className="text-[9px]" style={{ color: getStatusColor(matchedSession.detailedStatus) }}>
                          {getStatusLabel(matchedSession.detailedStatus)}
                        </div>
                      )}
                    </div>
                    <span
                      className="text-[9px] px-1 py-0.5 rounded flex-shrink-0"
                      style={{ color: '#22c55e', backgroundColor: 'rgba(34,197,94,0.1)' }}
                    >
                      OPEN
                    </span>
                  </div>
                )
              })}

              {sessions
                .filter((s) =>
                  s.status === 'active' &&
                  !openTabs.some((t) =>
                    t.sessionId === s.id ||
                    (t.command && t.command.includes(s.id))
                  )
                )
                .map((session) => (
                  <div
                    key={session.id}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 rounded-sm mx-1 cursor-pointer"
                    onClick={() => handleResumeSession(session)}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{
                        backgroundColor: getStatusColor(session.detailedStatus, session.status === 'active')
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] truncate" style={{ color: 'var(--dplex-text)' }}>
                        {session.displayName}
                      </div>
                      <div className="flex items-center gap-1 text-[9px]" style={{ color: 'var(--dplex-text-muted)' }}>
                        {session.detailedStatus && session.detailedStatus !== 'idle' ? (
                          <span style={{ color: getStatusColor(session.detailedStatus) }}>
                            {getStatusLabel(session.detailedStatus)}
                          </span>
                        ) : (
                          <span>{relativeTime(session.updatedAt)}</span>
                        )}
                        {session.messageCount != null && session.messageCount > 0 && (
                          <>
                            <span>·</span>
                            <span>{session.messageCount} prompts</span>
                          </>
                        )}
                      </div>
                    </div>
                    <span
                      className="text-[9px] px-1 py-0.5 rounded flex-shrink-0"
                      style={{ color: 'var(--dplex-text-muted)', backgroundColor: 'var(--dplex-bg)' }}
                    >
                      {session.aiTool === 'copilot-cli' ? 'Copilot' : session.aiTool}
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
