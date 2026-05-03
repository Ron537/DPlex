import type { JSX } from 'react'
import type { StatusVisual } from '../../utils/sessionStatusVisual'

interface StatusIconProps {
  visual: StatusVisual
  size?: number
  className?: string
}

/**
 * Renders the small SVG motif for a status — a spinner, three dots, etc.
 * Sourced from the preview's status sprite. Adds the spin animation for
 * `running` and the staggered pulse animation for `thinking`; the static
 * states (waiting, idle, attn) leave their pulse to the surrounding
 * container (the LED dot inside a status pill, for instance).
 */
export function StatusIcon({ visual, size = 13, className }: StatusIconProps): JSX.Element {
  const sym = `dplex-i-status-${visual}`
  const animClass = visual === 'running' ? 'dplex-spin' : visual === 'thinking' ? 'dplex-dots' : ''
  const cls = [animClass, className].filter(Boolean).join(' ')
  return (
    <svg
      width={size}
      height={size}
      className={cls || undefined}
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <use href={`#${sym}`} />
    </svg>
  )
}
