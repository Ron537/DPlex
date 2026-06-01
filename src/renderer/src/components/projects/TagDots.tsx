import { memo } from 'react'
import { Hash } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { getTagColor } from '../../utils/projectTags'

interface TagDotsProps {
  tags: readonly string[]
  /** Hard cap of visible dots; anything beyond folds into a `+N` indicator. */
  maxVisible?: number
}

/**
 * Compact tag display for project rows — renders a small colored dot per
 * tag at the right edge of the meta line. Does NOT grow the row's height
 * the way a chip list would; the dots sit on the existing
 * `branch · time` line and never spill onto a third line.
 *
 * Overflow beyond `maxVisible` collapses into a muted `+N` indicator.
 * Hovering the dots reveals a native tooltip with the full tag list so
 * names remain discoverable without permanent visual cost.
 *
 * A leading `#` glyph identifies the cluster as a tag indicator. Without
 * it, a green tag dot reads identically to the avatar's green
 * live-session status dot — a visual collision we want to avoid. Dots
 * are also a hair smaller (5 px) than the status dot (8 px) so the two
 * remain clearly distinguishable even mid-row.
 *
 * Per-tag colors come from the user's saved tag-color overrides via the
 * same `getTagColor` path used by `TagPill`, so a project's dots match
 * the chips users see in the filter bar above.
 */
export const TagDots = memo(function TagDots({
  tags,
  maxVisible = 4
}: TagDotsProps): React.JSX.Element | null {
  const tagColors = useSettingsStore((s) => s.settings.tagColors)
  if (tags.length === 0) return null

  const visible = tags.slice(0, maxVisible)
  const hidden = Math.max(0, tags.length - visible.length)
  const tooltip = tags.map((t) => `#${t}`).join(', ')

  return (
    <span
      aria-label={tooltip}
      title={tooltip}
      className="inline-flex items-center flex-shrink-0"
      style={{ gap: 3, marginLeft: 6 }}
    >
      <Hash
        size={9}
        strokeWidth={2.5}
        style={{
          color: 'var(--dplex-text-faint)',
          marginRight: 1,
          flexShrink: 0
        }}
        aria-hidden
      />
      {visible.map((tag) => {
        const { fg } = getTagColor(tag, tagColors?.[tag])
        return (
          <span
            key={tag}
            aria-hidden
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              backgroundColor: fg,
              flexShrink: 0
            }}
          />
        )
      })}
      {hidden > 0 && (
        <span
          aria-hidden
          style={{
            fontSize: 9.5,
            fontWeight: 600,
            color: 'var(--dplex-text-faint)',
            fontFamily: 'var(--dplex-font-mono)',
            marginLeft: 1
          }}
        >
          +{hidden}
        </span>
      )}
    </span>
  )
})
