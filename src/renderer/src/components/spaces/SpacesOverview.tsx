import { type JSX } from 'react'
import { Clock, FolderGit2, Layers, Play, Plus, Terminal } from 'lucide-react'
import { useAttentionStore } from '../../stores/attentionStore'
import { useProjectStore } from '../../stores/projectStore'
import { useSpaceStore } from '../../stores/spaceStore'
import { useSpacesUiStore } from '../../stores/spacesUiStore'
import { makeCompositeId, type AttentionEvent } from '../../../../preload/attentionTypes'
import { aggregateSpaceAttention, attentionKindLabel } from '../../utils/spaceAttention'
import { ProviderGlyph } from '../common/ProviderGlyph'
import type { ProviderId } from '../../utils/providerHelpers'
import type { Space, TerminalTab } from '../../types'
import { SpaceAvatar } from './SpaceAvatar'
import {
  attentionColorVar,
  boundProjects,
  isAiSessionTab,
  relativeTime,
  shade,
  terminalTabs
} from './spaceVisuals'

/**
 * Mission-control home base, shown in the workspace area when no space is in
 * focus. A grid of space cards (live status, projects, sessions, attention,
 * last-active) — the "leave and return" surface. Everything on it keeps
 * running in the background; resuming a card brings it back into focus without
 * restarting anything.
 */
export function SpacesOverview(): JSX.Element {
  const spaces = useSpaceStore((s) => s.spaces)
  const openCreate = useSpacesUiStore((s) => s.openCreate)

  return (
    <div
      className="absolute inset-0 flex flex-col overflow-hidden"
      style={{
        background:
          'radial-gradient(1000px 560px at 82% -6%, var(--dplex-accent-faint), transparent 60%), var(--dplex-bg)'
      }}
    >
      <div className="flex items-end gap-4 flex-wrap" style={{ padding: '26px 34px 8px' }}>
        <div>
          <h1
            className="flex items-center gap-3 font-extrabold"
            style={{ fontSize: 22, letterSpacing: '-0.4px', color: 'var(--dplex-text)' }}
          >
            Spaces
            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--dplex-text-dim)' }}>
              — your work, ready to return to
            </span>
          </h1>
          <p
            style={{ fontSize: 13, fontWeight: 500, color: 'var(--dplex-text-dim)', marginTop: 4 }}
          >
            Everything keeps running in the background. Sessions still think, run, and ask for you —
            DPlex just holds the window.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          data-testid="overview-new-space"
          className="ml-auto inline-flex items-center gap-2"
          style={{
            padding: '9px 15px',
            borderRadius: 10,
            fontSize: 12.5,
            fontWeight: 600,
            color: '#fff',
            background: 'linear-gradient(135deg, var(--dplex-accent), var(--dplex-accent-2))',
            boxShadow: '0 8px 22px -10px var(--dplex-accent-glow)'
          }}
        >
          <Plus size={16} />
          New space
        </button>
      </div>

      <div
        className="flex-1 min-h-0 overflow-y-auto dplex-scroll-autohide"
        style={{ padding: '16px 30px 30px' }}
      >
        <div
          className="grid"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(304px, 1fr))',
            gap: 16
          }}
        >
          {spaces.map((s, i) => (
            <SpaceCard key={s.id} space={s} index={i} />
          ))}
          <button
            type="button"
            onClick={openCreate}
            className="dplex-space-card grid place-items-center transition-colors"
            style={{
              ['--dplex-card-i' as string]: spaces.length,
              minHeight: 220,
              borderRadius: 16,
              border: '1px dashed var(--dplex-border-strong)',
              background: 'transparent',
              color: 'var(--dplex-text-muted)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--dplex-accent)'
              e.currentTarget.style.backgroundColor = 'var(--dplex-accent-soft)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--dplex-border-strong)'
              e.currentTarget.style.backgroundColor = 'transparent'
            }}
          >
            <span className="text-center">
              <span
                className="grid place-items-center mx-auto"
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  marginBottom: 12,
                  backgroundColor: 'var(--dplex-bg-elev)',
                  border: '1px solid var(--dplex-border)',
                  color: 'var(--dplex-accent)'
                }}
              >
                <Plus size={22} />
              </span>
              <span
                className="block font-bold"
                style={{ fontSize: 14, color: 'var(--dplex-text-2)' }}
              >
                New space
              </span>
              <span className="block" style={{ fontSize: 11.5 }}>
                Group projects &amp; sessions into a fresh activity
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}

