import { create } from 'zustand'
import { useTerminalStore } from './terminalStore'
import { isFileEditorTab } from '../types'
import { getFileEditorHandle } from '../services/fileEditorRegistry'

interface CloseConfirmState {
  /** Tab pending a dirty-close confirmation, or null. */
  pendingTabId: string | null
  pendingTitle: string
  /**
   * Request to close a tab. Dirty `fileEditor` tabs open a Save / Don't Save /
   * Cancel prompt; everything else closes immediately. This is the single
   * choke point for tab closes so unsaved edits can't be silently dropped.
   */
  request: (tabId: string) => void
  cancel: () => void
  saveAndClose: () => Promise<void>
  closeWithoutSaving: () => void
}

function findTab(tabId: string): { title: string; dirty: boolean } | null {
  for (const g of useTerminalStore.getState().groups) {
    for (const t of g.tabs) {
      if (t.id !== tabId) continue
      if (isFileEditorTab(t)) {
        const handle = getFileEditorHandle(tabId)
        const dirty = handle ? handle.isDirty() : t.dirty === true
        return { title: t.title, dirty }
      }
      return { title: t.title, dirty: false }
    }
  }
  return null
}

export const useCloseConfirmStore = create<CloseConfirmState>((set, get) => ({
  pendingTabId: null,
  pendingTitle: '',

  request: (tabId) => {
    const info = findTab(tabId)
    if (info && info.dirty) {
      set({ pendingTabId: tabId, pendingTitle: info.title })
      return
    }
    useTerminalStore.getState().closeTerminal(tabId)
  },

  cancel: () => set({ pendingTabId: null, pendingTitle: '' }),

  saveAndClose: async () => {
    const tabId = get().pendingTabId
    if (!tabId) return
    const handle = getFileEditorHandle(tabId)
    if (handle) {
      try {
        await handle.save()
      } catch {
        /* keep the tab open if the save throws */
        return
      }
      // Bail if the save left the buffer dirty (e.g. a conflict was raised).
      if (handle.isDirty()) {
        set({ pendingTabId: null, pendingTitle: '' })
        return
      }
    }
    set({ pendingTabId: null, pendingTitle: '' })
    useTerminalStore.getState().closeTerminal(tabId)
  },

  closeWithoutSaving: () => {
    const tabId = get().pendingTabId
    set({ pendingTabId: null, pendingTitle: '' })
    if (tabId) useTerminalStore.getState().closeTerminal(tabId)
  }
}))

/** Convenience wrapper for call sites that just want to close a tab safely. */
export function requestCloseTab(tabId: string): void {
  useCloseConfirmStore.getState().request(tabId)
}
