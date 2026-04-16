import { app } from 'electron'
import type { DiscoveredSession, SessionStatus } from './providers/types'
import type {
  AttentionEvent,
  AttentionKind,
  AttentionSnapshot
} from '../../preload/attentionTypes'
import { makeCompositeId } from '../../preload/attentionTypes'

/**
 * Attention Inbox state machine (main process).
 *
 * Source of truth for which sessions need the user's attention. Per-session
 * state tracks the last status, active surfaced event, and suppression flags.
 * Transitions drive event emission; there is no priority race.
 */

interface SessionState {
  compositeId: string
  providerId: string
  sessionId: string
  displayName: string
  currentStatus: SessionStatus
  activeEvent: AttentionEvent | null
  activeSince: number
  escalated: boolean
  /** Pinned to true after user dismiss; cleared on status transition. */
  suppressedUntilTransition: boolean
}

const state = new Map<string, SessionState>()
const history: AttentionEvent[] = []
const HISTORY_CAP = 50

let version = 0
let idleThresholdMs = 5 * 60 * 1000

type SnapshotListener = (snapshot: AttentionSnapshot) => void
type NewEventListener = (event: AttentionEvent) => void

const snapshotListeners = new Set<SnapshotListener>()
const newEventListeners = new Set<NewEventListener>()

function now(): number {
  return Date.now()
}

/** Add a listener that fires whenever the snapshot changes. */
export function onSnapshotChanged(cb: SnapshotListener): () => void {
  snapshotListeners.add(cb)
  return () => snapshotListeners.delete(cb)
}

/**
 * Add a listener that fires for genuinely new attention events
 * (not seeded, not escalations alone). Used by the notification renderer.
 */
export function onNewAttentionEvent(cb: NewEventListener): () => void {
  newEventListeners.add(cb)
  return () => newEventListeners.delete(cb)
}

/** Add a listener that fires for idle escalations on existing events. */
const escalationListeners = new Set<NewEventListener>()
export function onEscalation(cb: NewEventListener): () => void {
  escalationListeners.add(cb)
  return () => escalationListeners.delete(cb)
}

/** Configurable idle-too-long threshold (minutes). */
export function setIdleThresholdMinutes(minutes: number): void {
  const ms = Math.max(1, Math.floor(minutes)) * 60 * 1000
  idleThresholdMs = ms
}

function statusToKind(status: SessionStatus): AttentionKind | null {
  if (status === 'awaitingApproval') return 'waitingForApproval'
  if (status === 'waitingForUser') return 'waitingForInput'
  return null
}

function isWorkingStatus(status: SessionStatus): boolean {
  return status === 'thinking' || status === 'executingTool'
}

function getSnapshot(): AttentionSnapshot {
  const active: AttentionEvent[] = []
  let unread = 0
  for (const s of state.values()) {
    if (!s.activeEvent) continue
    active.push(s.activeEvent)
    // Dismissed events don't count toward unread; seeded events do
    // (user genuinely has pending attention, even at startup).
    if (!s.suppressedUntilTransition) {
      unread++
    }
  }
  // Newest first
  active.sort((a, b) => b.createdAt - a.createdAt)
  return { version, active, unreadCount: unread }
}

function bump(): void {
  version++
  updateBadge()
  const snap = getSnapshot()
  for (const cb of snapshotListeners) cb(snap)
}

function updateBadge(): void {
  if (process.platform !== 'darwin') return
  const snap = getSnapshot()
  try {
    app.setBadgeCount(snap.unreadCount)
  } catch {
    // macOS may reject before ready — ignore
  }
}

function pushHistory(event: AttentionEvent): void {
  history.push(event)
  if (history.length > HISTORY_CAP) history.splice(0, history.length - HISTORY_CAP)
}

function clearActiveEvent(s: SessionState, keepInHistory: boolean): void {
  if (!s.activeEvent) return
  if (keepInHistory) pushHistory(s.activeEvent)
  s.activeEvent = null
  s.escalated = false
  s.suppressedUntilTransition = false
}

function makeEvent(
  s: SessionState,
  kind: AttentionKind,
  seeded: boolean
): AttentionEvent {
  return {
    compositeId: s.compositeId,
    providerId: s.providerId,
    sessionId: s.sessionId,
    displayName: s.displayName,
    kind,
    createdAt: now(),
    escalated: false,
    suppressed: false,
    seeded
  }
}

