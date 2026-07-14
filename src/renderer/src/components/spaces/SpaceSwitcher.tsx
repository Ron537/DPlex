import { useEffect, useRef, useState, type JSX } from 'react'
import { Check, ChevronDown, LayoutGrid, Layers, Plus } from 'lucide-react'
import { useAttentionStore } from '../../stores/attentionStore'
import { useSpaceStore } from '../../stores/spaceStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSpacesUiStore } from '../../stores/spacesUiStore'
import { useSpaceAttention } from '../../hooks/useSpaceAttention'
import { useSpaceWorkspace } from '../../hooks/useSpaceWorkspace'
import { aggregateActiveAwareAttention } from '../../utils/spaceAttention'
import { MOD, SHIFT, isMac } from '../../utils/shortcuts'
import type { Space } from '../../types'
import { SpaceAvatar } from './SpaceAvatar'
import { AttentionChip } from './AttentionChip'
import { SpaceQuickStart } from './SpaceQuickStart'
import { sessionCount } from './spaceVisuals'

/**
 * Always-visible bar above the workspace showing the space in focus plus a
 * quick-switch dropdown and a "new session" quick-start. Switching from here
 * auto-backgrounds the current space (it keeps running). Only rendered when a
 * space is in focus — the Overview is the switch surface when nothing is in
 * focus.
 */
export function SpaceSwitcher(): JSX.Element | null {
  const spaces = useSpaceStore((s) => s.spaces)
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId)
  const active = spaces.find((s) => s.id === activeSpaceId) ?? null

  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Close the dropdown on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!active) return null

  return (
    <div
      ref={rootRef}
      className="relative flex items-center flex-shrink-0"
      style={{
        height: 48,
        gap: 10,
        padding: '0 12px',
        backgroundColor: 'var(--dplex-bg-panel)',
        borderBottom: '1px solid var(--dplex-border-subtle)'
      }}
    >
      <SwitcherButton space={active} open={open} onToggle={() => setOpen((v) => !v)} />
      <div className="flex-1" />
      <SpaceQuickStart space={active} />
      <div style={{ width: 1, height: 20, backgroundColor: 'var(--dplex-border-subtle)' }} />
      <button
        type="button"
        title="Open Overview — step back and see every space"
        aria-label="Open Overview"
        data-testid="space-switcher-overview"
        onClick={() => useSpaceStore.getState().sendToBackground()}
        className="inline-flex items-center gap-1.5 rounded-lg transition-colors hover:bg-[var(--dplex-hover)]"
        style={{
          height: 28,
          padding: '0 10px',
          color: 'var(--dplex-text-muted)',
          fontSize: 12,
          fontWeight: 600
        }}
      >
        <LayoutGrid size={14} />
        Overview
      </button>
      {open && <SwitcherDropdown activeSpaceId={activeSpaceId} onClose={() => setOpen(false)} />}
    </div>
  )
}

function SwitcherButton({
  space,
  open,
  onToggle
}: {
  space: Space
  open: boolean
  onToggle: () => void
}): JSX.Element {
  const attention = useSpaceAttention(space)
  const ws = useSpaceWorkspace(space)
  const projects = space.projectIds.length
  const sessions = sessionCount(ws)
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      data-testid="space-switcher-button"
      className="flex items-center gap-2.5 text-left transition-colors"
      style={{
        maxWidth: 340,
        height: 34,
        padding: '0 9px',
        borderRadius: 9,
        backgroundColor: open ? 'var(--dplex-hover)' : 'transparent'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--dplex-hover)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = open ? 'var(--dplex-hover)' : 'transparent'
      }}
    >
      <SpaceAvatar space={space} size={22} />
      <span
        className="truncate"
        style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--dplex-text)', maxWidth: 190 }}
      >
        {space.name}
      </span>
      {attention.total > 0 ? (
        <AttentionChip attention={attention} />
      ) : (
        <span
          className="tabular-nums flex-shrink-0"
          style={{ fontSize: 11, color: 'var(--dplex-text-dim)' }}
        >
          {projects} proj · {sessions} {sessions === 1 ? 'session' : 'sessions'}
        </span>
      )}
      <ChevronDown
        size={14}
        className="flex-shrink-0"
        style={{
          color: 'var(--dplex-text-dim)',
          transition: 'transform 0.2s',
          transform: open ? 'rotate(180deg)' : 'none'
        }}
      />
    </button>
  )
}

