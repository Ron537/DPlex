import { create } from 'zustand'
import type { DashboardMetrics } from '../../../preload'

interface DashboardState {
  /** Last historical snapshot from the aggregation IPC (null until first load). */
  metrics: DashboardMetrics | null
  loading: boolean
  error: string | null
  /** Rolling window for historical aggregation, in days. */
  windowDays: number
  /**
   * Set when a session add/remove invalidates the snapshot while the dashboard
   * is hidden. Refreshed on next show — events are never dropped based on
   * visibility (lesson from the git-graph autorefresh staleness bug).
   */
  dirty: boolean
  lastLoadedAt: number

  /** Idempotent: subscribe to session add/remove to mark the snapshot dirty. */
  init: () => void
  /** Fetch a fresh snapshot. No-ops a concurrent load. */
  refresh: () => Promise<void>
  /** Refresh only if never loaded or marked dirty. Call when the tab is shown. */
  ensureFresh: () => void
  setWindowDays: (days: number) => void
}

// Module-level subscription bookkeeping so `init` is safe to call from every
// dashboard mount without stacking duplicate IPC listeners.
let initialized = false
let invalidateTimer: ReturnType<typeof setTimeout> | null = null
// Monotonic counter bumped on every invalidation. `refresh` snapshots it at
// start and only clears `dirty` if it hasn't advanced since — so an
// invalidation that fires *during* an in-flight refresh is never overwritten
// (and thus never silently dropped, leaving a hidden dashboard stale).
let invalidationGeneration = 0

export const useDashboardStore = create<DashboardState>((set, get) => ({
  metrics: null,
  loading: false,
  error: null,
  windowDays: 30,
  dirty: true,
  lastLoadedAt: 0,

  init: () => {
    if (initialized) return
    initialized = true
    const markDirty = (): void => {
      invalidationGeneration += 1
      // Debounce bursts of add/remove events into a single dirty flip.
      if (invalidateTimer) clearTimeout(invalidateTimer)
      invalidateTimer = setTimeout(() => {
        set({ dirty: true })
      }, 400)
    }
    // Event-driven only — no polling. Added/removed sessions change the
    // historical aggregates; status-only updates do not, so we ignore them.
    window.dplex.sessions.onSessionAdded(markDirty)
    window.dplex.sessions.onSessionRemoved(markDirty)
  },

  refresh: async () => {
    if (get().loading) return
    const requestedWindow = get().windowDays
    const startGen = invalidationGeneration
    set({ loading: true, error: null })
    try {
      const metrics = await window.dplex.dashboard.getMetrics(requestedWindow)
      // The snapshot is stale if, while the IPC was in flight, the window
      // changed (user clicked another range) OR a session add/remove fired
      // (invalidationGeneration advanced). In either case keep `dirty` and
      // re-fetch so we never render under a wrong label or drop an update.
      const stale = get().windowDays !== requestedWindow || invalidationGeneration !== startGen
      if (stale) {
        // Don't commit a snapshot for a window the user is no longer viewing —
        // it would otherwise flash under the new window's labels. Keep the
        // prior snapshot, stay dirty, and refetch for the current window.
        set({ loading: false, dirty: true })
        void get().refresh()
      } else {
        set({ metrics, loading: false, dirty: false, lastLoadedAt: Date.now() })
      }
    } catch (err) {
      set({ error: String(err), loading: false })
    }
  },

  ensureFresh: () => {
    const { metrics, dirty, loading } = get()
    if (loading) return
    if (!metrics || dirty) void get().refresh()
  },

  setWindowDays: (days) => {
    const clamped = Math.max(1, Math.min(365, Math.floor(days)))
    if (clamped === get().windowDays) return
    set({ windowDays: clamped, dirty: true })
    void get().refresh()
  }
}))
