import type { AISession } from '../types'
import { effectiveSessionVisual } from './sessionPairing'
import type { StatusVisual } from './sessionStatusVisual'

/**
 * Aggregate the most "interesting" status visual across a list of sessions.
 * Priority: attn > waiting > running > thinking > idle. Used to colour the
 * worktree section header's count pill.
 *
 * Uses the same active→thinking fallback as `SessionItem` so the header
 * pill never disagrees with the rows below it.
 */
export function aggregateVisual(sessions: AISession[]): StatusVisual {
  const visuals = sessions
    .filter((s) => s.status === 'active')
    .map((s) => effectiveSessionVisual(s))
  const order: StatusVisual[] = ['attn', 'waiting', 'running', 'thinking', 'idle']
  for (const v of order) {
    if (visuals.includes(v)) return v
  }
  return 'idle'
}
