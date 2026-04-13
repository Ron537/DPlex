import { useMemo, useState } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { SessionItem } from './SessionItem'
import { Loader2, ChevronRight, ChevronDown } from 'lucide-react'
import type { AISession } from '../../types'
import type { SessionGroupMode } from '../layout/SidePanel'

interface SessionListProps {
  groupMode: SessionGroupMode
}

interface SessionGroup {
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

function groupByTime(sessions: AISession[]): SessionGroup[] {
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

function folderName(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || p
}

function groupByWorkspace(sessions: AISession[]): SessionGroup[] {
  const map = new Map<string, AISession[]>()

  for (const session of sessions) {
    const label = session.cwd ? folderName(session.cwd) : 'Unknown'
    if (!map.has(label)) map.set(label, [])
    map.get(label)!.push(session)
  }

  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, sessions]) => ({ label, sessions }))
}

export function SessionList({ groupMode }: SessionListProps): React.JSX.Element {
  const sessions = useSessionStore((s) => s.sessions)
  const searchQuery = useSessionStore((s) => s.searchQuery)
  const loading = useSessionStore((s) => s.loading)
  const error = useSessionStore((s) => s.error)
  const deleteSession = useSessionStore((s) => s.deleteSession)

  const { active, groups } = useMemo(() => {
    const q = searchQuery.toLowerCase()
    const filtered = q
      ? sessions.filter(
          (s) =>
            s.displayName.toLowerCase().includes(q) ||
            s.id.toLowerCase().includes(q) ||
            (s.summary && s.summary.toLowerCase().includes(q)) ||
            (s.cwd && s.cwd.toLowerCase().includes(q))
        )
      : sessions

    const idle = filtered.filter((s) => s.status === 'idle')
    return {
      active: filtered.filter((s) => s.status === 'active'),
      groups: groupMode === 'time' ? groupByTime(idle) : groupByWorkspace(idle)
    }
  }, [sessions, searchQuery, groupMode])

  if (loading && active.length === 0 && groups.length === 0) {
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

  if (active.length === 0 && groups.length === 0) {
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
        <CollapsibleGroup label={`Active (${active.length})`} accent>
          {active.map((session) => (
            <SessionItem key={session.id} session={session} onDelete={deleteSession} />
          ))}
        </CollapsibleGroup>
      )}

      {groups.map((group) => (
        <CollapsibleGroup key={group.label} label={group.label}>
          {group.sessions.map((session) => (
            <SessionItem key={session.id} session={session} onDelete={deleteSession} />
          ))}
        </CollapsibleGroup>
      ))}
    </div>
  )
}

function CollapsibleGroup({ label, accent, children }: {
  label: string
  accent?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1 w-full px-2 py-1 mt-1 text-[10px] font-medium uppercase tracking-wider hover:bg-white/5 transition-colors"
        style={{ color: accent ? 'var(--dplex-accent)' : 'var(--dplex-text-muted)' }}
      >
        {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
        {label}
      </button>
      {!collapsed && children}
    </div>
  )
}
