/**
 * In-memory stash of unsaved (dirty) file-editor buffers, keyed by tab id.
 *
 * Switching or minimizing a Space unmounts its editor groups, and Monaco
 * disposes their text models. With the default `manual` auto-save setting those
 * edits are never written to disk, so a naive unmount would silently discard
 * them. The park flow stashes each dirty buffer here just before the workspace
 * swap, and the editor restores it on remount — so unsaved work survives
 * leaving and returning to a Space without forcing a disk write (which would
 * override the user's manual-save preference).
 *
 * Session-scoped and never persisted: unsaved manual edits are not expected to
 * survive an app restart, matching normal editor behaviour.
 */
export interface ParkedEditorBuffer {
  content: string
  eol: '\n' | '\r\n'
  /**
   * The last-saved baseline the unsaved edits were made against, captured at
   * park time. Restore reinstates this (rather than adopting the current disk
   * bytes) so a concurrent external write that landed while the Space was parked
   * is surfaced as a conflict on the next save instead of being silently
   * overwritten — matching how a mounted dirty editor behaves.
   */
  baseContent: string
  baseMtimeMs: number
}

const buffers = new Map<string, ParkedEditorBuffer>()

/** Stash a tab's unsaved buffer (one per dirty editor, just before its Space is
 *  parked). */
export function stashParkedEditorBuffer(tabId: string, buffer: ParkedEditorBuffer): void {
  buffers.set(tabId, buffer)
}

/** Retrieve *and remove* a tab's stashed buffer — consumed once on remount. */
export function takeParkedEditorBuffer(tabId: string): ParkedEditorBuffer | null {
  const buffer = buffers.get(tabId)
  if (buffer) buffers.delete(tabId)
  return buffer ?? null
}

/** Whether a tab currently has a stashed unsaved buffer (used to treat an
 *  unmounted parked editor as dirty for close-confirmation, without consuming
 *  the stash). */
export function hasParkedEditorBuffer(tabId: string): boolean {
  return buffers.has(tabId)
}

/** Drop a tab's stashed buffer without consuming it (the tab or its Space was
 *  closed/deleted before it was ever restored). */
export function clearParkedEditorBuffer(tabId: string): void {
  buffers.delete(tabId)
}
