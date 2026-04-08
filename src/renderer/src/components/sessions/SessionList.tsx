import { useSessionStore } from '../../stores/sessionStore'
import { SessionItem } from './SessionItem'
import { Loader2 } from 'lucide-react'

export function SessionList(): JSX.Element {
  const { active, idle } = useSessionStore((s) => s.getFilteredSessions())
  const loading = useSessionStore((s) => s.loading)
  const error = useSessionStore((s) => s.error)
  const deleteSession = useSessionStore((s) => s.deleteSession)

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
