import { useState } from 'react'
import {
  MoreVertical,
  Play,
  Square,
  Trash2,
  GitBranch,
  MessageSquare,
  Wrench,
  Copy,
  FolderOpen,
  MessagesSquare
} from 'lucide-react'
import type { AISession, SessionStatus } from '../../types'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSessionStore } from '../../stores/sessionStore'

interface SessionItemProps {
  session: AISession
  onDelete: (sessionId: string) => void
  onShowPrompts?: (session: AISession) => void
}

const STATUS_CONFIG: Record<
  SessionStatus,
  { color: string; label: string; pulse: boolean }
> = {
  idle: { color: '#a6adc8', label: 'Idle', pulse: false },
  thinking: { color: '#89b4fa', label: 'Thinking', pulse: true },
  executingTool: { color: '#f9e2af', label: 'Running tool', pulse: true },
  awaitingApproval: { color: '#f38ba8', label: 'Needs approval', pulse: true },
  waitingForUser: { color: '#a6e3a1', label: 'Waiting for input', pulse: true }
}

/** Find an open tab matching this session and focus it. Checks sessionId first, then command. */
function focusExistingTab(sessionId: string, resumeCommand?: string): boolean {
  const { groups, setActiveGroup, setActiveTerminalInGroup } = useTerminalStore.getState()
  for (const group of groups) {
    const tab = group.tabs.find(
      (t) => t.sessionId === sessionId || (resumeCommand && t.command === resumeCommand)
    )
    if (tab) {
      setActiveGroup(group.id)
      setActiveTerminalInGroup(group.id, tab.id)
      return true
    }
  }
  return false
}

