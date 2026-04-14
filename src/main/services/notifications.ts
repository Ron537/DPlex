import { Notification } from 'electron'
import type { DiscoveredSession } from './providers/types'

/**
 * Desktop notification service for AI session status changes.
 * Notifies when an agent finishes responding (transitions to idle from a working state).
 */

const COOLDOWN_MS = 30_000
const lastNotificationTime = new Map<string, number>()
const previousStatus = new Map<string, string>()

let enabled = true

export function setNotificationsEnabled(value: boolean): void {
  enabled = value
}

export function isNotificationsEnabled(): boolean {
  return enabled
}

/** Clear cached notification state for a session (e.g., on delete). */
export function clearNotificationState(sessionId: string): void {
  previousStatus.delete(sessionId)
  lastNotificationTime.delete(sessionId)
}

/** Seed notification state for a session without triggering a notification.
 *  Call this for sessions discovered on startup or newly added. */
export function seedNotificationState(session: DiscoveredSession): void {
  const status = session.detailedStatus ?? 'idle'
  previousStatus.set(session.id, status)
}

export function handleSessionNotification(session: DiscoveredSession): void {
  if (!enabled) return
  if (!Notification.isSupported()) return

  const status = session.detailedStatus ?? 'idle'
  const prevStatus = previousStatus.get(session.id)
  previousStatus.set(session.id, status)

  // Only notify on transition to idle from a working state
  if (status !== 'idle' || !prevStatus || prevStatus === 'idle') return

  // Cooldown check
  const now = Date.now()
  const lastTime = lastNotificationTime.get(session.id) ?? 0
  if (now - lastTime < COOLDOWN_MS) return

  lastNotificationTime.set(session.id, now)

  const body = session.displayName
    ? `"${session.displayName}" has finished responding`
    : 'Session has finished responding'

  const notification = new Notification({
    title: 'DPlex: Agent Finished',
    body,
    silent: false
  })

  notification.show()
}
