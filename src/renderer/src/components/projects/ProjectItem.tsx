import { useState, useRef } from 'react'
import {
  ChevronRight,
  ChevronDown,
  Play,
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
import { useSessionStore } from '../../stores/sessionStore'
import { useGitBranch } from '../../hooks/useGitBranch'
import { STATUS_ACTIVE_COLOR, STATUS_ACTIVE_BG } from '../../utils/statusColors'
import { SessionItem } from '../sessions/SessionItem'
import { PromptsDialog } from '../sessions/PromptsDialog'
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
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const [canDrag, setCanDrag] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [promptsSession, setPromptsSession] = useState<AISession | null>(null)
  const dragHandleRef = useRef<HTMLSpanElement>(null)

  const isExpanded = expandedIds.has(project.id)
  const branch = useGitBranch(project.path)
  const { sessions, openTabs, activeCount, hasActive, lastActivity } = activity

  const handleFocusTab = (tabId: string, groupId: string): void => {
    setActiveGroup(groupId)
    setActiveTerminalInGroup(groupId, tabId)
  }

  return (
    <div
      data-reorderable-id={project.id}
      className="mb-2"
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      {/* Drop indicator above */}
      {dragOverPosition === 'above' && (
        <div className="mx-2 h-0.5 rounded" style={{ backgroundColor: 'var(--dplex-accent)' }} />
      )}

      {/* Project section header */}
      <div
        data-project-id={project.id}
        className="group flex items-center gap-1.5 px-2 py-1.5 cursor-pointer relative"
        style={{
          backgroundColor: 'var(--dplex-bg-alt)',
          borderBottom: '1px solid var(--dplex-border)'
        }}
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
          className="flex-shrink-0 cursor-grab opacity-0 group-hover:opacity-40 hover:!opacity-80 transition-opacity"
          style={{ color: 'var(--dplex-text-muted)' }}
          onMouseDown={() => setCanDrag(true)}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical size={11} />
        </span>

        {/* Chevron */}
        <span style={{ color: 'var(--dplex-accent)' }} className="flex-shrink-0">
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>

        {/* Name + count */}
        <span
          className="text-[11px] font-semibold truncate"
          style={{ color: 'var(--dplex-text)' }}
        >
          {project.name}
        </span>
        {activeCount > 0 && (
          <span
            className="text-[10px] font-semibold flex-shrink-0 min-w-[16px] text-center px-1 rounded-full"
            style={{ color: STATUS_ACTIVE_COLOR, backgroundColor: STATUS_ACTIVE_BG }}
          >
            {activeCount}
          </span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Action buttons — always visible */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          {providers.map((p) => (
            <button
              key={p.id}
              onClick={(e) => {
                e.stopPropagation()
                startAISession(project, p.id)
              }}
              className="p-1 hover:bg-[var(--dplex-hover)] rounded transition-colors"
              style={{ color: 'var(--dplex-text-muted)' }}
              title={`Start ${p.name}`}
            >
              <Play size={11} />
            </button>
          ))}
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowMenu(!showMenu)
            }}
            className="p-1 hover:bg-[var(--dplex-hover)] rounded transition-colors"
            style={{ color: 'var(--dplex-text-muted)' }}
            title="More actions"
          >
            <MoreVertical size={11} />
          </button>
        </div>

        {/* Context menu */}
        {showMenu && (
          <>
            <div className="fixed inset-0 z-[55]" onClick={(e) => { e.stopPropagation(); setShowMenu(false) }} />
            <div
              className="absolute right-2 top-full mt-1 z-[60] rounded-md shadow-xl py-1 min-w-[160px]"
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
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
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
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
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
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
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
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
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
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-400 hover:bg-[var(--dplex-hover)]"
              >
                <Trash2 size={11} /> Remove Project
              </button>
            </div>
          </>
        )}
      </div>

      {/* Expanded: sessions */}
      {isExpanded && (
        <div style={{ backgroundColor: 'var(--dplex-bg)' }}>
          {/* Branch + last activity info */}
          {(branch || lastActivity) && (
            <div
              className="flex items-center gap-1.5 px-3 py-1 text-[10px]"
              style={{ color: 'var(--dplex-text-muted)' }}
            >
              {branch && (
                <span className="flex items-center gap-0.5">
                  <GitBranch size={10} className="flex-shrink-0" />
                  <span className="truncate">{branch}</span>
                </span>
              )}
              {lastActivity && (
                <>
                  {branch && <span style={{ opacity: 0.4 }}>·</span>}
                  <span className="flex-shrink-0">{relativeTime(lastActivity)}</span>
                </>
              )}
            </div>
          )}

          {!hasActive && openTabs.length === 0 ? (
            <div
              className="px-3 py-2 text-[10px]"
              style={{ color: 'var(--dplex-text-muted)' }}
            >
              No active sessions.
            </div>
          ) : (
            <>
              {/* Sessions from open tabs (matched to discovered sessions) */}
              {openTabs.map((tab) => {
                const matchedSession = sessions.find((s) => s.id === tab.sessionId)
                if (matchedSession) {
                  return (
                    <SessionItem
                      key={tab.id}
                      session={matchedSession}
                      onDelete={deleteSession}
                      onShowPrompts={setPromptsSession}
                      compact
                      onClick={() => handleFocusTab(tab.id, tab.groupId)}
                    />
                  )
                }
                // Tab without a resolved session yet — simple placeholder row
                return (
                  <div
                    key={tab.id}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--dplex-hover)] cursor-pointer rounded-sm mx-1"
                    onClick={() => handleFocusTab(tab.id, tab.groupId)}
                  >
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: STATUS_ACTIVE_COLOR }}
                    />
                    <span
                      className="text-xs truncate"
                      style={{ color: 'var(--dplex-text)' }}
                    >
                      {tab.title}
                    </span>
                  </div>
                )
              })}

              {/* Active sessions not yet open in a tab */}
              {sessions
                .filter((s) =>
                  s.status === 'active' &&
                  !openTabs.some((t) =>
                    t.sessionId === s.id ||
                    (t.command && t.command.includes(s.id))
                  )
                )
                .map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    onDelete={deleteSession}
                    onShowPrompts={setPromptsSession}
                    compact
                  />
                ))}
            </>
          )}
        </div>
      )}

      {/* Prompts dialog for project sessions */}
      {promptsSession && (
        <PromptsDialog
          sessionId={promptsSession.id}
          sessionName={promptsSession.displayName}
          providerId={promptsSession.aiTool}
          onClose={() => setPromptsSession(null)}
        />
      )}

      {/* Drop indicator below */}
      {dragOverPosition === 'below' && (
        <div className="mx-2 h-0.5 rounded" style={{ backgroundColor: 'var(--dplex-accent)' }} />
      )}
    </div>
  )
}
