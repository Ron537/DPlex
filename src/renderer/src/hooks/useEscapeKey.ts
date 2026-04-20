import { useEffect, useRef } from 'react'

/**
 * Invoke `handler` when the user presses Escape anywhere in the document.
 * Pass `enabled = false` to suspend the listener (e.g. when the modal is closed).
 *
 * The handler is stored in a ref so callers can pass fresh closures without
 * re-registering the `keydown` listener on every render.
 */
export function useEscapeKey(handler: () => void, enabled = true): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') handlerRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [enabled])
}
