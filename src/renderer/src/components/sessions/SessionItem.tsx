import { useState } from 'react'
import { MoreVertical, Play, Trash2, Edit3 } from 'lucide-react'
import type { AISession } from '../../types'
import { useTerminalStore } from '../../stores/terminalStore'

interface SessionItemProps {
  session: AISession
  onDelete: (sessionId: string) => void
}

export function SessionItem({ session, onDelete }: SessionItemProps): JSX.Element {
  const createTab = useTerminalStore((s) => s.createTab)
  const [showMenu, setShowMenu] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(session.displayName)

  const handleResume = (): void => {
    const cmd = `copilot --resume=${session.id}`
    createTab(`↻ ${session.displayName}`, cmd)
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
      className="group flex items-center gap-2 px-3 py-1.5 hover:bg-[#1e1e38] cursor-pointer rounded-sm mx-1 relative"
      onClick={handleResume}
    >
      <div
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          session.status === 'active' ? 'bg-green-400' : 'bg-zinc-500'
        }`}
      />

      <div className="flex-1 min-w-0">
        {isRenaming ? (
          <input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => setIsRenaming(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') setIsRenaming(false)
            }}
            onClick={(e) => e.stopPropagation()}
            className="bg-[#2a2a4a] text-xs text-white w-full px-1 py-0.5 rounded outline-none border border-blue-500/50"
            autoFocus
          />
        ) : (
          <>
            <div className="text-xs text-zinc-200 truncate">{session.displayName}</div>
            <div className="text-[10px] text-zinc-500 truncate">
              {timeAgo(session.updatedAt)}
              {session.summary && ` · ${session.summary}`}
            </div>
          </>
        )}
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation()
          setShowMenu(!showMenu)
        }}
        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-white/10 rounded transition-opacity"
      >
        <MoreVertical size={12} className="text-zinc-400" />
      </button>

      {showMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
          <div className="absolute right-2 top-8 z-50 bg-[#2a2a4a] border border-[#3a3a5e] rounded shadow-xl py-1 min-w-[140px]">
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleResume()
              }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-zinc-200 hover:bg-[#3a3a5e]"
            >
              <Play size={11} /> Resume
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setIsRenaming(true)
                setShowMenu(false)
              }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-zinc-200 hover:bg-[#3a3a5e]"
            >
              <Edit3 size={11} /> Rename
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete(session.id)
                setShowMenu(false)
              }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-400 hover:bg-[#3a3a5e]"
            >
              <Trash2 size={11} /> Delete
            </button>
          </div>
        </>
      )}
    </div>
  )
}
