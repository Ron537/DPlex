import { type JSX } from 'react'
import { createPortal } from 'react-dom'
import { useAttentionStore } from '../../stores/attentionStore'
import { useSpaceStore } from '../../stores/spaceStore'
import { makeCompositeId, type AttentionKind } from '../../../../preload/attentionTypes'
import { aggregateSpaceAttention, attentionKindLabel } from '../../utils/spaceAttention'
import type { Space } from '../../types'
import { SpaceAvatar } from './SpaceAvatar'
import { attentionColorVar, isAiSessionTab, terminalTabs } from './spaceVisuals'

/**
 * Bottom-right pings for backgrounded spaces that need a decision. A space you
 * stepped away from can still raise an approval/input request while you work
 * elsewhere — this surfaces it and offers a one-click Resume. Derived purely
 * from attention state; a toast clears itself when its space no longer needs
 * you. DPlex reads only the attention signal, never session content.
 */
export function SpaceAttentionToasts(): JSX.Element | null {
  const spaces = useSpaceStore((s) => s.spaces)
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId)
  const events = useAttentionStore((s) => s.active)

  const pings = spaces
    .filter((s) => s.id !== activeSpaceId)
    .map((s) => ({ space: s, attention: aggregateSpaceAttention(s, events) }))
    .filter((p) => p.attention.total > 0)
    .slice(0, 3)

  if (pings.length === 0) return null

  return createPortal(
    <div
      className="fixed z-[2400] flex flex-col items-end"
      style={{ right: 20, bottom: 44, gap: 10 }}
    >
      {pings.map(({ space }) => (
        <Toast key={space.id} space={space} events={events} />
      ))}
    </div>,
    document.body
  )
}

function Toast({
  space,
  events
}: {
  space: Space
  events: ReturnType<typeof useAttentionStore.getState>['active']
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
    </div>
  )
}
