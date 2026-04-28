import { useRef, useState } from 'react'
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
  MessagesSquare,
  FolderPlus
} from 'lucide-react'
import type { AISession, SessionStatus } from '../../types'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useProjectStore } from '../../stores/projectStore'
import { useProvidersStore } from '../../stores/providersStore'
import { PopoverMenu } from '../common/PopoverMenu'
import { closeOpenTabsForSession, focusSessionTab, hasOpenTab } from '../../utils/sessionTabs'

interface SessionItemProps {
  session: AISession
  onDelete: (sessionId: string) => void
  onShowPrompts?: (session: AISession) => void
  /** 'compact' hides CWD and "Pin as Project" — used inside project view */
  compact?: boolean
  /** Override the default click handler (resume/focus). Used to focus a specific tab. */
  onClick?: () => void
}

const STATUS_CONFIG: Record<SessionStatus, { color: string; label: string; pulse: boolean }> = {
  idle: { color: 'var(--dplex-status-idle)', label: 'Idle', pulse: false },
  thinking: { color: 'var(--dplex-status-thinking)', label: 'Thinking', pulse: true },
  executingTool: { color: 'var(--dplex-status-executing)', label: 'Running tool', pulse: true },
  awaitingApproval: { color: 'var(--dplex-status-approval)', label: 'Needs approval', pulse: true },
  waitingForUser: { color: 'var(--dplex-status-waiting)', label: 'Waiting for input', pulse: true }
}

/**
 * Find an open tab matching this session and focus it. Uses composite
 * identity (providerId + sessionId) to avoid cross-provider ID collisions,
 * with a resume-command fallback for legacy tabs missing providerId.
 */

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

export function SessionItem({
  session,
  onDelete,
  onShowPrompts,
  compact,
  onClick
}: SessionItemProps): React.JSX.Element {
  const createTerminal = useTerminalStore((s) => s.createTerminal)
  const closeSession = useSessionStore((s) => s.closeSession)
  const providerLabel = useProvidersStore((s) => s.getLabel(session.aiTool))
  const [showMenu, setShowMenu] = useState(false)
  const menuAnchorRef = useRef<HTMLButtonElement>(null)

  const status = session.detailedStatus ?? (session.status === 'active' ? 'thinking' : 'idle')
  const config = STATUS_CONFIG[status]
  const isOpen = hasOpenTab(session.id, session.aiTool)

  const handleResume = async (): Promise<void> => {
    const cmd = await window.dplex.sessions.getResumeCommand(session.aiTool, session.id)
    if (focusSessionTab(session.id, session.aiTool, cmd ?? undefined)) {
      setShowMenu(false)
      return
    }
    if (!cmd) return
    createTerminal(
      undefined,
      `↻ ${session.displayName}`,
      cmd,
      undefined,
      session.cwd,
      session.aiTool
    )
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
      className="group flex items-start gap-2 px-3 py-2 hover:bg-[var(--dplex-hover)] cursor-pointer rounded-sm mx-1 relative"
      onClick={onClick ?? handleResume}
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
          <span className="text-xs font-medium truncate" style={{ color: 'var(--dplex-text)' }}>
            {session.displayName}
          </span>
          {isOpen && (
            <span
              className="text-[8px] font-bold px-1 rounded flex-shrink-0"
              style={{
                color: 'var(--dplex-accent)',
                backgroundColor: 'color-mix(in srgb, var(--dplex-accent) 15%, transparent)'
              }}
            >
              OPEN
            </span>
          )}
        </div>

        {/* Row 2: CWD subtitle */}
        {!compact && session.cwd && (
          <div className="text-[10px] truncate mt-0.5" style={{ color: 'var(--dplex-text-muted)' }}>
            {folderName(session.cwd)}
          </div>
        )}

        {/* Row 3: metadata chips */}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {/* Status label (only when non-idle) */}
          {status !== 'idle' && (
            <span className="text-[9px] font-medium" style={{ color: config.color }}>
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
            {providerLabel}
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
        ref={menuAnchorRef}
        onClick={(e) => {
          e.stopPropagation()
          setShowMenu(!showMenu)
        }}
        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-[var(--dplex-hover)] rounded transition-opacity flex-shrink-0 mt-0.5"
      >
        <MoreVertical size={12} style={{ color: 'var(--dplex-text-muted)' }} />
      </button>

      {/* Context menu */}
      <PopoverMenu
        anchorRef={menuAnchorRef}
        open={showMenu}
        onClose={() => setShowMenu(false)}
        className="min-w-[160px]"
      >
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleResume()
          }}
          className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
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
          className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
          style={{ color: 'var(--dplex-text)' }}
        >
          <MessagesSquare size={11} /> Show Prompts
        </button>
        {session.status === 'active' && (
          <button
            onClick={async (e) => {
              e.stopPropagation()
              setShowMenu(false)
              // Try to close the corresponding tab(s) — include legacy tabs
              // that only match by their resume command.
              const cmd = await window.dplex.sessions
                .getResumeCommand(session.aiTool, session.id)
                .catch(() => null)
              closeOpenTabsForSession(session.id, session.aiTool, cmd ?? undefined)
              // Always close the on-disk session too: legacy tabs without
              // providerId aren't killed by closeTerminal's guarded path, and
              // sessions.close is idempotent for already-dead sessions.
              closeSession(session.id)
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
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
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
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
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
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
          className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
          style={{ color: 'var(--dplex-text)' }}
        >
          <Copy size={11} /> Copy Session ID
        </button>
        {!compact && session.cwd && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              useProjectStore.getState().addProject(session.cwd)
              setShowMenu(false)
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
            style={{ color: 'var(--dplex-text)' }}
          >
            <FolderPlus size={11} /> Pin as Project
          </button>
        )}
        <div style={{ borderTop: '1px solid var(--dplex-border)' }} className="my-1" />
        <button
          onClick={async (e) => {
            e.stopPropagation()
            setShowMenu(false)
            // Close the corresponding tab(s) — include legacy tabs matched
            // by resume command. onDelete handles the on-disk teardown.
            const cmd = await window.dplex.sessions
              .getResumeCommand(session.aiTool, session.id)
              .catch(() => null)
            closeOpenTabsForSession(session.id, session.aiTool, cmd ?? undefined)
            onDelete(session.id)
          }}
          className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-400 hover:bg-[var(--dplex-hover)]"
        >
          <Trash2 size={11} /> Delete
        </button>
      </PopoverMenu>
    </div>
  )
}
