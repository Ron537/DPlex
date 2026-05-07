/**
 * Auto-update state shared between main, preload, and renderer.
 *
 * This file lives under `src/preload/` (rather than a renderer-only types
 * directory) so the main process can import it without the renderer
 * tsconfig having to reach into renderer-private paths. The existing
 * `attentionTypes.ts` follows the same pattern.
 *
 * The main process owns the state machine and pushes the latest
 * `UpdateState` to the renderer over IPC; both sides import this module
 * so the contract stays in one place.
 */

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'
  | 'unsupported'

export type InstallMode = 'autoInstall' | 'manualDownload' | 'unsupported'

export interface UpdateState {
  status: UpdateStatus
  /** Newer version offered by the feed (if any). */
  version?: string
  /** Download progress 0-100 while status === 'downloading'. */
  downloadProgress?: number
  /** Short user-facing error message (full detail goes to electron-log). */
  error?: string
  /** Epoch ms of the last completed check (success or failure). */
  lastChecked?: number
  /** GitHub release URL for `manualDownload` flows. Always set in main. */
  releaseUrl?: string
  /** How an update will land on this platform/package format. */
  installMode: InstallMode
  /** Whether the user can trigger a manual check right now. */
  canCheck: boolean
  /** Whether "Restart and install" is meaningful right now. */
  canInstall: boolean
  /** Whether "Open download page" is meaningful right now. */
  canOpenDownload: boolean
}
