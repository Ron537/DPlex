import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'

interface PopoverMenuProps {
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  align?: 'left' | 'right'
  /** Minimum gap from viewport edges in px. */
  edgePadding?: number
  className?: string
  children: React.ReactNode
}

/**
 * A dropdown/context menu that portals to document.body so it cannot be
 * clipped by scrollable/overflow ancestors, and automatically flips above
 * the anchor if there is not enough space below.
 */
export function PopoverMenu({
  anchorRef,
  open,
  onClose,
  align = 'right',
  edgePadding = 8,
  className = '',
  children
}: PopoverMenuProps): React.JSX.Element | null {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number; visibility: 'hidden' | 'visible' }>({
    top: 0,
    left: 0,
    visibility: 'hidden'
  })

  useLayoutEffect(() => {
    if (!open) return
    const anchor = anchorRef.current
    const menu = menuRef.current
    if (!anchor || !menu) return

    const compute = (): void => {
      const a = anchor.getBoundingClientRect()
      const m = menu.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight

      // Vertical: prefer below; flip above if not enough room and more room above.
      const spaceBelow = vh - a.bottom
      const spaceAbove = a.top
      let top: number
      if (spaceBelow >= m.height + edgePadding || spaceBelow >= spaceAbove) {
        top = a.bottom + 4
        if (top + m.height + edgePadding > vh) {
          top = Math.max(edgePadding, vh - m.height - edgePadding)
        }
      } else {
        top = a.top - m.height - 4
        if (top < edgePadding) top = edgePadding
      }

      // Horizontal: prefer requested align; clamp to viewport.
      let left: number
      if (align === 'right') {
        left = a.right - m.width
      } else {
        left = a.left
      }
      if (left + m.width + edgePadding > vw) left = vw - m.width - edgePadding
      if (left < edgePadding) left = edgePadding

      setPos({ top, left, visibility: 'visible' })
    }

    compute()
    const onScrollOrResize = (): void => compute()
    window.addEventListener('resize', onScrollOrResize)
    window.addEventListener('scroll', onScrollOrResize, true)
    return () => {
      window.removeEventListener('resize', onScrollOrResize)
      window.removeEventListener('scroll', onScrollOrResize, true)
    }
  }, [open, align, edgePadding, anchorRef])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[1000]"
        onMouseDown={(e) => {
          e.stopPropagation()
          onClose()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div
        ref={menuRef}
        className={`fixed z-[1001] rounded-md shadow-xl py-1 ${className}`}
        style={{
          top: pos.top,
          left: pos.left,
          visibility: pos.visibility,
          backgroundColor: 'var(--dplex-bg)',
          border: '1px solid var(--dplex-border)'
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>,
    document.body
  )
}
