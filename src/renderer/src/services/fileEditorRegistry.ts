/**
 * Imperative registry for editable file editors.
 *
 * Monaco editor instances are non-serializable and bound to a live DOM node,
 * so their `save` / `reload` actions can't live in a Zustand store. Each
 * `MonacoEditorPane` registers a handle keyed by its tab id on mount and
 * unregisters on unmount. The global Cmd/Ctrl+S handler resolves the *active*
 * fileEditor tab from the terminal store and invokes that tab's handle only —
 * never every mounted editor.
 *
 * Registration is token-guarded: a stale unmount can't clobber a newer mount
 * for the same tab id (can happen under React Strict Mode double-invoke).
 */

import { stashParkedEditorBuffer, type ParkedEditorBuffer } from './parkedEditorBuffers'

export interface FileEditorHandle {
  /** Persist the current buffer to disk. Resolves when the write settles. */
  save: () => Promise<void>
  /** True when the buffer differs from the last saved content. */
  isDirty: () => boolean
  /** The current unsaved buffer to stash on park, or null when clean. */
  getDirtyBuffer: () => ParkedEditorBuffer | null
  /**
   * Flush a pending onChange auto-save to disk if one is due. No-op in manual
   * mode, when clean, or when a conflict/external change is unresolved. Called
   * at park time so an edit made inside the debounce window isn't lost if the
   * app quits before the editor remounts and re-arms its timer on resume.
   */
  flushIfAutoSave: () => void
}

interface Registration {
  token: number
  handle: FileEditorHandle
}

const registry = new Map<string, Registration>()
let nextToken = 1

/** Register an editor handle for a tab. Returns an unregister fn. */
export function registerFileEditor(tabId: string, handle: FileEditorHandle): () => void {
  const token = nextToken++
  registry.set(tabId, { token, handle })
  return () => {
    const cur = registry.get(tabId)
    if (cur && cur.token === token) registry.delete(tabId)
  }
}

/** Look up the handle for a tab, or null when none is mounted. */
export function getFileEditorHandle(tabId: string): FileEditorHandle | null {
  return registry.get(tabId)?.handle ?? null
}

/** Whether a mounted editor for this tab currently has unsaved changes. False
 *  when no editor is mounted for the tab (e.g. it lives in a background space,
 *  whose unsaved edits live in a stashed buffer instead). */
export function isFileEditorDirty(tabId: string): boolean {
  return registry.get(tabId)?.handle.isDirty() ?? false
}

/**
 * Stash every mounted editor's unsaved buffer before a Space is parked.
 *
 * Only the active Space's editors are mounted, so this captures exactly the
 * outgoing Space's dirty editors. Each stash is consumed when the editor
 * remounts (see parkedEditorBuffers). Call this immediately before the terminal
 * store swaps the active workspace out.
 */
export function stashAllDirtyFileEditors(): void {
  for (const tabId of registry.keys()) stashDirtyFileEditor(tabId)
}

/**
 * Stash a single mounted editor's unsaved buffer + flush its pending auto-save.
 *
 * Used both by {@link stashAllDirtyFileEditors} (park) and when a single tab is
 * MOVED to another Space: the editor unmounts here and remounts there, consuming
 * the stash. (Contrast closeTerminal, which CLEARS the stash because a closed tab
 * never remounts.) No-op when no editor is mounted for the tab.
 */
export function stashDirtyFileEditor(tabId: string): void {
  const reg = registry.get(tabId)
  if (!reg) return
  const buffer = reg.handle.getDirtyBuffer()
  if (buffer) stashParkedEditorBuffer(tabId, buffer)
  // onChange editors also flush their pending debounced save to disk here, so an
  // edit within the debounce window survives a quit-while-parked. The stash above
  // remains the in-session restore + conflict-detection baseline; the resume path
  // reconciles the two (adopts disk when identical).
  reg.handle.flushIfAutoSave()
}
