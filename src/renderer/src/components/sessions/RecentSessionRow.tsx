import { useCallback, type JSX } from 'react'
import type { AISession } from '../../types'
import { useTerminalStore } from '../../stores/terminalStore'
import { focusSessionTab } from '../../utils/sessionTabs'
import { timeAgo } from '../../utils/timeAgo'

interface RecentSessionRowProps {
  session: AISession
}

/**
 * Slim, muted "history" row used inside a project's expanded body to
 * surface recent (idle) sessions without the visual weight of the full
 * `SessionItem`. No status dot, no message-count chip, no inline menu —
 * the lighter weight signals "past" so live rows above stand out.
 *
 * The row is dimmed at rest and brightens on hover via the
 * `.recent-session-row` rule in main.css. The leading icon was dropped
 * because the surrounding "Recent" section already communicates the
 * row's nature — adding a clock per row was visual noise.
 *
 * Click resumes via the same path as `SessionItem.handleResume`: focus
 * any open tab backing this session, otherwise spawn a new terminal
 * with the provider's resume command.
 */
export function RecentSessionRow({ session }: RecentSessionRowProps): JSX.Element {
  const createTerminal = useTerminalStore((s) => s.createTerminal)
  const lastTime = session.lastActivityTime ? new Date(session.lastActivityTime) : session.updatedAt

  const handleResume = useCallback(async () => {
    const cmd = await window.dplex.sessions.getResumeCommand(session.aiTool, session.id)
    if (focusSessionTab(session.id, session.aiTool, cmd ?? undefined)) return
    if (!cmd) return
    createTerminal(
      undefined,
      `↻ ${session.displayName}`,
      cmd,
      undefined,
      session.cwd,
      session.aiTool
    )
  }, [createTerminal, session])

  return (
    <div
      className="group flex items-center gap-2 px-3 py-[3px] mx-1 rounded-[5px] cursor-pointer recent-session-row"
      onClick={handleResume}
      title={session.displayName}
    >
      <span
        className="flex-1 min-w-0 truncate"
        style={{ fontSize: 12, color: 'var(--dplex-text)' }}
      >
        {session.displayName}
      </span>
      <span
        className="flex-shrink-0 tabular-nums"
        style={{ fontSize: 10, color: 'var(--dplex-text-dim)' }}
      >
        {timeAgo(lastTime, { short: true })}
      </span>
      {/* Phantom spacer: matches the width of `SessionItem`'s hidden
          MoreVertical button (~15px) so the time-ago column aligns
          vertically with the active rows above. */}
      <span aria-hidden="true" className="flex-shrink-0" style={{ width: 15 }} />
    </div>
  )
}