function SpaceCard({ space, index }: { space: Space; index: number }): JSX.Element {
  const events = useAttentionStore((s) => s.active)
  const attention = aggregateSpaceAttention(space, events)
  const projects = useProjectStore((s) => s.projects)
  const rename = useSpacesUiStore((s) => s.openRename)
  const requestDelete = useSpacesUiStore((s) => s.requestDelete)

  const tabs = terminalTabs(space.workspace)
  const bound = boundProjects(space, projects)

  const resume = (): void => useSpaceStore.getState().switchSpace(space.id)

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`space-card-${space.id}`}
      onClick={resume}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          resume()
        }
      }}
      className="dplex-space-card group relative flex flex-col overflow-hidden cursor-pointer"
      style={{
        ['--dplex-card-i' as string]: index,
        borderRadius: 16,
        backgroundColor: 'var(--dplex-bg-elev)',
        border: '1px solid var(--dplex-border)',
        transition:
          'transform 0.18s cubic-bezier(0.2,0.7,0.3,1), box-shadow 0.18s, border-color 0.18s'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-4px)'
        e.currentTarget.style.borderColor = 'var(--dplex-border-strong)'
        e.currentTarget.style.boxShadow = '0 26px 50px -26px rgba(0,0,0,0.7)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'none'
        e.currentTarget.style.borderColor = 'var(--dplex-border)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(420px 150px at 20% -10%, color-mix(in srgb, ${space.color} 22%, transparent), transparent 70%)`
        }}
      />

      {/* top */}
      <div className="relative flex items-start gap-3" style={{ padding: '16px 16px 12px' }}>
        <SpaceAvatar
          space={space}
          size={40}
          radius={12}
          ping={attention.total > 0}
          style={{ boxShadow: `0 6px 16px -8px ${shade(space.color, -20)}` }}
        />
        <div className="flex-1 min-w-0">
          <div
            className="truncate font-extrabold"
            style={{ fontSize: 15.5, letterSpacing: '-0.2px', color: 'var(--dplex-text)' }}
          >
            {space.name}
          </div>
          <div
            className="flex items-center gap-1.5"
            style={{ fontSize: 11, color: 'var(--dplex-text-dim)', marginTop: 2 }}
          >
            <Clock size={11} />
            {relativeTime(space.lastActiveAt)}
          </div>
        </div>
        <AttentionTag attention={attention.total} />
      </div>

      {/* body */}
      <div className="relative flex-1" style={{ padding: '0 16px 14px' }}>
        <div className="flex flex-wrap gap-1.5" style={{ marginBottom: 12 }}>
          {bound.length > 0 ? (
            bound.map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center gap-1"
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: 'var(--dplex-text-muted)',
                  backgroundColor: 'var(--dplex-bg-elev-2)',
                  border: '1px solid var(--dplex-border)',
                  borderRadius: 6,
                  padding: '2px 6px'
                }}
              >
                <FolderGit2 size={10} style={{ opacity: 0.7 }} />
                {p.name}
              </span>
            ))
          ) : (
            <span style={{ fontSize: 10, color: 'var(--dplex-text-dim)' }}>
              {tabs.length > 0 ? 'no projects · loose sessions' : 'no projects'}
            </span>
          )}
        </div>

        {tabs.length > 0 && (
          <div
            className="flex flex-col overflow-hidden"
            style={{ borderRadius: 10, border: '1px solid var(--dplex-border-subtle)', gap: 1 }}
          >
            {tabs.slice(0, 4).map((t) => (
              <SessionRow key={t.id} tab={t} events={events} />
            ))}
          </div>
        )}
      </div>

      {/* footer */}
      <div
        className="relative flex items-center gap-2.5"
        style={{
          padding: '11px 16px',
          borderTop: '1px solid var(--dplex-border-subtle)',
          backgroundColor: 'color-mix(in srgb, var(--dplex-bg-alt) 60%, transparent)'
        }}
      >
        <span
          className="inline-flex items-center gap-1.5"
          style={{ fontSize: 11, color: 'var(--dplex-text-dim)', fontWeight: 500 }}
        >
          <Layers size={12} />
          {tabs.length} session{tabs.length !== 1 ? 's' : ''}
        </span>
        <span
          className="inline-flex items-center gap-1.5"
          style={{ fontSize: 11, color: 'var(--dplex-text-dim)', fontWeight: 500 }}
        >
          <FolderGit2 size={12} />
          {space.projectIds.length} proj
        </span>
        <span
          className="absolute inset-y-0 right-0 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{
            paddingLeft: 28,
            paddingRight: 16,
            background:
              'linear-gradient(90deg, transparent, var(--dplex-bg-elev) 22%, var(--dplex-bg-elev) 100%)'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => rename(space.id)}
            className="transition-colors"
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: '5px 11px',
              borderRadius: 8,
              backgroundColor: 'var(--dplex-bg-elev-2)',
              color: 'var(--dplex-text-2)'
            }}
          >
            Rename
          </button>
          <button
            type="button"
            data-testid={`card-delete-${space.id}`}
            onClick={() => requestDelete({ id: space.id, name: space.name })}
            className="transition-colors"
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: '5px 11px',
              borderRadius: 8,
              backgroundColor: 'var(--dplex-bg-elev-2)',
              color: 'var(--dplex-text-2)'
            }}
          >
            Delete
          </button>
          <button
            type="button"
            data-testid={`card-resume-${space.id}`}
            onClick={resume}
            className="inline-flex items-center gap-1"
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: '5px 11px',
              borderRadius: 8,
              color: '#fff',
              backgroundColor: space.color
            }}
          >
            <Play size={11} />
            Resume
          </button>
        </span>
      </div>
    </div>
  )
}

