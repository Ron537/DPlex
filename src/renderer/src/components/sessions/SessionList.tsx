import { useMemo } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { SessionItem } from './SessionItem'
import { Loader2 } from 'lucide-react'

export function SessionList(): JSX.Element {
  const sessions = useSessionStore((s) => s.sessions)
  const searchQuery = useSessionStore((s) => s.searchQuery)
  const loading = useSessionStore((s) => s.loading)
  const error = useSessionStore((s) => s.error)
  const deleteSession = useSessionStore((s) => s.deleteSession)

  const { active, idle } = useMemo(() => {
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
      idle: filtered.filter((s) => s.status === 'idle')
    }
  }, [sessions, searchQuery])

  if (loading && active.length === 0 && idle.length === 0) {
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

  if (active.length === 0 && idle.length === 0) {
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
          <div className="px-3 py-1 text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
            Active ({active.length})
          </div>
          {active.map((session) => (
            <SessionItem key={session.id} session={session} onDelete={deleteSession} />
          ))}
        </div>
      )}

      {idle.length > 0 && (
        <div>
          <div className="px-3 py-1 text-[10px] font-medium text-zinc-500 uppercase tracking-wider mt-1">
            Idle ({idle.length})
          </div>
          {idle.map((session) => (
            <SessionItem key={session.id} session={session} onDelete={deleteSession} />
          ))}
        </div>
      )}
    </div>
  )
}
