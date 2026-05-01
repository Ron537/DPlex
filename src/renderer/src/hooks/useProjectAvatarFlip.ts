import { useLayoutEffect, useRef } from 'react'

/**
 * FLIP-style layout animation for project avatars when the sidebar toggles
 * between expanded (full rows) and collapsed (rail). Both layouts tag the
 * avatar element with `data-project-avatar="<projectId>"`; this hook measures
 * positions before/after a `triggerKey` change and animates the avatar from
 * its previous rect to the new one with a single CSS transform pass.
 *
 * Two design choices worth noting:
 *
 *  1. The effect runs only when `triggerKey` changes (and on mount). On the
 *     toggle render `useLayoutEffect` runs after commit — by then the DOM
 *     reflects the new layout, while `prevRects.current` still holds rects
 *     captured during the previous matching render (which had the old
 *     layout). Running on every render would force a synchronous layout on
 *     each unrelated SidePanel re-render.
 *
 *  2. The hook saves and restores the avatar's existing inline `transition`
 *     instead of clearing it. The avatar component declares its own
 *     `border-color` / `opacity` transitions on the same element, and
 *     overwriting that to `''` would strip them.
 */
export function useProjectAvatarFlip(triggerKey: unknown): void {
  const prevRects = useRef<Map<string, DOMRect>>(new Map())
  const prevTrigger = useRef<unknown>(triggerKey)

  useLayoutEffect(() => {
    const els = document.querySelectorAll<HTMLElement>('[data-project-avatar]')
    const newRects = new Map<string, DOMRect>()
    els.forEach((el) => {
      const id = el.dataset.projectAvatar
      if (id) newRects.set(id, el.getBoundingClientRect())
    })

    const triggerChanged = prevTrigger.current !== triggerKey
    if (triggerChanged) {
      els.forEach((el) => {
        const id = el.dataset.projectAvatar
        if (!id) return
        const prev = prevRects.current.get(id)
        const curr = newRects.get(id)
        if (!prev || !curr) return
        const dx = prev.left - curr.left
        const dy = prev.top - curr.top
        const sx = prev.width / curr.width
        const sy = prev.height / curr.height
        if (
          Math.abs(dx) < 1 &&
          Math.abs(dy) < 1 &&
          Math.abs(sx - 1) < 0.02 &&
          Math.abs(sy - 1) < 0.02
        ) {
          return
        }
        const originalTransition = el.style.transition
        const originalTransformOrigin = el.style.transformOrigin
        el.style.transformOrigin = '0 0'
        el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`
        el.style.transition = 'none'
        // Force a reflow so the snap-back applies before the transition starts.
        void el.offsetWidth
        requestAnimationFrame(() => {
          el.style.transition = 'transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1)'
          el.style.transform = ''
          const cleanup = (): void => {
            // Restore the component's own inline transition rather than
            // clobbering it — the avatar relies on its declared border/opacity
            // transitions for the status-reveal animation.
            el.style.transition = originalTransition
            el.style.transformOrigin = originalTransformOrigin
            el.style.transform = ''
            el.removeEventListener('transitionend', cleanup)
          }
          el.addEventListener('transitionend', cleanup)
        })
      })
    }

    prevRects.current = newRects
    prevTrigger.current = triggerKey
  }, [triggerKey])
}
