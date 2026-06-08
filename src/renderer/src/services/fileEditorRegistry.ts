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

export interface FileEditorHandle {
  /** Persist the current buffer to disk. Resolves when the write settles. */
  save: () => Promise<void>
  /** True when the buffer differs from the last saved content. */
  isDirty: () => boolean
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
