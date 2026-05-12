import type { AttentionKind } from '../../../../preload/attentionTypes'

/**
 * Decision returned by {@link decideRowClickAction}.
 *
 * - `acknowledge` — call `acknowledge(compositeId)`. Used for `finished`
 *   events: they have no natural transition to clear them, so a click is
 *   the user saying "I saw it, it's done."
 * - `dismiss` — call `dismiss(compositeId)`. Used for waiting events when
 *   the user has opted into Slack/Gmail-style "click marks seen" mode. The
 *   attention service re-surfaces the event on the next status transition
 *   or via the idle-too-long escalation.
 * - `none` — navigate only; leave the event in place.
 */
export type RowClickAction = 'acknowledge' | 'dismiss' | 'none'

/**
 * Pure decision used by `AttentionBellButton.handleRowClick`. Kept separate
 * so it can be unit-tested without rendering React.
 */
export function decideRowClickAction(
  kind: AttentionKind,
  clickClearsWaiting: boolean
): RowClickAction {
  if (kind === 'finished') return 'acknowledge'
  if (clickClearsWaiting) return 'dismiss'
  return 'none'
}
