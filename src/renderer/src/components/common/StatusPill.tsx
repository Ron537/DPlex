import type { CSSProperties, JSX, ReactNode } from 'react'
import { type StatusVisual, labelForVisual } from '../../utils/sessionStatusVisual'

interface StatusPillProps {
  visual: StatusVisual
  /** Override the default label. Pass `null` for a label-less dot-only pill. */
  label?: ReactNode | null
  /** Render a leading status LED dot. Defaults to true. */
  showDot?: boolean
  /** Compact size variant — slightly smaller padding and font. */
  compact?: boolean
  className?: string
  style?: CSSProperties
}

/**
 * Soft-pill status badge. Used in two places:
 *  - Worktree section headers (compact, dot + count) — see Scene ① in the preview
 *  - Project rows or legends (full label)
 *
 * Status colors come from the shared --dplex-status-* tokens via the
 * `.dplex-pill-*` rules in main.css, so the badge adapts to light/dark themes.
 */
export function StatusPill({
  visual,
  label,
  showDot = true,
  compact = false,
  className,
  style
}: StatusPillProps): JSX.Element {
  const cls = ['dplex-pill', `dplex-pill-${visual}`, compact ? 'dplex-pill-compact' : '', className]
    .filter(Boolean)
    .join(' ')
  const text = label === undefined ? labelForVisual(visual) : label
  return (
    <span className={cls} style={style}>
      {showDot ? <span className="dplex-pill-led" /> : null}
      {text}
    </span>
  )
}
