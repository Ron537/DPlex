import type { InstallMode, UpdateState, UpdateStatus } from '../../preload/updateTypes'

/**
 * Pure reducer for the auto-update state machine.
 *
 * Kept side-effect free so it can be unit-tested without spinning up
 * Electron or `electron-updater`. The owning service layer
 * (`autoUpdater.ts`) translates updater events into the action shapes
 * defined here and re-derives capability flags after every transition.
 *
 * Capability fields are recomputed deterministically from `status` +
 * `installMode` so the renderer never has to encode platform rules of
 * its own — it just renders whichever buttons are flagged available.
 */

export type UpdateAction =
  | { type: 'check-started' }
  | { type: 'check-finished-no-update' }
  | { type: 'available'; version: string; releaseUrl?: string }
  | { type: 'download-progress'; percent: number; version?: string }
  | { type: 'downloaded'; version: string }
  | { type: 'install-started' }
  | { type: 'error'; message: string }

export interface ReducerOptions {
  installMode: InstallMode
  /** Optional clock so tests can pin `lastChecked` deterministically. */
  now?: () => number
}

export function initialState(installMode: InstallMode): UpdateState {
  return withCapabilities({
    status: installMode === 'unsupported' ? 'unsupported' : 'idle',
    installMode,
    canCheck: false,
    canInstall: false,
    canOpenDownload: false
  })
}

export function reduce(
  state: UpdateState,
  action: UpdateAction,
  opts: ReducerOptions
): UpdateState {
  const now = opts.now ?? Date.now
  // Unsupported builds (dev, .deb when we treat it as "use your package
  // manager", etc.) ignore every transition — the user just sees the
  // "unsupported" badge.
  if (state.installMode === 'unsupported' && action.type !== 'error') {
    return state
  }

  switch (action.type) {
    case 'check-started':
      // Don't regress from a useful terminal state into "checking" —
      // periodic re-checks shouldn't blow away a downloaded update.
      if (
        state.status === 'downloading' ||
        state.status === 'downloaded' ||
        state.status === 'installing'
      ) {
        return state
      }
      return withCapabilities({
        ...state,
        status: 'checking',
        error: undefined
      })

    case 'check-finished-no-update':
      // Same guard — a terminal state must be sticky.
      if (
        state.status === 'downloading' ||
        state.status === 'downloaded' ||
        state.status === 'installing'
      ) {
        return state
      }
      return withCapabilities({
        ...state,
        status: 'up-to-date',
        version: undefined,
        downloadProgress: undefined,
        error: undefined,
        lastChecked: now()
      })

    case 'available': {
      // Forward-only: don't let a late `update-available` (which
      // electron-updater may resend as the next periodic check rolls
      // around) regress a download already in flight or a downloaded
      // bundle waiting on `quitAndInstall`. Bumping the offered
      // version is fine — that's a real new release — but the same
      // version arriving again must be a no-op.
      if (state.installMode === 'autoInstall') {
        if (state.status === 'installing') return state
        if (
          (state.status === 'downloading' || state.status === 'downloaded') &&
          state.version === action.version
        ) {
          return state
        }
      }
      // For autoInstall platforms, electron-updater immediately moves
      // into download; we'll render `available` for the brief gap until
      // the first progress event. For manualDownload (macOS, .deb) we
      // sit on `available` and surface a download URL.
      const next: UpdateState = {
        ...state,
        status: 'available',
        version: action.version,
        downloadProgress: undefined,
        error: undefined,
        lastChecked: now(),
        releaseUrl: action.releaseUrl ?? state.releaseUrl
      }
      return withCapabilities(next)
    }

    case 'download-progress':
      // Already downloaded or about to install? A late progress event
      // must not undo that.
      if (state.status === 'downloaded' || state.status === 'installing') {
        return state
      }
      return withCapabilities({
        ...state,
        status: 'downloading',
        version: action.version ?? state.version,
        downloadProgress: clampPercent(action.percent),
        error: undefined
      })

    case 'downloaded':
      // Already restarting → don't pull the rug out from the
      // installing flow.
      if (state.status === 'installing') return state
      return withCapabilities({
        ...state,
        status: 'downloaded',
        version: action.version,
        downloadProgress: 100,
        error: undefined,
        lastChecked: now()
      })

    case 'install-started':
      // Defensive: only valid from `downloaded` and only when the
      // platform allows auto-install.
      if (state.status !== 'downloaded' || state.installMode !== 'autoInstall') {
        return state
      }
      return withCapabilities({
        ...state,
        status: 'installing',
        error: undefined
      })

    case 'error':
      // An error doesn't undo a downloaded update — keep the file on
      // disk so a retry/restart still works.
      if (state.status === 'downloaded' || state.status === 'installing') {
        return withCapabilities({ ...state, error: action.message })
      }
      return withCapabilities({
        ...state,
        status: 'error',
        downloadProgress: undefined,
        error: action.message,
        lastChecked: now()
      })
  }
}

function withCapabilities(state: UpdateState): UpdateState {
  const isUnsupported = state.installMode === 'unsupported'
  const inflight = state.status === 'checking' || state.status === 'downloading'

  return {
    ...state,
    canCheck: !isUnsupported && !inflight && state.status !== 'installing',
    canInstall:
      !isUnsupported &&
      state.installMode === 'autoInstall' &&
      state.status === 'downloaded',
    canOpenDownload:
      !isUnsupported &&
      state.installMode === 'manualDownload' &&
      (state.status === 'available' || state.status === 'downloaded')
  }
}

function clampPercent(p: number): number {
  if (!Number.isFinite(p)) return 0
  if (p < 0) return 0
  if (p > 100) return 100
  return Math.round(p)
}

/**
 * True iff a periodic check should be skipped because the state is
 * either already in flight or terminal-pending. Used by the periodic
 * timer to avoid noisy regressions.
 */
export function shouldSkipPeriodicCheck(status: UpdateStatus): boolean {
  return (
    status === 'checking' ||
    status === 'downloading' ||
    status === 'downloaded' ||
    status === 'installing' ||
    status === 'unsupported'
  )
}
