import type { JSX } from 'react'
import type { StatusVisual } from '../../utils/sessionStatusVisual'

interface StatusDotProps {
  /** Status visual category, or 'terminal' for plain shells. */
  visual: StatusVisual | 'terminal'
  title?: string
}

/**
 * 8px colored dot used in compact session/terminal rows. The colored
 * fill maps to a `--dplex-status-*` token; live states pulse softly.
 * Smaller, quieter cousin of `StatusAvatar` — designed to live in a
 * single-line row alongside a provider glyph and a title.
 */
export function StatusDot({ visual, title }: StatusDotProps): JSX.Element {
  const map: Record<
    StatusVisual | 'terminal',
    { color: string; pulse: boolean }
  > = {
    idle: { color: 'var(--dplex-status-idle)', pulse: false },
    thinking: { color: 'var(--dplex-status-thinking)', pulse: true },
    running: { color: 'var(--dplex-status-executing)', pulse: true },
    waiting: { color: 'var(--dplex-status-waiting)', pulse: false },
    attn: { color: 'var(--dplex-status-approval)', pulse: false },
    terminal: { color: 'var(--dplex-text-dim)', pulse: false }
  }
  const cfg = map[visual]
  return (
    <span
      title={title}
      aria-hidden
      className={cfg.pulse ? 'dplex-status-dot dplex-status-dot-pulse' : 'dplex-status-dot'}
      style={{ backgroundColor: cfg.color }}
    />
  )
}
