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
import { StatusAvatar } from '../common/StatusAvatar'
import { StatusDot } from '../common/StatusDot'
import { ProviderGlyph } from '../common/ProviderGlyph'
import { visualForStatus } from '../../utils/sessionStatusVisual'
import { closeOpenTabsForSession, focusSessionTab, hasOpenTab } from '../../utils/sessionTabs'

interface SessionItemProps {
  session: AISession
  onDelete: (sessionId: string) => void
  onShowPrompts?: (session: AISession) => void
  /** 'compact' hides CWD and "Pin as Project" — used inside project view */
  compact?: boolean
  /** Override the default click handler (resume/focus). Used to focus a specific tab. */
  onClick?: () => void
  /**
   * When true, the (yet-to-be-added) status avatar shows a small provider
   * corner badge. Wired here in the projects phase so call sites compile;
   * the visual lands in the sessions phase that swaps the avatar style.
   */
  showProviderBadge?: boolean
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
  onClick,
  showProviderBadge
}: SessionItemProps): React.JSX.Element {
  const createTerminal = useTerminalStore((s) => s.createTerminal)
  const closeSession = useSessionStore((s) => s.closeSession)
  const providerLabel = useProvidersStore((s) => s.getLabel(session.aiTool))
  const [showMenu, setShowMenu] = useState(false)
  const menuAnchorRef = useRef<HTMLButtonElement>(null)

  const status = session.detailedStatus ?? (session.status === 'active' ? 'thinking' : 'idle')
  const config = STATUS_CONFIG[status]
  const isOpen = hasOpenTab(session.id, session.aiTool)
  // The tab id (if any) backing this session — used for the
  // scroll-into-view selector when the active tab changes. Derived from
  // any group's tabs (not just the active one) so the highlight + scroll
  // also work for rows whose tab lives in an inactive group.
  const backingTabId = useTerminalStore((s) => {
    for (const group of s.groups) {
      for (const tab of group.tabs) {
        if (tab.kind === 'fileDiff') continue
        if (tab.providerId === session.aiTool && tab.sessionId === session.id) {
          return tab.id
        }
      }
    }
    return null
  })
  // Active when the editor's currently-focused tab is backed by this
  // session. Subscribed via Zustand so the row re-highlights immediately
  // on tab switch — no project click required.
  const isActiveTab = useTerminalStore((s) => {
    const group = s.groups.find((g) => g.id === s.activeGroupId)
    if (!group) return false
    const tab = group.tabs.find((t) => t.id === group.activeTabId)
    if (!tab || tab.kind === 'fileDiff') return false
    return tab.providerId === session.aiTool && tab.sessionId === session.id
  })

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
      data-row-tab-id={backingTabId ?? undefined}
      className={
        compact
          ? 'group flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--dplex-hover)] cursor-pointer rounded-md mx-1 relative'
          : 'group flex items-start gap-2.5 px-3 py-2 hover:bg-[var(--dplex-hover)] cursor-pointer rounded-md mx-1 relative'
      }
      style={
        isActiveTab
          ? {
              // Subtle "selected tab" lift — soft outer drop shadow with a
              // slight accent tint. Reads as elevation without competing
              // with the parent project's selection card.
              backgroundColor: 'var(--dplex-accent-faint)',
              boxShadow: '0 0 0 1px var(--dplex-accent-ring), 0 4px 12px -2px rgba(0,0,0,0.35)'
            }
          : undefined
      }
      onClick={onClick ?? handleResume}
      onContextMenu={(e) => {
        e.preventDefault()
        setShowMenu(!showMenu)
      }}
    >
      {compact ? (
        <>
          {/* Compact single-line layout: dot · glyph · "provider · title" · time.
              Used inside expanded project bodies where vertical real-estate
              is at a premium and each session shares the project's context. */}
          <StatusDot visual={visualForStatus(status)} title={config.label} />
          <ProviderGlyph providerId={session.aiTool} size="xs" title={providerLabel} />
          <span
            className="text-[12.5px] truncate flex-1 min-w-0"
            style={{ color: 'var(--dplex-text)', fontWeight: 500 }}
          >
            {session.displayName}
          </span>
          <span
            className="text-[10.5px] flex-shrink-0 tabular-nums"
            style={{ color: 'var(--dplex-text-dim)' }}
          >
            {timeAgo(session.updatedAt)}
          </span>
          <button
            ref={menuAnchorRef}
            onClick={(e) => {
              e.stopPropagation()
              setShowMenu(!showMenu)
            }}
            className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-[var(--dplex-hover)] rounded transition-opacity flex-shrink-0"
          >
            <MoreVertical size={11} style={{ color: 'var(--dplex-text-muted)' }} />
          </button>
        </>
      ) : (
        <>
          {/* Status avatar — replaces the bare dot. The avatar slot reflects
              state; the corner badge appears only when the surrounding list
              contains more than one provider (showProviderBadge prop). */}
          <div className="flex-shrink-0 mt-0.5">
            <StatusAvatar
              visual={visualForStatus(status)}
              providerId={session.aiTool}
              showProviderBadge={showProviderBadge}
              title={`${config.label} · ${providerLabel}`}
            />
          </div>

          {/* Main content */}
          <div className="flex-1 min-w-0">
            {/* Row 1: name + open-tab badge. Active-tab cue is a typographic
                color shift on the title — same pattern the active worktree
                section uses for its branch name, deliberately quiet so the
                parent project's selection card stays the dominant surface. */}
            <div className="flex items-center gap-1.5">
              <span
                className="text-[12.5px] font-medium truncate"
                style={{ color: 'var(--dplex-text)' }}
              >
                {session.displayName}
              </span>
              {isOpen && (
                <span
                  className="text-[8px] font-bold px-1 rounded flex-shrink-0"
                  style={{
                    color: 'var(--dplex-accent)',
                    backgroundColor: 'var(--dplex-accent-soft)'
                  }}
                >
                  OPEN
                </span>
              )}
            </div>

            {/* Row 2: CWD subtitle */}
            {session.cwd && (
              <div
                className="text-[10.5px] truncate mt-0.5"
                style={{ color: 'var(--dplex-text-muted)' }}
              >
                {folderName(session.cwd)}
              </div>
            )}

            {/* Row 3: metadata. Full chip row (branch, message count, tool
                count) is the global Sessions tab's signature density.
                `min-w-0` + an inner `truncate` on the branch chip stop
                long branch names from overflowing the row at narrow panel
                widths. */}
            <div
              className="flex items-center gap-2 mt-0.5 flex-wrap text-[10.5px] min-w-0"
              style={{ color: 'var(--dplex-text-muted)' }}
            >
              <span className="flex-shrink-0">{providerLabel}</span>

              {session.branch && (
                <>
                  <span className="flex-shrink-0" style={{ color: 'var(--dplex-text-dim)' }}>
                    ·
                  </span>
                  <span className="flex items-center gap-1 min-w-0 max-w-full">
                    <GitBranch size={9} className="flex-shrink-0" />
                    <span className="truncate">{session.branch}</span>
                  </span>
                </>
              )}

              {(session.messageCount ?? 0) > 0 && (
                <>
                  <span className="flex-shrink-0" style={{ color: 'var(--dplex-text-dim)' }}>
                    ·
                  </span>
                  <span className="flex items-center gap-1 flex-shrink-0">
                    <MessageSquare size={9} />
                    {session.messageCount}
                  </span>
                </>
              )}

              {(session.toolCallCount ?? 0) > 0 && (
                <>
                  <span className="flex-shrink-0" style={{ color: 'var(--dplex-text-dim)' }}>
                    ·
                  </span>
                  <span className="flex items-center gap-1 flex-shrink-0">
                    <Wrench size={9} />
                    {session.toolCallCount}
                  </span>
                </>
              )}

              <span className="flex-shrink-0" style={{ color: 'var(--dplex-text-dim)' }}>
                ·
              </span>
              <span className="flex-shrink-0">{timeAgo(session.updatedAt)}</span>
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
        </>
      )}

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
