import type { SettingsTab } from '../services/search/types'

/** Detail payload for the `dplex:open-settings` window event.
 *  - `section` switches the Settings modal to a specific tab.
 *  - `highlightId` scrolls the matching `[data-setting-id]` row into view
 *    and pulse-highlights it.
 *  Both fields are optional; an empty payload simply opens the modal. */
export interface OpenSettingsDetail {
  section?: SettingsTab
  highlightId?: string
}

/** Dispatch the `dplex:open-settings` window event. Centralizes the event
 *  name + payload shape so callers (App keybindings, search registry,
 *  command palette commands) don't drift on the contract. */
export function dispatchOpenSettings(detail?: OpenSettingsDetail): void {
  window.dispatchEvent(new CustomEvent('dplex:open-settings', { detail }))
}
