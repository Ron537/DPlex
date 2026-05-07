import { create } from 'zustand'
import type { UpdateState } from '../../../preload/updateTypes'

/**
 * Renderer-side mirror of the main process's auto-update state.
 *
 * The store holds the most recent snapshot pushed via the
 * `app:updateStateChanged` IPC event, plus a transient `dismissed` flag
 * the banner uses for per-launch suppression. It also tracks the
 * `manualDownload` "skipped version" pulled from settings so we don't
 * nag macOS users every launch about a release they already declined.
 *
 * `init()` is idempotent and intended to be called once from `App.tsx`
 * — it primes the store with the current state and subscribes to
 * subsequent updates. The returned cleanup is wired into a `useEffect`.
 */

interface UpdateStoreState {
  state: UpdateState | null
  /** Per-launch dismissal of the auto-install banner ("Later"). */
  dismissed: boolean

  init: () => () => void
  check: () => Promise<void>
  install: () => Promise<void>
  openDownload: () => Promise<void>
  dismiss: () => void
}

const PLACEHOLDER: UpdateState = {
  status: 'idle',
  installMode: 'unsupported',
  canCheck: false,
  canInstall: false,
  canOpenDownload: false
}

export const useUpdateStore = create<UpdateStoreState>((set, get) => {
  let unsubscribe: (() => void) | null = null

  return {
    state: null,
    dismissed: false,

    init: () => {
      if (unsubscribe) return unsubscribe
      // Subscribe FIRST so any push that arrives while the initial
      // `getUpdateState()` round-trip is in flight isn't lost.
      const off = window.dplex.app.onUpdateStateChanged((next) => {
        // Reset the per-launch dismissal whenever a *newer* version
        // shows up — otherwise dismissing 0.10.1 would also dismiss
        // the future 0.10.2 banner.
        const current = get().state
        if (current?.version && next.version && current.version !== next.version) {
          set({ dismissed: false })
        }
        set({ state: next })
      })
      // Then prime the store with whatever the main process currently
      // has — but only if a push hasn't already populated us. Without
      // this guard, a slow IPC reply could clobber a newer pushed
      // state captured during the same render tick.
      void window.dplex.app
        .getUpdateState()
        .then((s) => {
          if (get().state == null) set({ state: s ?? PLACEHOLDER })
        })
        .catch(() => {
          if (get().state == null) set({ state: PLACEHOLDER })
        })
      unsubscribe = () => {
        off()
        unsubscribe = null
      }
      return unsubscribe
    },

    check: async () => {
      const next = await window.dplex.app.checkForUpdates()
      set({ state: next })
    },

    install: async () => {
      const next = await window.dplex.app.installUpdate()
      set({ state: next })
    },

    openDownload: async () => {
      const next = await window.dplex.app.openUpdateDownload()
      set({ state: next })
    },

    dismiss: () => set({ dismissed: true })
  }
})
