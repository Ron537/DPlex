import { BrowserWindow, Notification, nativeImage } from 'electron'
import type { NativeImage } from 'electron'
import type { AttentionEvent, AttentionKind } from '../../preload/attentionTypes'
import iconAsset from '../../../resources/icon.png?asset'

/**
 * Thin Electron-Notification renderer driven by attentionService events.
 * Handles per-kind settings, do-not-disturb window, only-when-unfocused gating,
 * sound, cooldown, and click-to-focus.
 *
 * State is kept module-local; applyNotificationSettings pushes in updates from
 * the settings pipeline.
 */

const lastNotificationTime = new Map<string, number>()

let cachedIcon: NativeImage | null = null
function getNotificationIcon(): NativeImage | undefined {
  if (!cachedIcon) {
    try {
      cachedIcon = nativeImage.createFromPath(iconAsset)
    } catch {
      return undefined
    }
  }
  return cachedIcon.isEmpty() ? undefined : cachedIcon
}

interface NotificationSettings {
  enabled: boolean
  notifyOnApproval: boolean
  notifyOnInput: boolean
  notifyOnFinished: boolean
  onlyWhenUnfocused: boolean
  sound: boolean
  dndFrom: string | null // "HH:MM"
  dndTo: string | null
  cooldownSeconds: number
}

let settings: NotificationSettings = {
  enabled: true,
  notifyOnApproval: true,
  notifyOnInput: true,
  notifyOnFinished: true,
  onlyWhenUnfocused: true,
  sound: false,
  dndFrom: null,
  dndTo: null,
  cooldownSeconds: 30
}

/**
 * Queue for pending focus intents when the notification fires but the
 * window has been destroyed. Replayed when a new window is ready.
 */
const pendingFocusIntents: string[] = []
let focusCallback: ((compositeId: string) => void) | null = null

/** Set by main on window creation so notifications can send focus intents. */
export function setFocusSessionCallback(cb: (compositeId: string) => void): void {
  focusCallback = cb
  // Replay any queued intents
  while (pendingFocusIntents.length > 0) {
    const id = pendingFocusIntents.shift()!
    try {
      cb(id)
    } catch {
      // swallow — renderer will handle again if window is still alive
    }
  }
}

/** Clear the callback (e.g., when the window is closed). Intents will queue. */
export function clearFocusSessionCallback(): void {
  focusCallback = null
}

export function applyNotificationSettings(patch: Partial<NotificationSettings>): void {
  settings = { ...settings, ...patch }
}

export function clearNotificationState(compositeIdOrSessionId: string): void {
  lastNotificationTime.delete(compositeIdOrSessionId)
  dismissNotificationFor(compositeIdOrSessionId)
}

function isKindEnabled(kind: AttentionKind): boolean {
  if (!settings.enabled) return false
  switch (kind) {
    case 'waitingForApproval':
      return settings.notifyOnApproval
    case 'waitingForInput':
      return settings.notifyOnInput
    case 'finished':
      return settings.notifyOnFinished
  }
}

function parseHHMM(s: string | null): number | null {
  if (!s) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return h * 60 + min
}

function isInDndWindow(): boolean {
  const from = parseHHMM(settings.dndFrom)
  const to = parseHHMM(settings.dndTo)
  if (from == null || to == null) return false
  const d = new Date()
  const nowMin = d.getHours() * 60 + d.getMinutes()
  if (from === to) return false
  if (from < to) return nowMin >= from && nowMin < to
  // Overnight window (e.g., 22:00 → 07:00)
  return nowMin >= from || nowMin < to
}

function anyWindowFocused(): boolean {
  return BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isFocused())
}

/**
 * Composite id of the session whose terminal tab is currently active in the
 * renderer. Used by the focus gate to decide whether the user is actively
 * watching THIS session (vs the app being focused but on a different tab).
 */
let activeCompositeId: string | null = null

/**
 * Live notifications indexed by compositeId. Used to auto-dismiss the OS
 * notification when the user focuses the corresponding session tab.
 */
const activeNotifications = new Map<string, Notification>()

function dismissNotificationFor(compositeId: string): void {
  const n = activeNotifications.get(compositeId)
  if (!n) return
  activeNotifications.delete(compositeId)
  try {
    n.close()
  } catch {
    // ignore — some platforms may throw if the notification is already gone
  }
}

export function setActiveCompositeId(id: string | null): void {
  activeCompositeId = id
  if (id) dismissNotificationFor(id)
}

function kindTitle(kind: AttentionKind, escalated: boolean): string {
  switch (kind) {
    case 'waitingForApproval':
      return escalated ? 'DPlex: Still waiting for approval' : 'DPlex: Approval requested'
    case 'waitingForInput':
      return escalated ? 'DPlex: Still waiting for input' : 'DPlex: Waiting for input'
    case 'finished':
      return 'DPlex: Agent finished'
  }
}

function kindBody(ev: AttentionEvent): string {
  const name = ev.displayName || ev.sessionId
  switch (ev.kind) {
    case 'waitingForApproval':
      return `"${name}" is asking you to approve an action`
    case 'waitingForInput':
      return `"${name}" is waiting for your input`
    case 'finished':
      return `"${name}" has finished responding`
  }
}

/**
 * Fire (or skip) a desktop notification for an attention event.
 * Called by main for:
 *   - new events from attentionService (via onNewAttentionEvent)
 *   - escalations (via onEscalation)
 */
export function handleAttentionEvent(ev: AttentionEvent): void {
  if (!Notification.isSupported()) return
  if (ev.seeded) return
  if (ev.suppressed && !ev.escalated) return
  if (!isKindEnabled(ev.kind)) return
  if (isInDndWindow()) return
  // Tab-aware focus gate: only suppress if the user is actually looking at
  // THIS session's tab (app focused AND the session's tab is the active one).
  if (
    settings.onlyWhenUnfocused &&
    anyWindowFocused() &&
    activeCompositeId === ev.compositeId
  ) {
    return
  }

  const now = Date.now()
  const lastTime = lastNotificationTime.get(ev.compositeId) ?? 0
  const cooldownMs = Math.max(0, settings.cooldownSeconds) * 1000
  if (cooldownMs > 0 && now - lastTime < cooldownMs) return
  lastNotificationTime.set(ev.compositeId, now)

  const notification = new Notification({
    title: kindTitle(ev.kind, ev.escalated),
    body: kindBody(ev),
    silent: !settings.sound,
    icon: getNotificationIcon()
  })

  // Replace any prior live notification for this session — only one at a time.
  dismissNotificationFor(ev.compositeId)
  activeNotifications.set(ev.compositeId, notification)
  notification.on('close', () => {
    if (activeNotifications.get(ev.compositeId) === notification) {
      activeNotifications.delete(ev.compositeId)
    }
  })

  notification.on('click', () => {
    // Surface the app first — user clicked an OS-level notification.
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
    if (focusCallback) {
      try {
        focusCallback(ev.compositeId)
      } catch {
        // ignore
      }
    } else {
      pendingFocusIntents.push(ev.compositeId)
    }
  })

  notification.show()
}
