import type { CSSProperties, JSX } from 'react'
import type { Space } from '../../types'
import { deriveAvatarColor } from '../../utils/projectStatus'
import { glyphFor } from './spaceVisuals'

interface SpaceAvatarProps {
  space: Pick<Space, 'name' | 'color' | 'glyph'>
  /** Square edge length in px. Default 28. */
  size?: number
  /** Corner radius in px. Defaults to ~30% of size. */
  radius?: number
  /** Pulsing ring — used when the space is calling for attention. */
  ping?: boolean
  className?: string
  style?: CSSProperties
}

/**
 * The tinted, bordered tile that identifies a space everywhere it appears
 * (switcher, sidebar rows, overview cards, status bar, toasts). Reuses the
 * Project panel's avatar palette (`deriveAvatarColor`) — a soft same-hue fill
 * plus a tinted border — so spaces and projects share one visual language.
 * Renders the space's glyph or its name initials in the accent color.
 */
export function SpaceAvatar({
  space,
  size = 28,
  radius,
  ping = false,
  className,
  style
}: SpaceAvatarProps): JSX.Element {
  const r = radius ?? Math.round(size * 0.3)
  const c = deriveAvatarColor(space.color)
  return (
    <span
      aria-hidden
      className={[ping ? 'dplex-space-ping' : '', className].filter(Boolean).join(' ')}
      style={{
        width: size,
        height: size,
        borderRadius: r,
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        color: c.fg,
        fontWeight: 700,
        fontSize: Math.max(9, Math.round(size * 0.42)),
        lineHeight: 1,
        letterSpacing: '0.01em',
        backgroundColor: c.bg,
        border: `${size >= 30 ? 1.5 : 1}px solid ${c.border}`,
        ...style
      }}
    >
      {glyphFor(space)}
    </span>
  )
}
