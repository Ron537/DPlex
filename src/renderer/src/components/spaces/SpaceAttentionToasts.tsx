import { useMemo, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useAttentionStore } from '../../stores/attentionStore'
import { useSpaceStore } from '../../stores/spaceStore'
import { makeCompositeId, type AttentionKind } from '../../../../preload/attentionTypes'
import {
  aggregateSpaceAttention,
  attentionKindLabel,
  spaceAttentionHighWater
} from '../../utils/spaceAttention'
import type { Space } from '../../types'
import { SpaceAvatar } from './SpaceAvatar'
import { attentionColorVar, isAiSessionTab, terminalTabs } from './spaceVisuals'

/**
 * Bottom-right pings for backgrounded spaces that need a decision. A space you
 * stepped away from can still raise an approval/input request while you work
 * elsewhere — this surfaces it and offers a one-click Resume. Derived purely
 * from attention state; a toast clears itself when its space no longer needs
 * you. DPlex reads only the attention signal, never session content.
 *
 * Toasts are dismissable: dismissing hides the ping without touching the
 * underlying attention state, so activity-bar badges and rings stay intact. We
 * remember a per-space "high-water mark" — the timestamp of the newest request
 * dismissed — and re-show the toast only when that space raises a *newer*
 * request. Existing requests persisting or partially resolving keep it hidden.
 */
export function SpaceAttentionToasts(): JSX.Element | null {
  const spaces = useSpaceStore((s) => s.spaces)
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId)
  const events = useAttentionStore((s) => s.active)
  // Per-space dismissal: the newest request timestamp the user has cleared.
  const [dismissed, setDismissed] = useState<Record<string, number>>({})

  const candidates = useMemo(
    () =>
      spaces
        .filter((s) => s.id !== activeSpaceId)
        .map((s) => ({
          space: s,
          total: aggregateSpaceAttention(s, events).total,
          highWater: spaceAttentionHighWater(s, events)
        }))
        .filter((p) => p.total > 0),
    [spaces, activeSpaceId, events]
  )

  // Show a space's ping unless every request up to its newest has been
  // dismissed. A newer request lifts the high-water mark above the dismissed
  // value and the toast returns; persistence or partial resolution never does.
  const pings = candidates.filter((c) => c.highWater > (dismissed[c.space.id] ?? 0)).slice(0, 3)

  if (pings.length === 0) return null

  return createPortal(
    <div
      className="fixed z-[2400] flex flex-col items-end"
      style={{ right: 20, bottom: 44, gap: 10 }}
    >
      {pings.map(({ space, highWater }) => (
        <Toast
          key={space.id}
          space={space}
          events={events}
          onDismiss={() =>
            // Record this space's high-water mark and, in the same pass, drop
            // marks for spaces that no longer need attention — keeping the map
            // bounded to currently-pinging spaces without a cleanup effect.
            setDismissed((prev) => {
              const next: Record<string, number> = {}
              for (const c of candidates) {
                const mark = c.space.id === space.id ? highWater : prev[c.space.id]
                if (mark !== undefined) next[c.space.id] = mark
              }
              return next
            })
          }
        />
      ))}
    </div>,
    document.body
  )
}

function Toast({
  space,
  events,
  onDismiss
}: {
  space: Space
  events: ReturnType<typeof useAttentionStore.getState>['active']
  onDismiss: () => void
}): JSX.Element {
  // Find the first pending session in this space to describe the ping.
  const tabs = terminalTabs(space.workspace)
  let title = 'A session'
  let kind: AttentionKind = 'waitingForApproval'
  for (const t of tabs) {
    if (!isAiSessionTab(t) || !t.providerId || !t.sessionId) continue
    const e = events.find(
      (ev) => ev.compositeId === makeCompositeId(t.providerId!, t.sessionId!) && !ev.suppressed
    )
    if (e) {
      title = t.title
      kind = e.kind
      break
    }
  }
  const color = attentionColorVar(kind)

  return (
    <div
      className="flex items-center gap-3 dplex-slidein"
      style={{
        padding: '12px 14px',
        borderRadius: 13,
        maxWidth: 340,
        backgroundColor: 'var(--dplex-bg-elev)',
        border: `1px solid color-mix(in srgb, ${color} 40%, var(--dplex-border))`,
        boxShadow: '0 24px 50px -22px rgba(0,0,0,0.7)'
      }}
    >
      <SpaceAvatar space={space} size={32} radius={10} ping />
      <div className="flex-1 min-w-0">
        <b
          className="block truncate"
          style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--dplex-text)' }}
        >
          {space.name}
        </b>
        <small
          className="block truncate"
          style={{ fontSize: 11, color: 'var(--dplex-text-dim)', marginTop: 1 }}
        >
          {title} · {attentionKindLabel(kind, true)}
        </small>
      </div>
      <button
        type="button"
        data-testid={`space-toast-resume-${space.id}`}
        onClick={() => useSpaceStore.getState().switchSpace(space.id)}
        className="flex-shrink-0 transition-colors"
        style={{
          fontSize: 11.5,
          fontWeight: 700,
          padding: '6px 10px',
          borderRadius: 8,
          color,
          backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`
        }}
      >
        Resume ▸
      </button>
      <button
        type="button"
        aria-label={`Dismiss ${space.name} notification`}
        data-testid={`space-toast-dismiss-${space.id}`}
        onClick={onDismiss}
        className="flex-shrink-0 p-1 rounded transition-colors hover:bg-[var(--dplex-hover)]"
        style={{ color: 'var(--dplex-text-dim)' }}
      >
        <X size={13} />
      </button>
    </div>
  )
}
