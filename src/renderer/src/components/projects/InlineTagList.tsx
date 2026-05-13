import { useLayoutEffect, useRef, useState } from 'react'
import { TagPill } from './TagPill'

interface InlineTagListProps {
  tags: readonly string[]
}

/** Gap between tag pills, in px. Mirrors the Tailwind `gap-1` we apply to
 *  the row so width math matches what flex actually lays out. */
const GAP_PX = 4

/**
 * Renders project tag pills inline, fitting as many as actually fit in the
 * available row width. Anything that doesn't fit is rolled into a neutral
 * `+N` chip with a tooltip listing the hidden tags.
 *
 * Strategy:
 *   1. Render an invisible measurement layer containing every tag pill plus
 *      a `+N` sample chip. The layer is absolutely-positioned inside the
 *      container so it doesn't influence layout but its children still get
 *      real widths from the browser.
 *   2. After layout, compute the largest prefix that fits (including the
 *      `+N` chip's width whenever there will be overflow).
 *   3. Render the visible row from that prefix; rerun on container resize.
 *
 * Two renders per resize is fine — the second one is cheap (same DOM, just
 * fewer visible nodes) and only happens when the container actually changes
 * size. The measurement layer is keyed on the tag list so adding/removing a
 * tag re-runs measurement automatically.
 */
export function InlineTagList({ tags }: InlineTagListProps): React.JSX.Element | null {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const measureRef = useRef<HTMLDivElement | null>(null)
  const [visibleCount, setVisibleCount] = useState(tags.length)

  useLayoutEffect(() => {
    const container = containerRef.current
    const measure = measureRef.current
    if (!container || !measure) return

    const recompute = (): void => {
      const available = container.clientWidth
      const measureChildren = Array.from(
        measure.querySelectorAll<HTMLElement>('[data-tag-measure]')
      )
      const plusEl = measure.querySelector<HTMLElement>('[data-tag-plus]')
      if (measureChildren.length !== tags.length) return
      const widths = measureChildren.map((el) => el.offsetWidth)
      const plusWidth = plusEl?.offsetWidth ?? 0

      // Fast path: does the entire list fit?
      const totalAll =
        widths.reduce((s, w) => s + w, 0) + Math.max(0, widths.length - 1) * GAP_PX
      if (totalAll <= available) {
        setVisibleCount((prev) => (prev === tags.length ? prev : tags.length))
        return
      }

      // Otherwise find the largest k such that the first k pills plus a
      // `+N` chip fit. The `+N` chip itself needs space, so we always
      // account for its width + a gap before it.
      let acc = 0
      let k = 0
      for (let i = 0; i < widths.length; i++) {
        const candidate = acc + (k > 0 ? GAP_PX : 0) + widths[i] + GAP_PX + plusWidth
        if (candidate > available) break
        acc += (k > 0 ? GAP_PX : 0) + widths[i]
        k++
      }
      setVisibleCount((prev) => (prev === k ? prev : k))
    }

    recompute()
    const ro = new ResizeObserver(recompute)
    ro.observe(container)
    return () => ro.disconnect()
  }, [tags])

  if (tags.length === 0) return null

  const hiddenCount = Math.max(0, tags.length - visibleCount)
  const visibleTags = tags.slice(0, visibleCount)
  const hiddenTags = tags.slice(visibleCount)

  return (
    <div
      ref={containerRef}
      className="flex items-center gap-1 min-w-0 relative w-full overflow-hidden"
    >
      {/* Invisible measurement layer — same pills + a sample `+N` chip used
          only for width readings. Absolute so it doesn't affect layout. */}
      <div
        ref={measureRef}
        aria-hidden
        className="flex items-center gap-1"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          visibility: 'hidden',
          pointerEvents: 'none',
          whiteSpace: 'nowrap'
        }}
      >
        {tags.map((t) => (
          <span key={t} data-tag-measure>
            <TagPill tag={t} compact />
          </span>
        ))}
        <span data-tag-plus>
          <PlusBadge count={Math.max(1, tags.length)} />
        </span>
      </div>

      {/* Visible row */}
      {visibleTags.map((t) => (
        <TagPill key={t} tag={t} compact />
      ))}
      {hiddenCount > 0 && (
        <PlusBadge count={hiddenCount} tooltipTags={hiddenTags} />
      )}
    </div>
  )
}

function PlusBadge({
  count,
  tooltipTags
}: {
  count: number
  tooltipTags?: readonly string[]
}): React.JSX.Element {
  return (
    <span
      title={tooltipTags ? tooltipTags.map((t) => `#${t}`).join(', ') : undefined}
      className="inline-flex items-center rounded-full font-medium leading-none whitespace-nowrap"
      style={{
        fontSize: 9.5,
        padding: '1px 5px',
        backgroundColor: 'var(--dplex-bg-input)',
        color: 'var(--dplex-text-muted)',
        border: '1px solid var(--dplex-border)',
        userSelect: 'none',
        flexShrink: 0
      }}
    >
      +{count}
    </span>
  )
}