/**
 * Ingest a session update from a provider watcher.
 * Classifies the transition and emits events as needed.
 */
export function ingestSessionUpdate(session: DiscoveredSession): void {
  const providerId = session.aiTool
  const sessionId = session.id
  const compositeId = makeCompositeId(providerId, sessionId)
  const newStatus = session.detailedStatus ?? 'idle'

  let s = state.get(compositeId)
  if (!s) {
    s = {
      compositeId,
      providerId,
      sessionId,
      displayName: session.displayName || sessionId,
      currentStatus: newStatus,
      activeEvent: null,
      activeSince: now(),
      escalated: false,
      suppressedUntilTransition: false
    }
    state.set(compositeId, s)
    // First-ever sighting: no transition to classify. If already waiting, do
    // NOT emit here — that's the job of seedDiscoveredSession at startup.
    return
  }

  // Keep displayName current
  s.displayName = session.displayName || s.displayName

  const prevStatus = s.currentStatus
  if (prevStatus === newStatus) return
  s.currentStatus = newStatus

  const newKind = statusToKind(newStatus)

  // Any genuine transition clears suppression.
  const hadSuppression = s.suppressedUntilTransition
  s.suppressedUntilTransition = false

  // Idle/finished → working again: clear any lingering "finished" event so
  // the bell/badge don't show stale attention for a session that resumed work.
  if (!isWorkingStatus(prevStatus) && isWorkingStatus(newStatus)) {
    if (s.activeEvent && s.activeEvent.kind === 'finished') {
      clearActiveEvent(s, /* keepInHistory */ true)
      bump()
    }
    return
  }

  // Working → idle: emit "finished" unless currently showing a waiting event
  // (shouldn't happen because waiting states are not "working", but guard).
  if (isWorkingStatus(prevStatus) && newStatus === 'idle') {
    // Clear any stale waiting event first (shouldn't exist, but be safe).
    if (s.activeEvent && s.activeEvent.kind !== 'finished') {
      clearActiveEvent(s, /* keepInHistory */ true)
    }
    const evt = makeEvent(s, 'finished', false)
    s.activeEvent = evt
    s.activeSince = evt.createdAt
    s.escalated = false
    bump()
    for (const cb of newEventListeners) cb(evt)
    return
  }

  // Transition INTO a waiting state
  if (newKind) {
    // Replace any prior event (e.g., a lingering "finished")
    if (s.activeEvent) clearActiveEvent(s, /* keepInHistory */ true)
    const evt = makeEvent(s, newKind, false)
    s.activeEvent = evt
    s.activeSince = evt.createdAt
    s.escalated = false
    bump()
    for (const cb of newEventListeners) cb(evt)
    return
  }

  // Transition OUT OF a waiting state (any → non-waiting, non-finished path)
  if (statusToKind(prevStatus) && !newKind) {
    if (s.activeEvent && s.activeEvent.kind !== 'finished') {
      clearActiveEvent(s, /* keepInHistory */ true)
      bump()
    }
    return
  }

  // Any other status change: if suppression was cleared, we may need to bump
  // so the renderer re-evaluates unread count.
  if (hadSuppression) bump()
}

/**
 * Seed current attention state for a session discovered at startup.
 * Does NOT notify or increment unread count — pre-existing waiting states
 * are not fresh attention events.
 */
export function seedDiscoveredSession(session: DiscoveredSession): void {
  const providerId = session.aiTool
  const sessionId = session.id
  const compositeId = makeCompositeId(providerId, sessionId)
  if (state.has(compositeId)) return

  const currentStatus = session.detailedStatus ?? 'idle'
  const s: SessionState = {
    compositeId,
    providerId,
    sessionId,
    displayName: session.displayName || sessionId,
    currentStatus,
    activeEvent: null,
    activeSince: now(),
    escalated: false,
    suppressedUntilTransition: false
  }
  state.set(compositeId, s)

  const kind = statusToKind(currentStatus)
  if (kind) {
    // Seed as active event but mark seeded=true and suppress until a fresh
    // transition. Will not count toward unread, will not notify.
    s.activeEvent = {
      ...makeEvent(s, kind, true),
      suppressed: true
    }
    s.suppressedUntilTransition = true
    bump()
  }
}