function SwitcherDropdown({
  activeSpaceId,
  onClose
}: {
  activeSpaceId: string | null
  onClose: () => void
}): JSX.Element {
  const spaces = useSpaceStore((s) => s.spaces)
  const events = useAttentionStore((s) => s.active)
  // Live groups drive the active space's attention so a just-started session
  // counts immediately; background spaces read their stashed snapshot.
  const liveGroups = useTerminalStore((s) => s.groups)
  const openCreate = useSpacesUiStore((s) => s.openCreate)

  return (
    <div
      className="absolute z-40 dplex-pop"
      style={{
        left: 10,
        top: 'calc(100% - 2px)',
        width: 300,
        padding: 7,
        borderRadius: 13,
        backgroundColor: 'var(--dplex-bg-elev)',
        border: '1px solid var(--dplex-border-strong)',
        boxShadow: '0 30px 60px -24px rgba(0,0,0,0.7)'
      }}
    >
      <div className="flex items-center justify-between" style={{ padding: '6px 8px 8px' }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.14em',
            color: 'var(--dplex-text-faint)'
          }}
        >
          Switch spaces
        </span>
        <button
          type="button"
          onClick={() => {
            onClose()
            openCreate()
          }}
          className="inline-flex items-center gap-1.5 rounded-lg transition-colors hover:bg-[var(--dplex-accent-soft)]"
          style={{
            padding: '4px 8px',
            fontSize: 11.5,
            fontWeight: 600,
            color: 'var(--dplex-accent)'
          }}
        >
          <Plus size={13} />
          New space
        </button>
      </div>

      <div className="max-h-[300px] overflow-y-auto dplex-scroll-autohide">
        {spaces.map((s, i) => {
          const isActive = s.id === activeSpaceId
          const a = aggregateActiveAwareAttention(
            s,
            events,
            isActive ? { groups: liveGroups } : null
          )
          const subtitle =
            s.projectIds.length > 0
              ? `${s.projectIds.length} project${s.projectIds.length !== 1 ? 's' : ''}`
              : 'no projects'
          return (
            <button
              key={s.id}
              type="button"
              data-testid={`space-switch-${s.id}`}
              onClick={() => {
                onClose()
                if (!isActive) useSpaceStore.getState().switchSpace(s.id)
              }}
              className="w-full flex items-center gap-2.5 text-left transition-colors"
              style={{
                padding: '8px 9px',
                borderRadius: 9,
                backgroundColor: isActive ? 'var(--dplex-accent-soft)' : 'transparent'
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.backgroundColor = 'var(--dplex-hover)'
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'
              }}
            >
              <SpaceAvatar space={s} size={26} ping={a.total > 0 && !isActive} />
              <span className="flex-1 min-w-0">
                <span
                  className="block truncate"
                  style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--dplex-text)' }}
                >
                  {s.name}
                </span>
                <span
                  className="block truncate"
                  style={{ fontSize: 10.5, color: 'var(--dplex-text-dim)' }}
                >
                  {subtitle}
                </span>
              </span>
              {a.total > 0 ? (
                <AttentionChip attention={a} compact />
              ) : isActive ? (
                <Check size={15} style={{ color: 'var(--dplex-accent)', flexShrink: 0 }} />
              ) : (
                i < 9 &&
                !(isMac && (i === 2 || i === 3 || i === 4)) && (
                  <kbd
                    className="flex-shrink-0 tabular-nums"
                    style={{
                      fontSize: 10,
                      fontFamily: 'inherit',
                      color: 'var(--dplex-text-faint)',
                      padding: '1px 5px',
                      borderRadius: 5,
                      border: '1px solid var(--dplex-border)',
                      backgroundColor: 'var(--dplex-bg-elev-2)',
                      lineHeight: 1.5
                    }}
                  >
                    {MOD}
                    {SHIFT}
                    {i + 1}
                  </kbd>
                )
              )}
            </button>
          )
        })}
      </div>

      <button
        type="button"
        data-testid="space-switcher-open-overview"
        onClick={() => {
          onClose()
          useSpaceStore.getState().sendToBackground()
        }}
        className="w-full flex items-center gap-2 transition-colors hover:bg-[var(--dplex-hover)]"
        style={{
          marginTop: 4,
          padding: '8px 9px',
          borderRadius: 9,
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--dplex-text-2)'
        }}
      >
        <LayoutGrid size={14} style={{ color: 'var(--dplex-text-dim)' }} />
        Open Overview
        <Layers size={12} style={{ marginLeft: 'auto', color: 'var(--dplex-text-faint)' }} />
      </button>
    </div>
  )
}
