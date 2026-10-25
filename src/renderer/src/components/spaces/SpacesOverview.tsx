import { useMemo, useState, type JSX } from 'react'
import { ArrowUpRight, Command, Layers, Plus, Search } from 'lucide-react'
import { useAttentionStore } from '../../stores/attentionStore'
import { useSpaceStore } from '../../stores/spaceStore'
import { useSpacesUiStore } from '../../stores/spacesUiStore'
import { aggregateSpaceAttention } from '../../utils/spaceAttention'
import { SpaceOverviewCard } from './SpaceOverviewCard'
import { terminalTabs } from './spaceVisuals'

export function SpacesOverview(): JSX.Element {
  const spaces = useSpaceStore((s) => s.spaces)
  const events = useAttentionStore((s) => s.active)
  const openCreate = useSpacesUiStore((s) => s.openCreate)
  const [query, setQuery] = useState('')
  const [attentionOnly, setAttentionOnly] = useState(false)

  const cards = useMemo(
    () =>
      spaces.map((space) => {
        const attention = aggregateSpaceAttention(space, events)
        return {
          space,
          attention,
          pending: attention.waitingForApproval + attention.waitingForInput + attention.error
        }
      }),
    [spaces, events]
  )
  const matching = cards.filter(
    ({ space, pending }) =>
      (!attentionOnly || pending > 0) &&
      space.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  )
  const sessionCount = useMemo(
    () => spaces.reduce((sum, space) => sum + terminalTabs(space.workspace).length, 0),
    [spaces]
  )
  const pendingCount = cards.reduce((sum, card) => sum + card.pending, 0)
  const attentionSpaces = cards.filter((card) => card.pending > 0).length

  return (
    <div className="dplex-mission-page dplex-scroll-autohide">
      <div className="dplex-mission-content">
        <div className="dplex-mission-heading">
          <span className="dplex-eyebrow">
            <Command size={12} /> Your command center
          </span>
          <button
            type="button"
            onClick={openCreate}
            data-testid="overview-new-space"
            className="dplex-primary-button"
          >
            <Plus size={14} />
            New space
          </button>
        </div>

        <section className="dplex-mission-hero" aria-label="Workspace summary">
          <div>
            <span className="dplex-eyebrow">A place for every project</span>
            <h1 className="dplex-mission-title">Spaces</h1>
            <p className="dplex-mission-subtitle">
              Less context switching. More forward motion.
              <br />
              Your projects and agents, exactly where you left them.
            </p>
          </div>
          <dl className="dplex-hero-stats">
            <div>
              <dd>{spaces.length}</dd>
              <dt>Workspaces</dt>
            </div>
            <div>
              <dd>{sessionCount}</dd>
              <dt>Session tabs</dt>
            </div>
            <div>
              <dd style={{ color: pendingCount > 0 ? 'var(--dplex-status-approval)' : undefined }}>
                {pendingCount}
              </dd>
              <dt>Need attention</dt>
            </div>
          </dl>
        </section>

        <div className="dplex-space-toolbar">
          <div className="dplex-space-filters" aria-label="Filter spaces">
            <button
              type="button"
              aria-pressed={!attentionOnly}
              onClick={() => setAttentionOnly(false)}
              className="hover:bg-[var(--dplex-hover)]"
            >
              All spaces <span className="ml-1.5 tabular-nums">{spaces.length}</span>
            </button>
            <button
              type="button"
              aria-pressed={attentionOnly}
              onClick={() => setAttentionOnly(true)}
              className="hover:bg-[var(--dplex-hover)]"
            >
              Needs attention <span className="ml-1.5 tabular-nums">{attentionSpaces}</span>
            </button>
          </div>
          <label
            className="flex items-center gap-2 min-w-0"
            style={{ color: 'var(--dplex-text-dim)' }}
          >
            <Search size={13} className="flex-shrink-0" />
            <input
              aria-label="Find a space"
              placeholder="Find a space..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="dplex-input bg-transparent outline-none text-xs w-36 min-w-0 py-1"
              style={{ color: 'var(--dplex-text)' }}
            />
          </label>
        </div>

        <div className="dplex-space-grid">
          {matching.map(({ space, attention }) => (
            <SpaceOverviewCard key={space.id} space={space} attention={attention} events={events} />
          ))}
          {!attentionOnly && !query.trim() && (
            <button
              type="button"
              onClick={openCreate}
              className="dplex-space-card dplex-space-card-new hover:bg-[var(--dplex-hover)]"
            >
              <Layers size={28} strokeWidth={1.2} style={{ color: 'var(--dplex-accent)' }} />
              <h3>Room for your next idea.</h3>
              <p>
                Bring related repositories, terminals, and agents together in a dedicated workspace.
              </p>
              <span
                className="inline-flex items-center gap-2 text-xs font-medium"
                style={{ color: 'var(--dplex-accent)' }}
              >
                Create a space <ArrowUpRight size={14} />
              </span>
            </button>
          )}
        </div>
        {matching.length === 0 && (attentionOnly || query.trim()) && (
          <div className="flex flex-col items-center gap-3 py-16 text-center" role="status">
            <Search size={24} strokeWidth={1.3} style={{ color: 'var(--dplex-text-dim)' }} />
            <p style={{ color: 'var(--dplex-text-muted)' }}>
              {query.trim() ? 'No spaces match your search.' : 'No spaces need your attention.'}
            </p>
            <button
              type="button"
              className="dplex-secondary-button hover:bg-[var(--dplex-hover)]"
              onClick={() => {
                setQuery('')
                setAttentionOnly(false)
              }}
            >
              Show all spaces
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
