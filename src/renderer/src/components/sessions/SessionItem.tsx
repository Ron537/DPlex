import { useState } from 'react'
import { MoreVertical, Play, Square, Trash2 } from 'lucide-react'
import type { AISession } from '../../types'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSessionStore } from '../../stores/sessionStore'

interface SessionItemProps {
  session: AISession
  onDelete: (sessionId: string) => void
}

export function SessionItem({ session, onDelete }: SessionItemProps): JSX.Element {
  const createTerminal = useTerminalStore((s) => s.createTerminal)
  const closeSession = useSessionStore((s) => s.closeSession)
  const [showMenu, setShowMenu] = useState(false)

  const handleResume = async (): Promise<void> => {
    const cmd = await window.dplex.sessions.getResumeCommand(session.aiTool, session.id)
    if (!cmd) return
    createTerminal(undefined, `↻ ${session.displayName}`, cmd, undefined, session.cwd)
    setShowMenu(false)
  }

  const timeAgo = (date: Date): string => {
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
    if (seconds < 60) return 'just now'
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  return (
    <div
      className="group flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 cursor-pointer rounded-sm mx-1 relative"
      onClick={handleResume}
    >
      <div
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          session.status === 'active' ? 'bg-green-400' : 'bg-zinc-500'
        }`}
      />

      <div className="flex-1 min-w-0">
        <div className="text-xs truncate" style={{ color: 'var(--dplex-text)' }}>{session.displayName}</div>
        <div className="text-[10px] truncate" style={{ color: 'var(--dplex-text-muted)' }}>
          {timeAgo(session.updatedAt)}
        </div>
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation()
          setShowMenu(!showMenu)
        }}
        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-white/10 rounded transition-opacity"
      >
        <MoreVertical size={12} style={{ color: 'var(--dplex-text-muted)' }} />
      </button>

      {showMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
          <div className="absolute right-2 top-8 z-50 rounded shadow-xl py-1 min-w-[140px]" style={{ backgroundColor: 'var(--dplex-bg)', border: '1px solid var(--dplex-border)' }}>
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
