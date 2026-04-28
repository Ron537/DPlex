import { create } from 'zustand'
import type { ChangedFile, ChangeListResult } from '../../../preload'
import type { DiffScopePersisted } from '../types'

/**
 * Per-tab state for an open diff view.
 *
 * Keyed by `tabId` — multiple diff tabs (different repos / scopes) can be
 * open simultaneously. The store does not own watcher tokens; subscriptions
 * are managed inside `DiffTabView` and torn down when the component unmounts.
 */
export interface DiffTabState {
  tabId: string
  repoRootFs: string
  scope: DiffScopePersisted
  files: ChangedFile[]
  truncated: boolean
  totalCount: number
  selectedPath?: string
  /** True while a `listChanges` request is in flight. */
  loading: boolean
  /** Last error string if the most recent refresh failed. */
  error?: string
  /** ms timestamp of last successful refresh. */
  lastLoadedAt?: number
  /** UI: side-by-side (true) vs inline (false). */
  sideBySide: boolean
}

interface DiffStore {
  tabs: Map<string, DiffTabState>
  initTab: (
    tabId: string,
    repoRootFs: string,
    scope: DiffScopePersisted,
    sideBySide?: boolean,
    selectedPath?: string
  ) => void
  updateTab: (tabId: string, patch: Partial<DiffTabState>) => void
  removeTab: (tabId: string) => void
  setChanges: (tabId: string, result: ChangeListResult) => void
  setLoading: (tabId: string, loading: boolean) => void
  setError: (tabId: string, error: string | undefined) => void
  setSelectedPath: (tabId: string, path: string | undefined) => void
  setSideBySide: (tabId: string, sideBySide: boolean) => void
  setScope: (tabId: string, scope: DiffScopePersisted) => void
  getTab: (tabId: string) => DiffTabState | undefined
}

export const useDiffStore = create<DiffStore>((set, get) => ({
  tabs: new Map(),

  initTab: (tabId, repoRootFs, scope, sideBySide = true, selectedPath) => {
    set((state) => {
      if (state.tabs.has(tabId)) return state
      const next = new Map(state.tabs)
      next.set(tabId, {
        tabId,
        repoRootFs,
        scope,
        files: [],
        truncated: false,
        totalCount: 0,
        selectedPath,
        loading: false,
        sideBySide
      })
      return { tabs: next }
    })
  },

  updateTab: (tabId, patch) => {
    set((state) => {
      const existing = state.tabs.get(tabId)
      if (!existing) return state
      const next = new Map(state.tabs)
      next.set(tabId, { ...existing, ...patch })
      return { tabs: next }
    })
  },

  removeTab: (tabId) => {
    set((state) => {
      if (!state.tabs.has(tabId)) return state
      const next = new Map(state.tabs)
      next.delete(tabId)
      return { tabs: next }
    })
  },

  setChanges: (tabId, result) => {
    set((state) => {
      const existing = state.tabs.get(tabId)
      if (!existing) return state
      const stillExists =
        existing.selectedPath !== undefined &&
        result.files.some((f) => f.gitPath === existing.selectedPath)
      const selectedPath = stillExists ? existing.selectedPath : result.files[0]?.gitPath
      const next = new Map(state.tabs)
      next.set(tabId, {
        ...existing,
        files: result.files,
        truncated: result.truncated,
        totalCount: result.totalCount,
        selectedPath,
        loading: false,
        error: undefined,
        lastLoadedAt: Date.now()
      })
      return { tabs: next }
    })
  },

  setLoading: (tabId, loading) => {
    get().updateTab(tabId, { loading })
  },

  setError: (tabId, error) => {
    get().updateTab(tabId, { error, loading: false })
  },

  setSelectedPath: (tabId, path) => {
    get().updateTab(tabId, { selectedPath: path })
  },

  setSideBySide: (tabId, sideBySide) => {
    get().updateTab(tabId, { sideBySide })
  },

  setScope: (tabId, scope) => {
    get().updateTab(tabId, { scope, files: [], selectedPath: undefined })
  },

  getTab: (tabId) => get().tabs.get(tabId)
}))
