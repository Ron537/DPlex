import type { SessionStatus } from '../types'

/**
 * Five canonical status visuals shared by StatusAvatar and StatusPill.
 * `attn` is an alias used by the new pill style for awaitingApproval — it
 * keeps the visual vocabulary tight ("attention" reads better than
 * "awaitingApproval" in tooltips and labels).
 */
export type StatusVisual = 'idle' | 'thinking' | 'running' | 'waiting' | 'attn'

/**
 * Bridge from the existing detailedStatus enum to the new visual category.
 * Keeps the data model untouched while letting the UI collapse to one of
 * the five rendered states.
 */
export function visualForStatus(status: SessionStatus | undefined): StatusVisual {
  switch (status) {
    case 'thinking':
      return 'thinking'
    case 'executingTool':
      return 'running'
    case 'waitingForUser':
      return 'waiting'
    case 'awaitingApproval':
      return 'attn'
    case 'idle':
    case undefined:
    default:
      return 'idle'
  }
}

/**
 * Default human-readable label for a status visual. Callers can override
 * but this keeps strings consistent across pills, tooltips, and a11y.
 */
export function labelForVisual(visual: StatusVisual): string {
  switch (visual) {
    case 'thinking':
      return 'Thinking'
    case 'running':
      return 'Running'
    case 'waiting':
      return 'Waiting for input'
    case 'attn':
      return 'Needs approval'
    case 'idle':
    default:
      return 'Idle'
  }
}
