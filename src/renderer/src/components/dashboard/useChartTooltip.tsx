import { useCallback, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface TipState {
  x: number
  y: number
  content: ReactNode
}

interface ChartTooltip {
  /** Show/move the tooltip at the pointer. Call from onMouseEnter/onMouseMove. */
  show: (e: { clientX: number; clientY: number }, content: ReactNode) => void
  /** Hide the tooltip. Call from onMouseLeave. */
  hide: () => void
  /** Portal node to render once per chart (null when hidden). */
  node: ReactNode
}

/**
 * Lightweight, instant chart tooltip. Renders through a portal to escape card
 * `overflow`, follows the cursor, and appears with zero delay (unlike the
 * native `title` attribute, whose ~1s delay made the heatmap feel sluggish).
 * One instance per chart component.
 */
export function useChartTooltip(): ChartTooltip {
  const [tip, setTip] = useState<TipState | null>(null)

  const show = useCallback((e: { clientX: number; clientY: number }, content: ReactNode): void => {
    setTip({ x: e.clientX, y: e.clientY, content })
  }, [])
  const hide = useCallback((): void => setTip(null), [])

  const node = tip
    ? createPortal(
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            left: tip.x,
            top: tip.y - 12,
            transform: 'translate(-50%, -100%)',
            pointerEvents: 'none',
            zIndex: 1000,
            padding: '6px 9px',
            borderRadius: 8,
            background: 'var(--dplex-bg-elev-3)',
            border: '1px solid var(--dplex-border-strong)',
            boxShadow: '0 8px 24px -8px rgba(0,0,0,0.6)',
            color: 'var(--dplex-text)',
            fontSize: 11.5,
            fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
            whiteSpace: 'nowrap',
            lineHeight: 1.5
          }}
        >
          {tip.content}
        </div>,
        document.body
      )
    : null

  return { show, hide, node }
}