function AttentionTag({ attention }: { attention: number }): JSX.Element | null {
  if (attention <= 0) return null
  return (
    <span
      style={{
        fontSize: 9.5,
        fontWeight: 800,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        padding: '3px 8px',
        borderRadius: 20,
        flexShrink: 0,
        color: 'var(--dplex-status-approval)',
        backgroundColor: 'color-mix(in srgb, var(--dplex-status-approval) 16%, transparent)'
      }}
    >
      {attention} need{attention > 1 ? '' : 's'} you
    </span>
  )
}

function SessionRow({
  tab,
  events
}: {
  tab: TerminalTab
  events: readonly AttentionEvent[]
}): JSX.Element {
  const ai = isAiSessionTab(tab)
  const event =
    ai && tab.providerId && tab.sessionId
      ? events.find(
          (e) => e.compositeId === makeCompositeId(tab.providerId!, tab.sessionId!) && !e.suppressed
        )
      : undefined
  const color = event ? attentionColorVar(event.kind) : 'var(--dplex-text-dim)'
  const statusLabel = event ? attentionKindLabel(event.kind) : ai ? 'Session' : 'Shell'
  return (
    <div
      className="flex items-center gap-2.5"
      style={{ padding: '8px 10px', backgroundColor: 'var(--dplex-bg-elev-2)', fontSize: 11.5 }}
    >
      {ai && tab.providerId ? (
        <ProviderGlyph providerId={tab.providerId as ProviderId} size="xs" />
      ) : (
        <Terminal size={13} style={{ color: 'var(--dplex-text-dim)', flexShrink: 0 }} />
      )}
      <span
        className="flex-1 min-w-0 truncate"
        style={{ color: 'var(--dplex-text-2)', fontWeight: 500 }}
      >
        {tab.title}
      </span>
      <span
        className="inline-flex items-center gap-1.5 flex-shrink-0"
        style={{ fontSize: 10.5, fontWeight: 600, color }}
      >
        <span
          aria-hidden
          className={event ? 'dplex-pulse-dot' : ''}
          style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: color }}
        />
        {statusLabel}
      </span>
    </div>
  )
}
