import { useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { Check, FolderGit2 } from 'lucide-react'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useProjectStore } from '../../stores/projectStore'
import { useSpaceStore } from '../../stores/spaceStore'
import { useSpacesUiStore, type SpaceModalMode } from '../../stores/spacesUiStore'
import type { Project, Space } from '../../types'
import { SPACE_COLORS, pickSpaceColor } from '../../utils/spaceColors'
import { SpaceAvatar } from './SpaceAvatar'

/**
 * Create / rename a space. Captures name, accent color, and the projects bound
 * to the space. Mounted once at the app root; driven by `spacesUiStore`. The
 * outer component only resolves the request; the actual form is a keyed inner
 * component so opening a new request remounts it with fresh initial state
 * (no effect-driven setState).
 */
export function SpaceModal(): JSX.Element | null {
  const request = useSpacesUiStore((s) => s.modal)
  const close = useSpacesUiStore((s) => s.closeModal)
  const spaces = useSpaceStore((s) => s.spaces)
  const projects = useProjectStore((s) => s.projects)

  if (!request) return null
  const editing =
    request.mode !== 'create' ? (spaces.find((s) => s.id === request.spaceId) ?? null) : null
  // An edit request whose space vanished (e.g. deleted from another surface):
  // nothing to edit.
  if (request.mode !== 'create' && !editing) return null

  return (
    <SpaceModalForm
      key={`${request.mode}:${request.spaceId ?? 'new'}`}
      mode={request.mode}
      editing={editing}
      projects={projects}
      spaces={spaces}
      onClose={close}
    />
  )
}

interface SpaceModalFormProps {
  mode: SpaceModalMode
  editing: Space | null
  projects: Project[]
  spaces: Space[]
  onClose: () => void
}

/** Per-intent heading, subtitle, and submit label. The 'rename' and 'projects'
 *  modes drive the same form (name + color + projects); only the framing
 *  differs so an "Add a project" affordance never reads "Rename space". */
const MODAL_COPY: Record<SpaceModalMode, { title: string; subtitle: string; cta: string }> = {
  create: {
    title: 'New space',
    subtitle: 'Group projects & sessions into an activity you can leave and return to.',
    cta: 'Create space'
  },
  rename: {
    title: 'Rename space',
    subtitle: 'Update how this activity shows up across DPlex.',
    cta: 'Save'
  },
  projects: {
    title: 'Manage projects',
    subtitle: 'Choose the projects bound to this space so you can launch their sessions here.',
    cta: 'Save'
  }
}

