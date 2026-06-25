import { useMemo } from 'react'
import { Clock } from 'lucide-react'
import { useSessionStore } from '../../stores/sessionStore'
import { useProvidersStore } from '../../stores/providersStore'
import { focusSessionTab } from '../../utils/sessionTabs'
import { resumeSessionGuarded } from '../../stores/externalResumeConfirmStore'
import { EmptyState } from './EmptyState'
import {
  STATUS_LABEL,
  STATUS_VAR,
  effectiveStatus,
  recentSessions,
  timeAgo
} from '../../utils/dashboardMetrics'
import type { AISession } from '../../types'

/** Most-recent sessions with live status; click a row to open/resume it. */
export function RecentSessionsTable(): React.JSX.Element {
  const sessions = useSessionStore((s) => s.sessions)
  const getLabel = useProvidersStore((s) => s.getLabel)

  const rows = useMemo(() => recentSessions(sessions, 8), [sessions])

  const open = (session: AISession): void => {
    if (focusSessionTab(session.id, session.aiTool)) return
    resumeSessionGuarded(session)
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        Icon={Clock}
        title="No sessions yet"
        subtitle="Start an AI session and it will appear here."
      />
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {['Session', 'Tool', 'Repo / branch', 'Status', 'Msgs', 'Tools', 'Last active'].map(
              (h, i) => (
                <th
                  key={h}
                  className={`font-mono uppercase tracking-wider font-medium px-2.5 py-2 ${i >= 4 && i <= 5 ? 'text-right' : 'text-left'}`}
                  style={{
                    fontSize: 10,
                    color: 'var(--dplex-text-faint)',
                    borderBottom: '1px solid var(--dplex-border)'
                  }}
                >
                  {h}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const status = effectiveStatus(s)
            const color = STATUS_VAR[status]
            const repoBranch = [s.cwd ? basename(s.cwd) : null, s.branch]
              .filter(Boolean)
              .join(' · ')
            return (
              <tr
                key={`${s.aiTool}:${s.id}`}
                onClick={() => open(s)}
                className="cursor-pointer hover:bg-[var(--dplex-hover)]"
              >
                <td
                  className="px-2.5 py-2.5 text-[13px] max-w-[260px] truncate"
                  style={{
                    color: 'var(--dplex-text)',
                    borderBottom: '1px solid var(--dplex-border-subtle)'
                  }}
                  title={s.displayName}
                >
                  {s.displayName}
                </td>
                <td
                  className="px-2.5 py-2.5"
                  style={{ borderBottom: '1px solid var(--dplex-border-subtle)' }}
                >
                  <span
                    className="font-mono text-[11px] px-2 py-0.5 rounded-md"
                    style={{
                      color: 'var(--dplex-text-2)',
                      border: '1px solid var(--dplex-border)'
                    }}
                  >
                    {getLabel(s.aiTool)}
                  </span>
                </td>
                <td
                  className="px-2.5 py-2.5 font-mono text-[12px] max-w-[260px] truncate"
                  style={{
                    color: 'var(--dplex-text-muted)',
                    borderBottom: '1px solid var(--dplex-border-subtle)'
                  }}
                  title={s.cwd}
                >
                  {repoBranch || '—'}
                </td>
                <td
                  className="px-2.5 py-2.5"
                  style={{ borderBottom: '1px solid var(--dplex-border-subtle)' }}
                >
                  <span
                    className="inline-flex items-center gap-1.5 font-mono text-[10.5px] px-2 py-0.5 rounded-md"
                    style={{
                      color,
                      backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`
                    }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                    {STATUS_LABEL[status]}
                  </span>
                </td>
                <td
                  className="px-2.5 py-2.5 font-mono text-[12px] text-right"
                  style={{
                    color: 'var(--dplex-text-2)',
                    borderBottom: '1px solid var(--dplex-border-subtle)'
                  }}
                >
                  {s.messageCount ?? 0}
                </td>
                <td
                  className="px-2.5 py-2.5 font-mono text-[12px] text-right"
                  style={{
                    color: 'var(--dplex-text-2)',
                    borderBottom: '1px solid var(--dplex-border-subtle)'
                  }}
                >
                  {s.toolCallCount ?? 0}
                </td>
                <td
                  className="px-2.5 py-2.5 font-mono text-[12px]"
                  style={{
                    color: 'var(--dplex-text-dim)',
                    borderBottom: '1px solid var(--dplex-border-subtle)'
                  }}
                >
                  {timeAgo(s.updatedAt.getTime())}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function basename(p: string): string {
  const parts = p.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || p
}
