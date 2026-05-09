import { useCallback } from 'react'

interface SearchKeyboardNavTarget {
  totalItems: number
  selectedIndex: number
  setSelectedIndex: (n: number) => void
  moveSelection: (delta: number) => void
  activateSelected: () => void
}

interface SearchKeyboardNavOptions {
  /** Called when the user presses Enter on a row. Receives no arguments —
   *  call `activateSelected` from the search target before invoking. */
  onActivate?: () => void
  /** Called when the user presses Escape. When omitted, Escape is a no-op
   *  (callers that need Escape handling typically use `useEscapeKey` at a
   *  higher level so the listener works regardless of focus). */
  onEscape?: () => void
}

/**
 * Shared keyboard handler for the global-search surfaces. Both the modal
 * palette and the activity-bar search panel use the same arrow-key
 * navigation, Home/End, and Enter activation; this hook keeps them in sync.
 *
 * Returns a ready-to-use `onKeyDown` for any element (typically the input).
 */
export function useSearchKeyboardNav(
  target: SearchKeyboardNavTarget,
  opts: SearchKeyboardNavOptions = {}
): (e: React.KeyboardEvent) => void {
  const { totalItems, setSelectedIndex, moveSelection, activateSelected } = target
  const { onActivate, onEscape } = opts

  return useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (onEscape) {
          e.preventDefault()
          onEscape()
        }
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        moveSelection(1)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        moveSelection(-1)
        return
      }
      if (e.key === 'Home') {
        e.preventDefault()
        setSelectedIndex(0)
        return
      }
      if (e.key === 'End') {
        e.preventDefault()
        setSelectedIndex(Math.max(0, totalItems - 1))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (totalItems > 0) {
          activateSelected()
          onActivate?.()
        }
      }
    },
    [totalItems, setSelectedIndex, moveSelection, activateSelected, onActivate, onEscape]
  )
}
