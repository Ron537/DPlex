import { useMemo, useRef, useState, useEffect, type RefObject } from 'react'
import { Check, Plus, Tag, X } from 'lucide-react'
import { PopoverMenu } from '../common/PopoverMenu'
import { useProjectStore } from '../../stores/projectStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { normalizeTag, collectTagCounts, TAG_PALETTE, getTagColor } from '../../utils/projectTags'
import { TagPill } from './TagPill'

interface TagPickerPopoverProps {
  projectId: string
  open: boolean
  onClose: () => void
  anchorRef: RefObject<HTMLElement | null>
}

/**
 * Multi-select tag editor for a single project. Opens from the project's
 * context menu and lets the user toggle existing tags or create new ones.
 *
 * Suggestions come from the union of all tags across all projects so users
 * can pick from a shared vocabulary without retyping. The input doubles as
 * a filter for that list and as a "create tag" affordance — pressing Enter
 * commits the normalized input as a new tag on this project.
 */
export function TagPickerPopover({
  projectId,
  open,
  onClose,
  anchorRef
}: TagPickerPopoverProps): React.JSX.Element | null {
  const projects = useProjectStore((s) => s.projects)
  const addProjectTag = useProjectStore((s) => s.addProjectTag)
  const removeProjectTag = useProjectStore((s) => s.removeProjectTag)
  const tagColors = useSettingsStore((s) => s.settings.tagColors)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const project = projects.find((p) => p.id === projectId)

  const [input, setInput] = useState('')
  /** Which tag currently has its swatch row expanded. Single-target so the
   *  popover height stays predictable; clicking another tag's swatch swap
   *  closes the previous one. */
  const [colorTarget, setColorTarget] = useState<string | null>(null)
  /** Color the user has picked for the tag they're about to create. While
   *  typing, the create preview pill is locked to this color so it doesn't
   *  shimmer between palette entries as the hash of the input changes on
   *  every keystroke. Defaults to the first palette entry; resets when the
   *  popover closes or after a successful commit. */
  const [draftColor, setDraftColor] = useState<string>(TAG_PALETTE[0].id)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Reset & focus when the popover opens; on close, reset transient picker
  // state. Both branches defer their setState calls through a timeout so the
  // effect body itself stays free of synchronous setState (satisfies
  // react-hooks/set-state-in-effect) and so the close-time resets run after
  // the PopoverMenu has unmounted.
  useEffect(() => {
    if (!open) {
      const t0 = setTimeout(() => {
        setColorTarget(null)
        setDraftColor(TAG_PALETTE[0].id)
      }, 0)
      return () => clearTimeout(t0)
    }
    const t = setTimeout(() => {
      setInput('')
      inputRef.current?.focus()
    }, 30)
    return () => clearTimeout(t)
  }, [open])

  const allTags = useMemo(() => collectTagCounts(projects).map((c) => c.tag), [projects])

  const currentTags = useMemo(() => project?.tags ?? [], [project?.tags])
  const currentSet = useMemo(() => new Set(currentTags), [currentTags])

  const normalizedInput = normalizeTag(input)
  // Filter using the normalized input so typing `#infra` matches the stored
  // tag `infra`. Falling back to the raw lowercased input would hide every
  // existing suggestion the moment the user types `#`.
  const filterKey = normalizedInput ?? input.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!filterKey) return allTags
    return allTags.filter((t) => t.includes(filterKey))
  }, [allTags, filterKey])

  const canCreate = normalizedInput !== null && !allTags.includes(normalizedInput)

  const commit = (tag: string): void => {
    addProjectTag(projectId, tag)
    // Only persist a color when creating a brand-new tag — pressing Enter
    // on an existing tag (whose Create row isn't shown) must not silently
    // overwrite its globally-shared color.
    if (canCreate) {
      const autoId = getTagColor(tag).id
      if (draftColor !== autoId) {
        setTagColor(tag, draftColor)
      }
    }
    setInput('')
    setDraftColor(TAG_PALETTE[0].id)
    inputRef.current?.focus()
  }

  // Color picker writes to the shared `tagColors` settings record (a tag's
  // color is global, not per-project). Passing `null` removes the override
  // and the tag falls back to the deterministic hash color.
  const setTagColor = (tag: string, colorId: string | null): void => {
    const next: Record<string, string> = { ...(tagColors ?? {}) }
    if (colorId === null) delete next[tag]
    else next[tag] = colorId
    void updateSettings({ tagColors: next })
  }

  if (!project) return null

  return (
    <PopoverMenu
      anchorRef={anchorRef}
      open={open}
      onClose={onClose}
      align="left"
      className="min-w-[240px]"
    >
      <div className="px-3 py-2">
        <div
          className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider mb-2"
          style={{ color: 'var(--dplex-text-dim)' }}
        >
          <Tag size={10} />
          Tags for {project.name}
        </div>

        {currentTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {currentTags.map((t) => (
              <TagPill
                key={t}
                tag={t}
                onClick={(e) => {
                  e.stopPropagation()
                  removeProjectTag(projectId, t)
                }}
                title={`Remove #${t}`}
              />
            ))}
          </div>
        )}

        <input
          ref={inputRef}
          type="text"
          value={input}
          placeholder="Find or create tag…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (normalizedInput) commit(normalizedInput)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
          className="w-full text-[12px] outline-none"
          style={{
            backgroundColor: 'var(--dplex-bg-input)',
            border: '1px solid var(--dplex-border)',
            borderRadius: 6,
            color: 'var(--dplex-text)',
            padding: '5px 8px',
            fontFamily: 'inherit'
          }}
        />
      </div>

      <div className="max-h-[260px] overflow-y-auto">
        {filtered.length === 0 && !canCreate && (
          <div className="px-3 py-2 text-[11px]" style={{ color: 'var(--dplex-text-muted)' }}>
            No tags yet. Type to create one.
          </div>
        )}
        {filtered.map((tag) => {
          const isOn = currentSet.has(tag)
          const isColorOpen = colorTarget === tag
          const currentColorId = tagColors?.[tag] ?? null
          return (
            <div key={tag}>
              <div className="flex items-stretch group">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (isOn) removeProjectTag(projectId, tag)
                    else addProjectTag(projectId, tag)
                  }}
                  className="flex items-center gap-2 flex-1 min-w-0 px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
                  style={{ color: 'var(--dplex-text)' }}
                >
                  <span
                    style={{
                      width: 12,
                      display: 'inline-flex',
                      justifyContent: 'center',
                      color: isOn ? 'var(--dplex-accent)' : 'transparent'
                    }}
                  >
                    <Check size={11} />
                  </span>
                  <TagPill tag={tag} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setColorTarget(isColorOpen ? null : tag)
                  }}
                  title={`Change color for #${tag}`}
                  aria-label={`Change color for #${tag}`}
                  className="px-2 hover:bg-[var(--dplex-hover)] flex items-center"
                >
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 999,
                      backgroundColor: getTagColor(tag, currentColorId).fg,
                      border: '1px solid var(--dplex-border)',
                      opacity: isColorOpen ? 1 : 0.7
                    }}
                  />
                </button>
              </div>
              {isColorOpen && (
                <div
                  className="flex items-center gap-1 px-3 py-2"
                  style={{
                    backgroundColor: 'var(--dplex-bg-alt)',
                    borderTop: '1px solid var(--dplex-border)',
                    borderBottom: '1px solid var(--dplex-border)'
                  }}
                >
                  {TAG_PALETTE.map((c) => {
                    const selected = currentColorId === c.id
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setTagColor(tag, c.id)
                        }}
                        title={c.label}
                        aria-label={`Set #${tag} color to ${c.label}`}
                        aria-pressed={selected}
                        className="flex items-center justify-center"
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 999,
                          padding: 0,
                          backgroundColor: c.bg,
                          border: `2px solid ${selected ? c.fg : 'transparent'}`,
                          cursor: 'pointer'
                        }}
                      >
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 999,
                            backgroundColor: c.fg
                          }}
                        />
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setTagColor(tag, null)
                    }}
                    title="Reset to default (auto)"
                    aria-label={`Reset #${tag} color to default`}
                    className="ml-1 flex items-center justify-center hover:bg-[var(--dplex-hover)]"
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 999,
                      border: '1px dashed var(--dplex-border)',
                      color: 'var(--dplex-text-muted)',
                      backgroundColor: 'transparent',
                      cursor: 'pointer'
                    }}
                  >
                    <X size={10} />
                  </button>
                </div>
              )}
            </div>
          )
        })}
        {canCreate && normalizedInput && (
          <div
            style={{
              borderTop: filtered.length > 0 ? '1px solid var(--dplex-border)' : 'none'
            }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                commit(normalizedInput)
              }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
              style={{ color: 'var(--dplex-accent)' }}
            >
              <Plus size={11} />
              Create <TagPill tag={normalizedInput} colorOverride={draftColor} />
            </button>
            <div
              className="flex items-center gap-1 px-3 py-2"
              style={{ backgroundColor: 'var(--dplex-bg-alt)' }}
            >
              {TAG_PALETTE.map((c) => {
                const selected = draftColor === c.id
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDraftColor(c.id)
                      // Keep focus on the text input so the user can press
                      // Enter to commit immediately after picking a colour.
                      inputRef.current?.focus()
                    }}
                    title={c.label}
                    aria-label={`Use ${c.label} for the new tag`}
                    aria-pressed={selected}
                    className="flex items-center justify-center"
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 999,
                      padding: 0,
                      backgroundColor: c.bg,
                      border: `2px solid ${selected ? c.fg : 'transparent'}`,
                      cursor: 'pointer'
                    }}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 999,
                        backgroundColor: c.fg
                      }}
                    />
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </PopoverMenu>
  )
}
