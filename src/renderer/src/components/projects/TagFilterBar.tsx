import { useEffect, useMemo } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { collectTagCounts } from '../../utils/projectTags'
import { TagPill } from './TagPill'

interface TagFilterBarProps {
  /** Currently selected tag, or null for "All". */
  value: string | null
  onChange: (next: string | null) => void
}

/**
 * Horizontal strip of tag-filter chips rendered between the projects search
 * input and the project list. Renders nothing when no project has any tag —
 * keeps the panel uncluttered for users who don't use tags.
 *
 * Single-select for now: clicking a tag activates it; clicking it again (or
 * clicking "All") clears. Multi-select / AND-composition is a future slice.
 */
export function TagFilterBar({ value, onChange }: TagFilterBarProps): React.JSX.Element | null {
  const projects = useProjectStore((s) => s.projects)
  const tagCounts = useMemo(() => collectTagCounts(projects), [projects])

  // Self-heal a stale filter: if the active tag no longer exists on any
  // project (last project carrying it was removed or untagged), clear the
  // filter so the user isn't left with an empty list and no visible reset
  // affordance. Done in an effect so the parent owns the state.
  const tagExists = !value || tagCounts.some((t) => t.tag === value)
  useEffect(() => {
    if (!tagExists) onChange(null)
  }, [tagExists, onChange])

  if (tagCounts.length === 0) return null

  const totalCount = projects.length

  return (
    <div
      className="flex flex-wrap gap-1.5 px-3 pt-1 pb-3"
      style={{ borderBottom: '1px solid var(--dplex-border-subtle)' }}
      role="tablist"
      aria-label="Filter projects by tag"
    >
      <button
        type="button"
        onClick={() => onChange(null)}
        role="tab"
        aria-selected={value === null}
        className="inline-flex items-center gap-1 rounded-full font-medium leading-none whitespace-nowrap transition-colors"
        style={{
          fontSize: 11,
          padding: '2px 8px',
          backgroundColor: value === null ? 'var(--dplex-accent-soft)' : 'transparent',
          color: value === null ? 'var(--dplex-text)' : 'var(--dplex-text-muted)',
          border:
            value === null
              ? '1px solid var(--dplex-accent-ring)'
              : '1px solid var(--dplex-border-strong)',
          cursor: 'pointer',
          userSelect: 'none'
        }}
      >
        All
        <span style={{ opacity: 0.6, fontSize: 10 }}>{totalCount}</span>
      </button>
      {tagCounts.map(({ tag, count }) => (
        <TagPill
          key={tag}
          tag={tag}
          count={count}
          active={value === tag}
          variant="dot"
          onClick={() => onChange(value === tag ? null : tag)}
        />
      ))}
    </div>
  )
}