/**
 * Register a session discovered AFTER initial startup. Unlike
 * `seedDiscoveredSession`, this treats any current waiting state as a fresh
 * attention event — the session has just appeared and the user has not seen it.
 */
export function addDiscoveredSession(session: DiscoveredSession): void {
  const providerId = session.aiTool
  const sessionId = session.id
  const compositeId = makeCompositeId(providerId, sessionId)
  if (state.has(compositeId)) return

  const currentStatus = session.detailedStatus ?? 'idle'
  const s: SessionState = {
    compositeId,
    providerId,
    sessionId,
    displayName: session.displayName || sessionId,
    currentStatus,
    activeEvent: null,
    activeSince: now(),
    escalated: false,
    suppressedUntilTransition: false
  }
  state.set(compositeId, s)

  const kind = statusToKind(currentStatus)
  if (kind) {
    const evt = makeEvent(s, kind, false)
    s.activeEvent = evt
    s.activeSince = evt.createdAt
    bump()
    for (const cb of newEventListeners) cb(evt)
  }
}

/** Acknowledge the active event for a composite id (only clears `finished`). */
export function acknowledge(compositeId: string): void {
  const s = state.get(compositeId)
  if (!s || !s.activeEvent) return
  if (s.activeEvent.kind !== 'finished') return
  clearActiveEvent(s, /* keepInHistory */ true)
  bump()
}

/** Acknowledge all `finished` events (the only kind auto-ack applies to). */
export function acknowledgeAll(): void {
  let changed = false
  for (const s of state.values()) {
    if (s.activeEvent && s.activeEvent.kind === 'finished') {
      clearActiveEvent(s, /* keepInHistory */ true)
      changed = true
    }
  }
  if (changed) bump()
}

/**
 * Explicit dismiss — suppresses the active event until the next status
 * transition. Applies to any kind (including waiting events).
 */
export function dismiss(compositeId: string): void {
  const s = state.get(compositeId)
  if (!s || !s.activeEvent) return
  s.activeEvent = { ...s.activeEvent, suppressed: true }
  s.suppressedUntilTransition = true
  bump()
}

/** Remove all state for a deleted session. */
export function forgetSession(compositeId: string): void {
  const s = state.get(compositeId)
  if (!s) return
  if (s.activeEvent) pushHistory(s.activeEvent)
  state.delete(compositeId)
  bump()
}

/**
 * Remove all attention state entries matching a bare sessionId across any
 * provider. Used when callers delete a session without knowing providerId.
 */
export function forgetSessionsByBareId(sessionId: string): string[] {
  const removed: string[] = []
  for (const [cid, s] of state.entries()) {
    if (s.sessionId === sessionId) {
      if (s.activeEvent) pushHistory(s.activeEvent)
      state.delete(cid)
      removed.push(cid)
    }
  }
  if (removed.length > 0) bump()
  return removed
}

/** Public snapshot for IPC `getSnapshot` handler. */
export function currentSnapshot(): AttentionSnapshot {
  return getSnapshot()
}

/** Periodic sweep for idle-too-long escalation. */
function sweepIdle(): void {
  const t = now()
  let changed = false
  for (const s of state.values()) {
    const ev = s.activeEvent
    if (!ev) continue
    if (ev.seeded) continue
    if (ev.suppressed) continue
    if (s.escalated) continue
    if (ev.kind !== 'waitingForApproval' && ev.kind !== 'waitingForInput') continue
    if (t - s.activeSince < idleThresholdMs) continue
    s.escalated = true
    s.activeEvent = { ...ev, escalated: true }
    changed = true
    for (const cb of escalationListeners) cb(s.activeEvent)
  }
  if (changed) bump()
}

let sweeper: NodeJS.Timeout | null = null
export function startIdleSweeper(): void {
  if (sweeper) return
  sweeper = setInterval(sweepIdle, 30_000)
  if (sweeper.unref) sweeper.unref()
}

export function stopIdleSweeper(): void {
  if (sweeper) {
    clearInterval(sweeper)
    sweeper = null
  }
}

/** Test/diagnostic — exposed for integration use only. */
export function __resetForTests(): void {
  state.clear()
  history.length = 0
  version = 0
  idleThresholdMs = 5 * 60 * 1000
  snapshotListeners.clear()
  newEventListeners.clear()
  escalationListeners.clear()
}
