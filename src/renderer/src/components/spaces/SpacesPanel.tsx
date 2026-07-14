import { useRef, useState, type JSX } from 'react'
import { Layers, Minimize2, MoreVertical, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { useSpaceStore } from '../../stores/spaceStore'
import { useSpacesUiStore } from '../../stores/spacesUiStore'
import { useSpaceWorkspace } from '../../hooks/useSpaceWorkspace'
import { useSpaceAttention } from '../../hooks/useSpaceAttention'
import { PopoverMenu } from '../common/PopoverMenu'
import type { Space } from '../../types'
import { SpaceAvatar } from './SpaceAvatar'
import { AttentionChip } from './AttentionChip'
import { boundProjects, relativeTime, sessionCount } from './spaceVisuals'

/**
 * Sidebar view for managing spaces. The space you're currently in is pulled into
 * its own "Focused" section at the top (mirroring the Projects panel's "Pinned"
 * group); every other space follows under "All spaces", most-recently-used
 * first. "Focused" is a viewport role, not a runtime state — every space, on
 * screen or not, keeps running and keeps reporting attention.
 *
 * Rows follow the shared list-row idiom: a 2 px left accent stripe + accent-soft
 * fill for the focused row, a weight-600 title with a muted subline, and a hover
 * `⋮` menu for actions — rather than a bordered "card".
 */
export function SpacesPanel(): JSX.Element {
  const spaces = useSpaceStore((s) => s.spaces)
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId)
  const openCreate = useSpacesUiStore((s) => s.openCreate)

  const focused = spaces.find((s) => s.id === activeSpaceId) ?? null
  // Everything except the focused space, most-recently-active first. When no
  // space is focused this is simply the full list, rendered flat (no headers).
  const rest = spaces
    .filter((s) => s.id !== activeSpaceId)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        className="flex items-center flex-shrink-0"
        style={{
          height: 41,
          padding: '0 12px',
          borderBottom: '1px solid var(--dplex-border-subtle)'
        }}
      >
        <span
          className="font-bold uppercase"
          style={{ fontSize: 11, letterSpacing: '0.08em', color: 'var(--dplex-text-2)' }}
        >
          Spaces
        </span>
        <button
          type="button"
          onClick={openCreate}
          data-testid="spaces-panel-new"
          title="New space"
          className="ml-auto grid place-items-center rounded-md transition-colors hover:bg-[var(--dplex-hover)]"
          style={{ width: 24, height: 24, color: 'var(--dplex-text-dim)' }}
        >
          <Plus size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto dplex-scroll-autohide flex flex-col pt-1 px-2 pb-3">
        {spaces.length === 0 && (
          <div className="px-4 py-8 text-center" style={{ color: 'var(--dplex-text-muted)' }}>
            <div className="flex flex-col items-center gap-2">
              <Layers size={20} style={{ opacity: 0.4 }} />
              <div>
                <div className="text-xs">No spaces yet</div>
                <div className="text-[10px] mt-0.5" style={{ opacity: 0.7 }}>
                  Click + to create one
                </div>
              </div>
            </div>
          </div>
        )}

        {focused && (
          <>
            <SectionLabel>Focused</SectionLabel>
            <SpaceRow space={focused} isActive />
          </>
        )}

        {rest.length > 0 && (
          <>
            {focused && <SectionLabel>All spaces</SectionLabel>}
            {rest.map((s) => (
              <SpaceRow key={s.id} space={s} isActive={false} />
            ))}
          </>
        )}
      </div>

      <button
        type="button"
        data-testid="spaces-panel-open-overview"
        onClick={() => useSpaceStore.getState().sendToBackground()}
        disabled={!activeSpaceId}
        className="flex items-center gap-2 flex-shrink-0 transition-colors hover:bg-[var(--dplex-hover)]"
        style={{
          height: 34,
          padding: '0 14px',
          borderTop: '1px solid var(--dplex-border-subtle)',
          fontSize: 11.5,
          fontWeight: 600,
          color: activeSpaceId ? 'var(--dplex-text-2)' : 'var(--dplex-text-faint)',
          cursor: activeSpaceId ? 'pointer' : 'default'
        }}
        title={activeSpaceId ? 'Step back to the Overview' : 'Already on the Overview'}
      >
        <Layers size={13} style={{ color: 'var(--dplex-text-dim)' }} />
        Open Overview
      </button>
    </div>
  )
}

function SectionLabel({ children }: { children: string }): JSX.Element {
  return (
    <div
      className="px-2 pt-3 pb-1.5 text-[10px] font-semibold uppercase first:pt-2"
      style={{ letterSpacing: '0.10em', color: 'var(--dplex-text-faint)' }}
    >
      {children}
    </div>
  )
}

