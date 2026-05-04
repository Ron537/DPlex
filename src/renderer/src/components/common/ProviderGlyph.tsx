import type { CSSProperties, JSX } from 'react'
import { providerSymbolId, providerTintClass, type ProviderId } from '../../utils/providerHelpers'

interface ProviderGlyphProps {
  providerId: ProviderId
  size?: 'xs' | 'sm' | 'md'
  title?: string
  className?: string
  style?: CSSProperties
}

/**
 * Neutral monochrome card displaying a provider mark.
 * Lives in the avatar slot only when status-as-avatar is NOT used —
 * for example in pinned tabs or settings provider rows.
 */
export function ProviderGlyph({
  providerId,
  size = 'md',
  title,
  className,
  style
}: ProviderGlyphProps): JSX.Element {
  const cls = [
    'dplex-pg',
    size === 'sm' ? 'dplex-pg-sm' : '',
    size === 'xs' ? 'dplex-pg-xs' : '',
    providerTintClass(providerId),
    className
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={cls} title={title} style={style}>
      <svg aria-hidden="true">
        <use href={`#${providerSymbolId(providerId)}`} />
      </svg>
    </div>
  )
}