function SpaceModalForm({
  mode,
  editing,
  projects,
  spaces,
  onClose
}: SpaceModalFormProps): JSX.Element {
  const [name, setName] = useState(editing ? editing.name : '')
  const [color, setColor] = useState<string>(editing ? editing.color : pickSpaceColor(spaces))
  const [projectIds, setProjectIds] = useState<string[]>(editing ? editing.projectIds : [])

  useEscapeKey(onClose, true)

  const canSave = name.trim().length > 0
  const copy = MODAL_COPY[mode]

  const toggleProject = (id: string): void => {
    setProjectIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
  }

  const save = (): void => {
    const trimmed = name.trim()
    if (!trimmed) return
    const store = useSpaceStore.getState()
    if (editing) {
      store.renameSpace(editing.id, trimmed)
      store.setSpaceAppearance(editing.id, { color })
      store.assignProjects(editing.id, projectIds)
    } else {
      store.createSpace({ name: trimmed, color, projectIds })
    }
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && canSave) {
      e.preventDefault()
      save()
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[2600] grid place-items-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="w-[460px] max-w-[92vw] overflow-hidden dplex-pop"
        style={{
          backgroundColor: 'var(--dplex-bg-elev)',
          border: '1px solid var(--dplex-border-strong)',
          borderRadius: 16,
          boxShadow: '0 40px 90px -30px rgba(0,0,0,0.75)'
        }}
        onKeyDown={onKeyDown}
      >
        <div style={{ padding: '18px 20px 6px' }}>
          <h3 className="font-extrabold" style={{ fontSize: 16, color: 'var(--dplex-text)' }}>
            {copy.title}
          </h3>{' '}
          <p style={{ fontSize: 12, color: 'var(--dplex-text-dim)', marginTop: 3 }}>
            {copy.subtitle}
          </p>
        </div>

        <div
          style={{ padding: '14px 20px 4px', display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          {/* Name */}
          <div>
            <label className="dplex-field-label">Space name</label>
            <div
              className="flex items-center gap-2.5"
              style={{
                padding: '9px 12px',
                borderRadius: 10,
                backgroundColor: 'var(--dplex-bg-input)',
                border: '1px solid var(--dplex-border)'
              }}
            >
              <SpaceAvatar
                space={{ name: name || (editing ? editing.name : 'Space'), color, glyph: '' }}
                size={22}
                radius={6}
              />
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Ship OAuth, Fix flaky tests, Perf pass"
                className="flex-1 bg-transparent outline-none"
                style={{ color: 'var(--dplex-text)', fontSize: 13 }}
              />
            </div>
          </div>

          {/* Accent */}
          <div>
            <label className="dplex-field-label">Accent</label>
            <div className="flex flex-wrap gap-2">
              {SPACE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Accent ${c}`}
                  aria-selected={c === color}
                  onClick={() => setColor(c)}
                  className="dplex-swatch"
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>

          {/* Projects */}
          <div>
            <label className="dplex-field-label">
              Projects & worktrees {editing ? '' : '· pick one or many'}
            </label>
            {projects.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--dplex-text-dim)' }}>
                No projects yet — add one from the Projects panel first.
              </p>
            ) : (
              <div
                className="flex flex-wrap gap-1.5 overflow-y-auto dplex-scroll-autohide"
                style={{ maxHeight: 150 }}
              >
                {projects.map((p) => {
                  const selected = projectIds.includes(p.id)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-selected={selected}
                      onClick={() => toggleProject(p.id)}
                      className="inline-flex items-center gap-2 transition-colors"
                      style={{
                        padding: '7px 11px',
                        borderRadius: 9,
                        fontSize: 12,
                        fontWeight: 600,
                        backgroundColor: selected
                          ? 'var(--dplex-accent-soft)'
                          : 'var(--dplex-bg-elev-2)',
                        border: `1px solid ${selected ? 'var(--dplex-accent)' : 'var(--dplex-border)'}`,
                        color: selected ? 'var(--dplex-accent)' : 'var(--dplex-text-muted)'
                      }}
                    >
                      <span
                        aria-hidden
                        className="grid place-items-center"
                        style={{
                          width: 15,
                          height: 15,
                          borderRadius: 5,
                          border: `1.5px solid ${selected ? 'var(--dplex-accent)' : 'var(--dplex-border-strong)'}`,
                          backgroundColor: selected ? 'var(--dplex-accent)' : 'transparent',
                          color: selected ? '#fff' : 'transparent'
                        }}
                      >
                        <Check size={10} strokeWidth={3} />
                      </span>
                      <FolderGit2 size={12} style={{ opacity: 0.7 }} />
                      {p.name}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div
          className="flex justify-end gap-2.5"
          style={{ padding: '16px 20px 18px', marginTop: 6 }}
        >
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center transition-colors hover:bg-[var(--dplex-hover)]"
            style={{
              padding: '9px 15px',
              borderRadius: 10,
              fontSize: 12.5,
              fontWeight: 600,
              backgroundColor: 'var(--dplex-bg-elev)',
              border: '1px solid var(--dplex-border)',
              color: 'var(--dplex-text-2)'
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            data-testid="space-modal-save"
            className="inline-flex items-center"
            style={{
              padding: '9px 15px',
              borderRadius: 10,
              fontSize: 12.5,
              fontWeight: 600,
              color: '#fff',
              background: 'linear-gradient(135deg, var(--dplex-accent), var(--dplex-accent-2))',
              opacity: canSave ? 1 : 0.5,
              cursor: canSave ? 'pointer' : 'not-allowed',
              boxShadow: '0 8px 22px -10px var(--dplex-accent-glow)'
            }}
          >
            {copy.cta}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
