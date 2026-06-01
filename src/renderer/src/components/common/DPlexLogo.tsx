import { memo, useId } from 'react'

interface DPlexLogoProps {
  size?: number
  /** Drops the drop-shadow filter at small sizes where it just blurs the
   *  glyph. Defaults to true for size <= 24. */
  flat?: boolean
  className?: string
}

/**
 * Inline render of the DPlex brand mark. Mirrors `resources/icon.svg`
 * exactly — keep the two in sync when the brand evolves. Rendered as
 * inline SVG so it scales crisply at any pixel size (16 in the title
 * bar, 72 in the empty-state hero) without needing a separate PNG
 * sprite. Drop-shadow filter is suppressed at small sizes because the
 * blur kernel exceeds the icon footprint and reads as a halo.
 *
 * Element IDs (gradients + filter) are suffixed with a React `useId`
 * so multiple `<DPlexLogo>` instances on the same page (e.g. title bar
 * + empty-state hero) can't clash on `url(#…)` references. Duplicate
 * IDs in the same document would silently bind the wrong defs whenever
 * the two instances diverge (different palette, different filter) —
 * fragile even though the current renders happen to be byte-identical.
 */
export const DPlexLogo = memo(function DPlexLogo({
  size = 72,
  flat,
  className
}: DPlexLogoProps): React.JSX.Element {
  const useFilter = flat === false ? true : flat === true ? false : size > 24
  // `useId()` returns a string that contains colons on some React
  // versions; strip them so the result is a valid CSS/SVG id fragment.
  const uid = useId().replace(/:/g, '')
  const bgId = `dplex-logo-bg-${uid}`
  const panelId = `dplex-logo-panel-${uid}`
  const tabId = `dplex-logo-tab-${uid}`
  const promptId = `dplex-logo-prompt-${uid}`
  const shadowId = `dplex-logo-shadow-${uid}`
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="DPlex"
    >
      <defs>
        <linearGradient id={bgId} x1="96" y1="48" x2="416" y2="464" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#60a5fa" />
          <stop offset="0.55" stopColor="#2563eb" />
          <stop offset="1" stopColor="#1e3a8a" />
        </linearGradient>
        <linearGradient
          id={panelId}
          x1="109"
          y1="114"
          x2="412"
          y2="409"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#1c1c23" />
          <stop offset="1" stopColor="#0a0a0c" />
        </linearGradient>
        <linearGradient
          id={tabId}
          x1="105"
          y1="146"
          x2="204"
          y2="195"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#93c5fd" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
        <linearGradient
          id={promptId}
          x1="129"
          y1="227"
          x2="192"
          y2="320"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#6ee7b7" />
          <stop offset="1" stopColor="#34d399" />
        </linearGradient>
        {useFilter && (
          <filter
            id={shadowId}
            x="20"
            y="41"
            width="472"
            height="418"
            colorInterpolationFilters="sRGB"
            filterUnits="userSpaceOnUse"
          >
            <feDropShadow
              dx="0"
              dy="20"
              stdDeviation="20"
              floodColor="#000000"
              floodOpacity="0.45"
            />
            <feDropShadow
              dx="0"
              dy="0"
              stdDeviation="16"
              floodColor="#3b82f6"
              floodOpacity="0.22"
            />
          </filter>
        )}
      </defs>

      <rect width="512" height="512" rx="112" fill={`url(#${bgId})`} />

      <g filter={useFilter ? `url(#${shadowId})` : undefined}>
        <rect
          x="105"
          y="77"
          width="302"
          height="61"
          rx="31"
          fill="#1f2940"
          stroke="#3a4f7a"
          strokeWidth="7"
          opacity="0.85"
        />
        <rect
          x="81"
          y="105"
          width="349"
          height="61"
          rx="31"
          fill="#172033"
          stroke="#3a4f7a"
          strokeWidth="7"
          opacity="0.95"
        />
        <rect
          x="56"
          y="133"
          width="401"
          height="274"
          rx="68"
          fill={`url(#${panelId})`}
          stroke="#3a4f7a"
          strokeWidth="9"
        />

        <rect x="105" y="178" width="99" height="31" rx="15" fill={`url(#${tabId})`} />
        <rect x="225" y="178" width="78" height="31" rx="15" fill="#3f4456" />
        <rect x="324" y="178" width="54" height="31" rx="15" fill="#3f4456" opacity="0.7" />

        <path
          d="M136 249L189 291L136 334"
          fill="none"
          stroke={`url(#${promptId})`}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="35"
        />
        <rect x="219" y="275" width="132" height="33" rx="17" fill="#fafafa" />
      </g>
    </svg>
  )
})
