/**
 * Attention Inbox shared types.
 * Surfaced from main → preload → renderer. Composite identity is always
 * `${providerId}:${sessionId}` to avoid collisions across providers.
 */

export type AttentionKind =
  | 'waitingForApproval'
  | 'waitingForInput'
  | 'finished'

/**
 * A single attention event. At most one active event per composite id.
 * `escalated` indicates the idleTooLong escalation has fired for this waiting
 * event (so we don't re-notify forever).
 */
export interface AttentionEvent {
  compositeId: string
  providerId: string
  sessionId: string
  displayName: string
  kind: AttentionKind
  createdAt: number
  escalated: boolean
  /** True once the user dismissed the event; cleared on next status transition. */
  suppressed: boolean
  /** True if seeded on startup — no notification, no unread count. */
  seeded: boolean
}

/**
 * Snapshot pushed from main whenever attention state changes.
 * Renderer replaces its mirror with the full snapshot; no partial updates.
 */
export interface AttentionSnapshot {
  version: number
  active: AttentionEvent[]
  unreadCount: number
}

export function makeCompositeId(providerId: string, sessionId: string): string {
  return `${providerId}:${sessionId}`
}