function hasOpenTab(sessionId: string): boolean {
  const { groups } = useTerminalStore.getState()
  return groups.some((g) => g.tabs.some((t) => t.sessionId === sessionId))
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

function folderName(p?: string): string {
  if (!p) return ''
  const parts = p.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || p
}

export function SessionItem({ session, onDelete, onShowPrompts }: SessionItemProps): React.JSX.Element {
  const createTerminal = useTerminalStore((s) => s.createTerminal)
  const closeSession = useSessionStore((s) => s.closeSession)
  const [showMenu, setShowMenu] = useState(false)

  const status = session.detailedStatus ?? (session.status === 'active' ? 'thinking' : 'idle')
  const config = STATUS_CONFIG[status]
  const isOpen = hasOpenTab(session.id)

  const handleResume = async (): Promise<void> => {
    const cmd = await window.dplex.sessions.getResumeCommand(session.aiTool, session.id)
    if (focusExistingTab(session.id, cmd ?? undefined)) {
      setShowMenu(false)
      return
    }
    if (!cmd) return
    createTerminal(undefined, `↻ ${session.displayName}`, cmd, undefined, session.cwd)
    setShowMenu(false)
  }

  const handleCopyCwd = (): void => {
    if (session.cwd) navigator.clipboard.writeText(session.cwd)
    setShowMenu(false)
  }

  const handleCopyId = (): void => {
    navigator.clipboard.writeText(session.id)
    setShowMenu(false)
  }

  return (
    <div
      className="group flex items-start gap-2 px-3 py-2 hover:bg-white/5 cursor-pointer rounded-sm mx-1 relative"
      onClick={handleResume}
      onContextMenu={(e) => {
        e.preventDefault()
        setShowMenu(!showMenu)
      }}
    >
      {/* Status dot */}
      <div className="flex-shrink-0 mt-1.5">
        <div
          className="w-2 h-2 rounded-full"
          style={{
            backgroundColor: config.color,
            animation: config.pulse ? 'pulse 2s ease-in-out infinite' : undefined
          }}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Row 1: name + badges */}
        <div className="flex items-center gap-1.5">
          <span
            className="text-xs font-medium truncate"
            style={{ color: 'var(--dplex-text)' }}
          >
            {session.displayName}
          </span>
          {isOpen && (
            <span className="text-[8px] font-bold px-1 rounded bg-blue-500/20 text-blue-400 flex-shrink-0">
              OPEN
            </span>
          )}
        </div>

        {/* Row 2: CWD subtitle */}
        {session.cwd && (
          <div
            className="text-[10px] truncate mt-0.5"
            style={{ color: 'var(--dplex-text-muted)' }}
          >
            {folderName(session.cwd)}
          </div>
        )}

        {/* Row 3: metadata chips */}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {/* Status label (only when non-idle) */}
          {status !== 'idle' && (
            <span
              className="text-[9px] font-medium"
              style={{ color: config.color }}
            >
              {config.label}
            </span>
          )}

          {/* Provider badge */}
          <span
            className="text-[9px] px-1 rounded"
            style={{
              color: 'var(--dplex-text-muted)',
              backgroundColor: 'var(--dplex-bg)',
              border: '1px solid var(--dplex-border)'
            }}
          >
            {session.aiTool === 'copilot-cli' ? 'Copilot' : session.aiTool}
          </span>

          {/* Branch */}
          {session.branch && (
            <span
              className="flex items-center gap-0.5 text-[9px]"
              style={{ color: 'var(--dplex-text-muted)' }}
            >
              <GitBranch size={8} />
              {session.branch}
            </span>
          )}

          {/* Prompt count */}
          {(session.messageCount ?? 0) > 0 && (
            <span
              className="flex items-center gap-0.5 text-[9px]"
              style={{ color: 'var(--dplex-text-muted)' }}
            >
              <MessageSquare size={8} />
              {session.messageCount}
            </span>
          )}

          {/* Tool count */}
          {(session.toolCallCount ?? 0) > 0 && (
            <span
              className="flex items-center gap-0.5 text-[9px]"
              style={{ color: 'var(--dplex-text-muted)' }}
            >
              <Wrench size={8} />
              {session.toolCallCount}
            </span>
          )}

          {/* Time */}
          <span className="text-[9px]" style={{ color: 'var(--dplex-text-muted)' }}>
            {timeAgo(session.updatedAt)}
          </span>
        </div>
      </div>

      {/* Three-dot menu button */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          setShowMenu(!showMenu)
        }}
        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-white/10 rounded transition-opacity flex-shrink-0 mt-0.5"
      >
        <MoreVertical size={12} style={{ color: 'var(--dplex-text-muted)' }} />
      </button>

      {/* Context menu */}
      {showMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setShowMenu(false) }} />
          <div
            className="absolute right-2 top-8 z-50 rounded shadow-xl py-1 min-w-[160px]"
            style={{
              backgroundColor: 'var(--dplex-bg)',
              border: '1px solid var(--dplex-border)'
            }}
          >
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleResume()
              }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-white/10"
              style={{ color: 'var(--dplex-text)' }}
            >
              <Play size={11} /> Resume
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onShowPrompts?.(session)
                setShowMenu(false)
              }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-white/10"
              style={{ color: 'var(--dplex-text)' }}
            >
              <MessagesSquare size={11} /> Show Prompts
            </button>
            {session.status === 'active' && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  closeSession(session.id)
                  setShowMenu(false)
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-white/10"
                style={{ color: 'var(--dplex-text)' }}
              >
                <Square size={11} /> Close
              </button>
            )}
            <div style={{ borderTop: '1px solid var(--dplex-border)' }} className="my-1" />
            {session.cwd && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleCopyCwd()
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-white/10"
                style={{ color: 'var(--dplex-text)' }}
              >
                <FolderOpen size={11} /> Copy Path
              </button>
            )}
            {session.branch && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  navigator.clipboard.writeText(session.branch!)
                  setShowMenu(false)
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-white/10"
                style={{ color: 'var(--dplex-text)' }}
              >
                <GitBranch size={11} /> Copy Branch
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleCopyId()
              }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-white/10"
              style={{ color: 'var(--dplex-text)' }}
            >
              <Copy size={11} /> Copy Session ID
            </button>
            <div style={{ borderTop: '1px solid var(--dplex-border)' }} className="my-1" />
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete(session.id)
                setShowMenu(false)
              }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-400 hover:bg-white/10"
            >
              <Trash2 size={11} /> Delete
            </button>
          </div>
        </>
      )}
    </div>
  )
}
