import { useMemo } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { useProjectStore } from '../../stores/projectStore'
import { buildProjectSessionIndex } from '../../hooks/useProjectSessions'
import { STATUS_ACTIVE_COLOR } from '../../utils/statusColors'

/**
 * Small health summary shown under the Projects panel. Counts are computed
 * from the same shared activity index used to render the list, so the footer
 * can't disagree with the badges above it.
 *
 * Lives in its own component so it subscribes to the stores independently —
 * SidePanel doesn't rerender every session tick.
 */
export function ProjectPanelFooter(): React.JSX.Element {
  const projects = useProjectStore((s) => s.projects)
  const sessions = useSessionStore((s) => s.sessions)
  const groups = useTerminalStore((s) => s.groups)

  const liveCount = useMemo(() => {
    const paths = projects.map((p) => p.path)
    const index = buildProjectSessionIndex(sessions, groups, paths)
    let live = 0
    for (const activity of index.values()) {
      if (activity.hasActive) live++
    }
    return live
  }, [projects, sessions, groups])

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
        {projects.length} project{projects.length === 1 ? '' : 's'}
      </span>
    </div>
  )
}
