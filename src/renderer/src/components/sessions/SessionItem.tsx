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
import { closeOpenTabsForSession, hasOpenTab } from '../../utils/sessionTabs'
import { resumeSessionGuarded } from '../../stores/externalResumeConfirmStore'
import { timeAgo } from '../../utils/timeAgo'

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
  /**
   * When true, the row is an AI session running outside DPlex (no DPlex tab
   * backs it). Renders a small muted "External" chip after the title.
   */
  external?: boolean
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

function folderName(p?: string): string {
  if (!p) return ''
  const parts = p.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || p
}

/**
 * Small muted tag marking a session that runs outside DPlex. Paired with
 * the `ExternalSessionsDivider` caption in the projects panel.
 */
function ExternalChip(): React.JSX.Element {
  return (
    <span
      className="flex-shrink-0 text-[8.5px] font-semibold uppercase tracking-wide rounded px-1.5 leading-[15px]"
      style={{
        color: 'var(--dplex-text-muted)',
        background: 'var(--dplex-bg-alt)',
        border: '1px solid var(--dplex-border)'
      }}
      title="Started outside DPlex"
    >
      External
    </span>
  )
}

export function SessionItem({
  session,
  onDelete,
  onShowPrompts,
  compact,
  onClick,
  showProviderBadge,
  external
}: SessionItemProps): React.JSX.Element {
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
        if (tab.kind === 'fileDiff' || tab.kind === 'fileEditor' || tab.kind === 'dashboard')
          continue
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
    if (!tab || tab.kind === 'fileDiff' || tab.kind === 'fileEditor' || tab.kind === 'dashboard')
      return false
    return tab.providerId === session.aiTool && tab.sessionId === session.id
  })

  const handleResume = (): void => {
    setShowMenu(false)
    // Resuming a session that's running outside DPlex opens a second
    // connection to it — `resumeSessionGuarded` confirms first for those,
    // and resumes owned/idle sessions directly.
    resumeSessionGuarded(session)
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
          : 'group flex items-start gap-2.5 pl-4 pr-3 py-2 hover:bg-[var(--dplex-hover)] cursor-pointer rounded-md mx-1 relative transition-colors'
      }
      style={
        isActiveTab
          ? {
              // v2 selection: matches project rows, activity-bar items, and
              // the search palette — accent-soft fill + 2 px left stripe
              // with a soft accent glow. Replaces the older ring +
              // drop-shadow framing which read as a "card" instead of a
              // "selected list item".
              backgroundColor: 'var(--dplex-accent-soft)'
            }
          : undefined
      }
      onClick={onClick ?? handleResume}
      onContextMenu={(e) => {
        e.preventDefault()
        setShowMenu(!showMenu)
      }}
    >
      {!compact && isActiveTab && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 4,
            top: 6,
            bottom: 6,
            width: 2,
            borderRadius: '0 2px 2px 0',
            backgroundColor: 'var(--dplex-accent)',
            boxShadow: '0 0 8px var(--dplex-accent-glow)',
            pointerEvents: 'none'
          }}
        />
      )}
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
          {external && <ExternalChip />}
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
          {/* Status avatar — same as before. Carries the AI status visual,
              plus a corner provider badge when the surrounding list spans
              multiple providers. */}
          <div className="flex-shrink-0 mt-0.5">
            <StatusAvatar
              visual={visualForStatus(status)}
              providerId={session.aiTool}
              showProviderBadge={showProviderBadge}
              title={`${config.label} · ${providerLabel}`}
            />
          </div>

          {/* Main content */}
          <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 1 }}>
            {/* Row 1 — title, optional `open` dot, and time-ago.
                Time on the right matches the project-row pattern; OPEN
                shrinks from a pill to a 6 px accent dot beside the title
                so it reads as "subtle status flag" instead of competing
                for horizontal space. */}
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className="flex-1 truncate"
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--dplex-text)',
                  letterSpacing: '-0.005em'
                }}
              >
                {session.displayName}
              </span>
              {external && <ExternalChip />}
              {isOpen && (
                <span
                  aria-label="Open in a tab"
                  title="Open in a tab"
                  className="flex-shrink-0 rounded-full"
                  style={{
                    width: 6,
                    height: 6,
                    backgroundColor: 'var(--dplex-accent)',
                    boxShadow: '0 0 4px var(--dplex-accent-glow)'
                  }}
                />
              )}
              <span
                className="flex-shrink-0 tabular-nums"
                style={{
                  fontSize: 10.5,
                  color: 'var(--dplex-text-dim)'
                }}
              >
                {timeAgo(session.updatedAt)}
              </span>
            </div>

            {/* Row 2 — subtitle: cwd · branch. Provider is conveyed by
                the avatar's corner glyph (when the list spans multiple
                providers); no need to repeat it as text. Each segment
                renders only when present. `min-w-0` on the cwd lets it
                truncate before the branch chip. */}
            {(session.cwd || session.branch) && (
              <div
                className="flex items-center min-w-0"
                style={{ gap: 5, fontSize: 11, color: 'var(--dplex-text-muted)' }}
              >
                {session.cwd && <span className="truncate min-w-0">{folderName(session.cwd)}</span>}
                {session.cwd && session.branch && (
                  <span style={{ color: 'var(--dplex-text-dim)' }}>·</span>
                )}
                {session.branch && (
                  <span
                    className="flex items-center gap-1 flex-shrink-0"
                    style={{ minWidth: 0, maxWidth: '50%' }}
                  >
                    <GitBranch size={9} className="flex-shrink-0" />
                    <span className="truncate">{session.branch}</span>
                  </span>
                )}
              </div>
            )}

            {/* Row 3 — metrics. Only renders when at least one counter is
                non-zero, so quiet sessions stay 2-line and chatty ones
                lift to 3. Muted to read clearly as secondary data. */}
            {((session.messageCount ?? 0) > 0 || (session.toolCallCount ?? 0) > 0) && (
              <div
                className="flex items-center"
                style={{
                  gap: 8,
                  marginTop: 3,
                  fontSize: 10.5,
                  color: 'var(--dplex-text-dim)'
                }}
              >
                {(session.messageCount ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <MessageSquare size={9} />
                    {session.messageCount}
                  </span>
                )}
                {(session.toolCallCount ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <Wrench size={9} />
                    {session.toolCallCount}
                  </span>
                )}
              </div>
            )}
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
        {session.status === 'active' && !external && (
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
        {!external && (
          <>
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
          </>
        )}
      </PopoverMenu>
    </div>
  )
}
