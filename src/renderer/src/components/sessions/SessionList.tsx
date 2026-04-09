import { useMemo } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { SessionItem } from './SessionItem'
import { Loader2 } from 'lucide-react'
import type { AISession } from '../../types'

interface TimeGroup {
  label: string
  sessions: AISession[]
}

function getTimeGroupLabel(date: Date): string {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfYesterday = new Date(startOfToday.getTime() - 86400000)
  const startOfLastWeek = new Date(startOfToday.getTime() - 7 * 86400000)
  const startOfLastMonth = new Date(startOfToday.getTime() - 30 * 86400000)

  const ts = date.getTime()
  if (ts >= startOfToday.getTime()) return 'Today'
  if (ts >= startOfYesterday.getTime()) return 'Yesterday'
  if (ts >= startOfLastWeek.getTime()) return 'Last 7 Days'
  if (ts >= startOfLastMonth.getTime()) return 'Last 30 Days'
  return 'Older'
}

function groupByTime(sessions: AISession[]): TimeGroup[] {
  const order = ['Today', 'Yesterday', 'Last 7 Days', 'Last 30 Days', 'Older']
  const map = new Map<string, AISession[]>()

  for (const session of sessions) {
    const label = getTimeGroupLabel(new Date(session.updatedAt))
    if (!map.has(label)) map.set(label, [])
    map.get(label)!.push(session)
  }

  return order
    .filter((label) => map.has(label))
    .map((label) => ({ label, sessions: map.get(label)! }))
}

export function SessionList(): JSX.Element {
  const sessions = useSessionStore((s) => s.sessions)
  const searchQuery = useSessionStore((s) => s.searchQuery)
  const loading = useSessionStore((s) => s.loading)
  const error = useSessionStore((s) => s.error)
  const deleteSession = useSessionStore((s) => s.deleteSession)

  const { active, timeGroups } = useMemo(() => {
    const q = searchQuery.toLowerCase()
    const filtered = q
      ? sessions.filter(
          (s) =>
            s.displayName.toLowerCase().includes(q) ||
            s.id.toLowerCase().includes(q) ||
            (s.summary && s.summary.toLowerCase().includes(q))
        )
      : sessions

    return {
      active: filtered.filter((s) => s.status === 'active'),
      timeGroups: groupByTime(filtered.filter((s) => s.status === 'idle'))
    }
  }, [sessions, searchQuery])

  if (loading && active.length === 0 && timeGroups.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-zinc-500">
        <Loader2 size={16} className="animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-3 py-4 text-xs text-red-400">
        Failed to load sessions
      </div>
    )
  }

  if (active.length === 0 && timeGroups.length === 0) {
    return (
      <div className="px-3 py-8 text-xs text-zinc-500 text-center">
        No sessions found.
        <br />
        <span className="text-zinc-600">
          Sessions from your AI tool will appear here.
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      {active.length > 0 && (
        <div>
          <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--dplex-accent)' }}>
            Active ({active.length})
          </div>
          {active.map((session) => (
            <SessionItem key={session.id} session={session} onDelete={deleteSession} />
          ))}
        </div>
      )}

      {timeGroups.map((group) => (
        <div key={group.label}>
          <div className="px-3 py-1 text-[10px] font-medium text-zinc-500 uppercase tracking-wider mt-1">
            {group.label}
          </div>
          {group.sessions.map((session) => (
            <SessionItem key={session.id} session={session} onDelete={deleteSession} />
          ))}
        </div>
      ))}
    </div>
  )
}
