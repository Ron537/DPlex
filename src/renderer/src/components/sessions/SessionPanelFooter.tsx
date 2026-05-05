import { useMemo } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { STATUS_ACTIVE_COLOR } from '../../utils/statusColors'

/**
 * Small health summary shown under the Sessions panel. Mirrors
 * `ProjectPanelFooter` so both tabs share the same visual rhythm —
 * live indicator on the left, total count on the right.
 *
 * Lives in its own component so it subscribes to the session store
 * independently and SidePanel doesn't rerender every session tick.
 */
export function SessionPanelFooter(): React.JSX.Element {
  const sessions = useSessionStore((s) => s.sessions)
  const liveCount = useMemo(
    () => sessions.filter((s) => s.status === 'active').length,
    [sessions]
  )

  return (
    <div
      className="flex items-center gap-3 px-3 py-1.5 text-[10px] font-medium"
      style={{
        color: 'var(--dplex-text-muted)',
        borderTop: '1px solid var(--dplex-border)',
        backgroundColor: 'var(--dplex-bg-alt)'
      }}
    >
      <span className="inline-flex items-center gap-1">
        <span
          className="rounded-full"
          style={{
            width: 6,
            height: 6,
            backgroundColor: liveCount > 0 ? STATUS_ACTIVE_COLOR : 'var(--dplex-text-muted)',
            opacity: liveCount > 0 ? 1 : 0.5
          }}
        />
        {liveCount} live
      </span>
      <span style={{ opacity: 0.5 }}>·</span>
      <span>
        {sessions.length} session{sessions.length === 1 ? '' : 's'}
      </span>
    </div>
  )
}
