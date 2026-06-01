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
  /**
   * `chip` (default) — solid tag-colored background. Used inside project
   * cards where the chip itself is the identity.
   * `dot` — neutral background + leading colored dot. Used in the top
   * filter bar so the row reads as a quiet control strip while still
   * preserving per-tag color identity.
   */
  variant?: 'chip' | 'dot'
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
  colorOverride,
  variant = 'chip'
}: TagPillProps): React.JSX.Element {
  const savedOverride = useSettingsStore((s) => s.settings.tagColors?.[tag])
  const effectiveOverride = colorOverride !== undefined ? colorOverride : savedOverride
  const { bg, fg } = getTagColor(tag, effectiveOverride)
  const fontSize = compact ? 9.5 : 11
  const padding = compact ? '1px 5px' : '2px 8px'
  const Cmp = (onClick ? 'button' : 'span') as 'button' | 'span'

  if (variant === 'dot') {
    // Neutral chip with a leading tag-color dot. Active state lifts the
    // background to accent-soft + accent border so the active filter is
    // unambiguous while inactive chips read as a calm row.
    return (
      <Cmp
        onClick={onClick}
        title={title ?? `#${tag}`}
        className="inline-flex items-center gap-1.5 rounded-full font-medium leading-none whitespace-nowrap transition-colors"
        style={{
          fontSize,
          padding,
          backgroundColor: active ? 'var(--dplex-accent-soft)' : 'transparent',
          color: active ? 'var(--dplex-text)' : 'var(--dplex-text-muted)',
          border: `1px solid ${active ? 'var(--dplex-accent-ring)' : 'var(--dplex-border-strong)'}`,
          cursor: onClick ? 'pointer' : 'default',
          userSelect: 'none',
          maxWidth: compact ? 90 : 140,
          minWidth: 0,
          flexShrink: 0
        }}
      >
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            backgroundColor: fg,
            flexShrink: 0
          }}
        />
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
          <span style={{ opacity: 0.6, fontSize: fontSize - 1 }}>{count}</span>
        )}
      </Cmp>
    )
  }

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
