import type { JSX } from 'react'
import type { SpaceAttention } from '../../utils/spaceAttention'
import { attentionColorVar, attentionLabel } from './spaceVisuals'

interface AttentionChipProps {
  attention: SpaceAttention
  /** Show only the count (no "to review" text) — for dense rows. */
  compact?: boolean
}

/**
 * Pulsing pill summarizing a space's rolled-up attention. Colored by the
 * highest-priority pending kind (approval > input > finished). Renders nothing
 * when the space needs no attention. DPlex surfaces only the attention signal;
 * it never inspects session content.
 */
export function AttentionChip({
  attention,
  compact = false
}: AttentionChipProps): JSX.Element | null {
  if (attention.total === 0) return null
  const color = attentionColorVar(attention.topKind)
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap"
      style={{
        padding: compact ? '2px 6px' : '2px 7px 2px 6px',
        borderRadius: 20,
        fontSize: 10.5,
        fontWeight: 700,
        color,
        backgroundColor: 'color-mix(in srgb, var(--dplex-attn-chip) 16%, transparent)',
        // `--dplex-attn-chip` is set locally so color-mix can reference the
        // resolved status color (color-mix can't nest a var() ramp directly).
        ['--dplex-attn-chip' as string]: color
      }}
    >
      <span
        aria-hidden
        className="dplex-pulse-dot"
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: color,
          boxShadow: `0 0 6px ${color}`
        }}
      />
      {compact ? attention.total : attentionLabel(attention)}
    </span>
  )
}
