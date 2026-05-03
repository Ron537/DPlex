import type { CSSProperties, JSX } from 'react'
import { StatusIcon } from './StatusIcon'
import { type StatusVisual, labelForVisual } from '../../utils/sessionStatusVisual'
import { providerSymbolId, providerTintClass, type ProviderId } from '../../utils/providerHelpers'

interface StatusAvatarProps {
  /** Status visual category — drives bg/border tint and the icon motif. */
  visual: StatusVisual
  /**
   * When true, render a small provider corner badge in the bottom-right.
   * Caller is responsible for computing this — typically by passing the
   * `mixed` flag derived from `isMixedProviderList(siblings)`.
   */
  showProviderBadge?: boolean
  /** Provider id — used by the corner badge's icon and tint. Required when showProviderBadge is true. */
  providerId?: ProviderId
  title?: string
  className?: string
  style?: CSSProperties
}

/**
 * Replaces the bare status dot in session rows. The avatar slot reflects
 * state (running/thinking/waiting/idle/attn) so the eye lands on what's
 * actionable. The provider corner badge appears only when the surrounding
 * list mixes providers — single-tool users get a quiet status-driven rail.
 *
 * Visual + dimensions match `.dplex-sav` in main.css, which mirrors `.sav`
 * in the HTML preview.
 */
export function StatusAvatar({
  visual,
  showProviderBadge = false,
  providerId,
  title,
  className,
  style
}: StatusAvatarProps): JSX.Element {
  const cls = ['dplex-sav', `dplex-sav-${visual}`, className].filter(Boolean).join(' ')
  const a11y = title ?? labelForVisual(visual)
  return (
    <div className={cls} title={a11y} style={style} role="img" aria-label={a11y}>
      <StatusIcon visual={visual} />
      {showProviderBadge && providerId ? (
        <span className={`dplex-sav-corner ${providerTintClass(providerId)}`} aria-hidden="true">
          <svg>
            <use href={`#${providerSymbolId(providerId)}`} />
          </svg>
        </span>
      ) : null}
    </div>
  )
}
