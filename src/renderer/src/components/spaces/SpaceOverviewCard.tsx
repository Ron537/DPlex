import { type CSSProperties, type JSX } from 'react'
import { ArrowUpRight, Clock, FolderGit2, Pencil, Terminal, Trash2 } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { useSpaceStore } from '../../stores/spaceStore'
import { useSpacesUiStore } from '../../stores/spacesUiStore'
import { makeCompositeId, type AttentionEvent } from '../../../../preload/attentionTypes'
import { attentionKindLabel, type SpaceAttention } from '../../utils/spaceAttention'
import { ProviderGlyph } from '../common/ProviderGlyph'
import type { ProviderId } from '../../utils/providerHelpers'
import type { Space, TerminalTab } from '../../types'
import { SpaceAvatar } from './SpaceAvatar'
import {
  attentionColorVar,
  attentionLabel,
  boundProjects,
  isAiSessionTab,
  relativeTime,
  terminalTabs
} from './spaceVisuals'

interface SpaceOverviewCardProps {
  space: Space
  attention: SpaceAttention
  events: readonly AttentionEvent[]
}

export function SpaceOverviewCard({
  space,
  attention,
  events
}: SpaceOverviewCardProps): JSX.Element {
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
      aria-label={`Open ${space.name}`}
      data-testid={`space-card-${space.id}`}
      onClick={resume}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          resume()
        }
      }}
      className="dplex-space-card dplex-surface group relative min-w-0 flex flex-col overflow-hidden cursor-pointer"
      style={{ '--space-color': space.color } as CSSProperties}
    >
      <div className="dplex-space-cover">
        <div className="flex items-center justify-between gap-2">
          <SpaceAvatar space={space} size={38} radius={11} ping={attention.total > 0} />
          {attention.total > 0 && (
            <span
              className="rounded-full px-2 py-1 text-[10px] font-medium"
              style={{
                color: attentionColorVar(attention.topKind),
                backgroundColor: `color-mix(in srgb, ${attentionColorVar(attention.topKind)} 12%, var(--dplex-bg-panel))`
              }}
            >
              {attentionLabel(attention)}
            </span>
          )}
        </div>
        <h2 className="dplex-space-card-title truncate" title={space.name}>
          {space.name}
        </h2>
        <div className="dplex-space-card-meta">
          <span>
            {bound.length} project{bound.length !== 1 ? 's' : ''}
          </span>
          <span aria-hidden style={{ color: 'var(--dplex-text-faint)' }}>
            /
          </span>
          <span>
            {tabs.length} session{tabs.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      <div className="dplex-space-body">
        <div className="flex flex-wrap gap-1.5">
          {bound.length > 0 ? (
            bound.map((project) => (
              <span
                key={project.id}
                className="inline-flex items-center gap-1.5 min-w-0 rounded-md px-2 py-1 text-[10px]"
                style={{
                  color: 'var(--dplex-text-muted)',
                  backgroundColor: 'var(--dplex-bg-elev-2)'
                }}
              >
                <FolderGit2 size={11} className="flex-shrink-0" />
                <span className="truncate">{project.name}</span>
              </span>
            ))
          ) : (
            <span className="text-[11px]" style={{ color: 'var(--dplex-text-dim)' }}>
              No projects linked yet
            </span>
          )}
        </div>
        {tabs.length > 0 ? (
          <div className="dplex-space-preview">
            {tabs.slice(0, 3).map((tab) => (
              <SessionPreview key={tab.id} tab={tab} events={events} />
            ))}
            {tabs.length > 3 && (
              <span className="block pt-2 text-[10px]" style={{ color: 'var(--dplex-text-dim)' }}>
                +{tabs.length - 3} more sessions
              </span>
            )}
          </div>
        ) : (
          <div
            className="flex items-center gap-2 py-5 text-xs"
            style={{ color: 'var(--dplex-text-dim)' }}
          >
            <Terminal size={14} />
            Ready for your next session
          </div>
        )}
      </div>

      <div
        className="flex items-center flex-wrap gap-2 px-4 py-3"
        style={{ borderTop: '1px solid var(--dplex-border-subtle)' }}
      >
        <span
          className="inline-flex items-center gap-1.5 text-[10px]"
          style={{ color: 'var(--dplex-text-dim)' }}
        >
          <Clock size={11} /> {relativeTime(space.lastActiveAt)}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              rename(space.id)
            }}
            aria-label={`Rename ${space.name}`}
            title="Rename space"
            className="p-1.5 rounded-md hover:bg-[var(--dplex-hover)]"
            style={{ color: 'var(--dplex-text-muted)' }}
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            data-testid={`card-delete-${space.id}`}
            onClick={(e) => {
              e.stopPropagation()
              requestDelete({ id: space.id, name: space.name })
            }}
            aria-label={`Delete ${space.name}`}
            title="Delete space"
            className="p-1.5 rounded-md hover:bg-[var(--dplex-hover)]"
            style={{ color: 'var(--dplex-text-muted)' }}
          >
            <Trash2 size={13} />
          </button>
          <button
            type="button"
            data-testid={`card-resume-${space.id}`}
            onClick={(e) => {
              e.stopPropagation()
              resume()
            }}
            className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] font-medium hover:bg-[var(--dplex-hover)]"
            style={{ color: 'var(--dplex-text)', border: '1px solid var(--dplex-border)' }}
          >
            Resume <ArrowUpRight size={13} />
          </button>
        </span>
      </div>
    </div>
  )
}

function SessionPreview({
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
          (item) =>
            item.compositeId === makeCompositeId(tab.providerId!, tab.sessionId!) &&
            !item.suppressed
        )
      : undefined
  return (
    <div
      className="flex items-center gap-2 py-1.5 text-[11px]"
      style={{ color: 'var(--dplex-text-muted)' }}
    >
      {ai && tab.providerId ? (
        <ProviderGlyph providerId={tab.providerId as ProviderId} size="xs" />
      ) : (
        <Terminal size={12} className="flex-shrink-0" />
      )}
      <span className="flex-1 min-w-0 truncate" title={tab.title}>
        {tab.title}
      </span>
      {event && (
        <span
          title={attentionKindLabel(event.kind)}
          aria-label={attentionKindLabel(event.kind)}
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: attentionColorVar(event.kind) }}
        />
      )}
    </div>
  )
}
