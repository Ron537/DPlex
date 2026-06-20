import type { JSX } from 'react'

/**
 * Faint, centered caption rule that separates a project's owned AI sessions
 * from the ones running *outside* DPlex. Pairs with the per-row "External"
 * chip on the rows below it: the caption groups them, the chip labels each.
 *
 * Purely decorative (no interaction) — the rows beneath keep their full
 * `SessionItem` affordances.
 */
export function ExternalSessionsDivider(): JSX.Element {
  return (
    <div
      aria-hidden="true"
      className="flex items-center gap-2 mx-3 mt-1.5 mb-0.5 select-none"
      style={{ color: 'var(--dplex-text-muted)' }}
    >
      <span style={{ flex: 1, height: 1, background: 'var(--dplex-border)', opacity: 0.7 }} />
      <span className="text-[9px] uppercase tracking-wider" style={{ opacity: 0.75 }}>
        Running outside DPlex
      </span>
      <span style={{ flex: 1, height: 1, background: 'var(--dplex-border)', opacity: 0.7 }} />
    </div>
  )
}
