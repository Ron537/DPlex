import { useMemo } from 'react'
import { AlertTriangle, MessageSquare, CheckCircle2 } from 'lucide-react'
import { useAttentionStore } from '../../stores/attentionStore'
import { useSessionStore } from '../../stores/sessionStore'
import { focusSessionTab } from '../../utils/sessionTabs'
import { resumeSessionGuarded } from '../../stores/externalResumeConfirmStore'
import { timeAgo } from '../../utils/dashboardMetrics'
import { EmptyState } from './EmptyState'
import type { AttentionEvent, AttentionKind } from '../../../../preload/attentionTypes'

const KIND_META: Record<
  AttentionKind,
  { Icon: typeof AlertTriangle; color: string; verb: string }
> = {
  waitingForApproval: {
    Icon: AlertTriangle,
    color: 'var(--dplex-status-approval)',
    verb: 'needs approval'
  },
  waitingForInput: {
    Icon: MessageSquare,
    color: 'var(--dplex-status-waiting)',
    verb: 'is waiting for you'
  },
  finished: {
    Icon: CheckCircle2,
    color: 'var(--dplex-status-success)',
    verb: 'finished its turn'
  }
}

/** Sort order: approval → input → finished, then most-recent first. */
const KIND_RANK: Record<AttentionKind, number> = {
  waitingForApproval: 0,
  waitingForInput: 1,
  finished: 2
}

/** Live feed of sessions that need the user, straight from the attention inbox. */
export function AttentionFeed(): React.JSX.Element {
  const active = useAttentionStore((s) => s.active)
  const sessions = useSessionStore((s) => s.sessions)

  const events = useMemo(
    () =>
      [...active]
        .filter((e) => !e.suppressed)
        .sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || b.createdAt - a.createdAt)
        .slice(0, 8),
    [active]
  )

  const openEvent = (e: AttentionEvent): void => {
    if (focusSessionTab(e.sessionId, e.providerId)) return
    const session = sessions.find((s) => s.id === e.sessionId && s.aiTool === e.providerId)
    if (session) resumeSessionGuarded(session)
  }

  if (events.length === 0) {
    return (
      <EmptyState
        Icon={CheckCircle2}
        title="You're all caught up"
        subtitle="No sessions are waiting on your input or approval."
      />
    )
  }

  return (
    <div className="flex flex-col">
      {events.map((e) => {
        const meta = KIND_META[e.kind]
        const { Icon } = meta
        return (
          <button
            key={e.compositeId + e.createdAt}
            type="button"
            onClick={() => openEvent(e)}
            className="flex items-start gap-3 p-2 rounded-lg text-left hover:bg-[var(--dplex-hover)] transition-colors"
          >
            <span
              className="w-7 h-7 rounded-lg grid place-items-center flex-shrink-0"
              style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 14%, transparent)` }}
            >
              <Icon size={15} style={{ color: meta.color }} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] truncate" style={{ color: 'var(--dplex-text-2)' }}>
                <b style={{ color: 'var(--dplex-text)', fontWeight: 600 }}>{e.displayName}</b>{' '}
                {meta.verb}
              </div>
              <div
                className="text-[11px] font-mono mt-0.5"
                style={{ color: 'var(--dplex-text-dim)' }}
              >
                {e.providerId}
              </div>
            </div>
            <span
              className="text-[11px] font-mono flex-shrink-0 whitespace-nowrap"
              style={{ color: 'var(--dplex-text-faint)' }}
            >
              {timeAgo(e.createdAt)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
