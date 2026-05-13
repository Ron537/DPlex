import { memo } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { getTagColor } from '../../utils/projectTags'

interface TagPillProps {
  tag: string
  /** When true, render in selected/filter-active style (accent ring). */
  active?: boolean
  /** Optional count rendered as a small suffix — used by the filter strip. */
  count?: number
  /** Render the leading `#` so chips read as `#infra`. Default true. */
  showHash?: boolean
  /** Click handler — when present, the chip is rendered as a real button
   *  with hover/focus affordances. */
  onClick?: (e: React.MouseEvent) => void
  /** Optional title for hover/accessibility. */
  title?: string
  /** Compact mode shrinks padding & font for inline rendering on project rows. */
  compact?: boolean
  /** Force a specific palette colour. When omitted, the user's saved override
   *  is used; if no override exists, falls back to a hash of the tag name. */
  colorOverride?: string | null
}

/**
 * Pill used both on project rows (compact) and in the sidebar filter strip
 * (regular). Colour comes from the shared TAG_PALETTE so it reads on both
 * light and dark themes; users can change it via the tag picker.
 */
export const TagPill = memo(function TagPill({
  tag,
  active,
  count,
  showHash = true,
  onClick,
  title,
  compact,
  colorOverride
}: TagPillProps): React.JSX.Element {
  const savedOverride = useSettingsStore((s) => s.settings.tagColors?.[tag])
  const effectiveOverride = colorOverride !== undefined ? colorOverride : savedOverride
  const { bg, fg } = getTagColor(tag, effectiveOverride)
  const fontSize = compact ? 9.5 : 11
  const padding = compact ? '1px 5px' : '2px 8px'
  const Cmp = (onClick ? 'button' : 'span') as 'button' | 'span'
  return (
    <Cmp
      onClick={onClick}
      title={title ?? `#${tag}`}
      className="inline-flex items-center gap-1 rounded-full font-medium leading-none whitespace-nowrap"
      style={{
        fontSize,
        padding,
        backgroundColor: bg,
        color: fg,
        border: `1px solid ${active ? fg : 'transparent'}`,
        cursor: onClick ? 'pointer' : 'default',
        userSelect: 'none',
        maxWidth: compact ? 90 : 140,
        minWidth: 0,
        flexShrink: 0
      }}
    >
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: 'inline-block',
          maxWidth: '100%'
        }}
      >
        {showHash ? '#' : ''}
        {tag}
      </span>
      {typeof count === 'number' && (
        <span style={{ opacity: 0.7, fontSize: fontSize - 1 }}>{count}</span>
      )}
    </Cmp>
  )
})