function SpaceRow({ space, isActive }: { space: Space; isActive: boolean }): JSX.Element {
  const attention = useSpaceAttention(space)
  const ws = useSpaceWorkspace(space)
  const sessions = sessionCount(ws)
  const projects = useProjectStore((s) => s.projects)
  const bound = boundProjects(space, projects)

  const rename = useSpacesUiStore((s) => s.openRename)
  const requestDelete = useSpacesUiStore((s) => s.requestDelete)

  const [showMenu, setShowMenu] = useState(false)
  const menuAnchorRef = useRef<HTMLButtonElement>(null)

  const activate = (): void => {
    if (!isActive) useSpaceStore.getState().switchSpace(space.id)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`space-row-${space.id}`}
      onClick={activate}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !isActive) {
          e.preventDefault()
          activate()
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        setShowMenu((v) => !v)
      }}
      className="group relative flex items-start gap-2.5 mx-0.5 mb-0.5 pl-3 pr-2 py-2 cursor-pointer rounded-lg transition-colors"
      style={isActive ? { backgroundColor: 'var(--dplex-accent-soft)' } : undefined}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.backgroundColor = 'var(--dplex-hover)'
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.backgroundColor = ''
      }}
    >
      {/* Selected (active) row gets the shared 2 px left accent stripe —
          matches Project rows, Session rows, activity-bar items, and the
          search palette. Replaces the previous full color-mix border, which
          read as a separate "card" rather than a selected list item. */}
      {isActive && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            top: 6,
            bottom: 6,
            width: 2,
            borderRadius: '0 2px 2px 0',
            backgroundColor: 'var(--dplex-accent)',
            boxShadow: '0 0 8px var(--dplex-accent-glow)',
            pointerEvents: 'none'
          }}
        />
      )}

      <SpaceAvatar
        space={space}
        size={26}
        radius={7}
        ping={attention.total > 0 && !isActive}
        style={{ marginTop: 2 }}
      />

      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        {/* Line 1 — name · attention · active/time */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="flex-1 truncate text-[13px] font-semibold"
            style={{ color: 'var(--dplex-text)', letterSpacing: '-0.005em' }}
          >
            {space.name}
          </span>
          {attention.total > 0 && <AttentionChip attention={attention} compact />}
          {!isActive && (
            <span
              className="flex-shrink-0 tabular-nums text-[10.5px]"
              style={{ color: 'var(--dplex-text-dim)' }}
            >
              {relativeTime(space.lastActiveAt)}
            </span>
          )}
        </div>

        {/* Line 2 — subline: the primary project (the "where") on the left, and a
            plain session count (the "what") pinned right. Text count instead of
            an icon strip — consistent with the Overview and the Space switcher,
            and keeps the row a tidy two lines like Project/Session rows.
            One truncating primary pill + a "+N" overflow (mirroring ProjectItem's
            single-truncating-meta pattern) guarantees a graceful fit at any
            width; the session count always shows — it reads "0 sessions" when a
            space has none, matching the Overview card footer. */}
        <div className="flex items-center gap-1.5 min-w-0" style={{ marginTop: 2 }}>
          {bound.length > 0 && (
            <>
              <span
                className="truncate text-[10px] font-medium leading-[15px]"
                style={{
                  maxWidth: 118,
                  color: 'var(--dplex-text-muted)',
                  background: 'var(--dplex-bg-alt)',
                  border: '1px solid var(--dplex-border)',
                  borderRadius: 5,
                  padding: '0 6px'
                }}
                title={bound.map((p) => p.name).join(', ')}
              >
                {bound[0].name}
              </span>
              {bound.length > 1 && (
                <span
                  className="flex-shrink-0 text-[10px] font-medium tabular-nums"
                  style={{ color: 'var(--dplex-text-dim)' }}
                >
                  +{bound.length - 1}
                </span>
              )}
            </>
          )}
          <span
            className={`flex-shrink-0 tabular-nums text-[10.5px] ${bound.length > 0 ? 'ml-auto' : ''}`}
            style={{ color: 'var(--dplex-text-dim)' }}
          >
            {sessions} session{sessions === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {/* Actions — a single hover `⋮` menu, matching the Project and Session
          rows (replaces the previous always-cramped inline button cluster). */}
      <button
        ref={menuAnchorRef}
        type="button"
        title="Space actions"
        aria-label="Space actions"
        onClick={(e) => {
          e.stopPropagation()
          setShowMenu((v) => !v)
        }}
        className="opacity-0 group-hover:opacity-100 p-0.5 rounded transition-opacity flex-shrink-0 mt-0.5 hover:bg-[var(--dplex-hover)]"
        data-testid={`space-menu-${space.id}`}
      >
        <MoreVertical size={13} style={{ color: 'var(--dplex-text-muted)' }} />
      </button>

      <PopoverMenu
        anchorRef={menuAnchorRef}
        open={showMenu}
        onClose={() => setShowMenu(false)}
        className="min-w-[168px]"
      >
        {isActive ? (
          <SpaceMenuItem
            icon={<Minimize2 size={11} />}
            label="Minimize"
            onClick={() => useSpaceStore.getState().sendToBackground()}
            close={() => setShowMenu(false)}
            data-testid={`space-minimize-${space.id}`}
          />
        ) : (
          <SpaceMenuItem
            icon={<Play size={11} />}
            label="Resume"
            onClick={() => useSpaceStore.getState().switchSpace(space.id)}
            close={() => setShowMenu(false)}
            data-testid={`space-resume-${space.id}`}
          />
        )}
        <SpaceMenuItem
          icon={<Pencil size={11} />}
          label="Rename"
          onClick={() => rename(space.id)}
          close={() => setShowMenu(false)}
          data-testid={`space-rename-${space.id}`}
        />
        <div className="my-1" style={{ borderTop: '1px solid var(--dplex-border)' }} />
        <SpaceMenuItem
          icon={<Trash2 size={11} />}
          label="Delete"
          danger
          onClick={() => requestDelete({ id: space.id, name: space.name })}
          close={() => setShowMenu(false)}
          data-testid={`space-delete-${space.id}`}
        />
      </PopoverMenu>
    </div>
  )
}

function SpaceMenuItem({
  icon,
  label,
  onClick,
  close,
  danger = false,
  ...rest
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  close: () => void
  danger?: boolean
} & Record<`data-${string}`, string>): JSX.Element {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        close()
        onClick()
      }}
      className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]${
        danger ? ' text-red-400' : ''
      }`}
      style={danger ? undefined : { color: 'var(--dplex-text)' }}
      {...rest}
    >
      {icon} {label}
    </button>
  )
}
