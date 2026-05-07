import { app, BrowserWindow, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log/main'
import type { InstallMode, UpdateState } from '../../preload/updateTypes'
import {
  initialState,
  reduce,
  shouldSkipPeriodicCheck,
  type UpdateAction
} from './updateState'

const RELEASE_URL_BASE = 'https://github.com/Ron537/DPlex/releases'
const PERIODIC_CHECK_MS = 6 * 60 * 60 * 1000

/**
 * Coordinates auto-update for packaged builds.
 *
 * Per-platform behaviour:
 *
 * - **Windows + Linux AppImage** (`autoInstall`): silent background
 *   download, banner offered when ready, "Restart and install" applies
 *   the update via Squirrel.
 * - **macOS** (`manualDownload`): notification only. We can't apply an
 *   update in place because Squirrel.Mac validates that the running
 *   bundle's code-signature certificate matches the replacement and
 *   ad-hoc signed builds use ephemeral identifiers, so the swap is
 *   rejected. The banner offers a "Download" button that opens the
 *   GitHub releases page; the user replaces the .app manually. Once we
 *   have Developer ID signing + notarization, this branch goes away.
 * - **Linux non-AppImage** (`manualDownload`): same as macOS. We don't
 *   want to drive `dpkg`/`apt` from the app — the user knows their
 *   package manager and can grab the new `.deb` from the release page.
 * - **Unpackaged** (`unsupported`): no-op everywhere.
 *
 * The renderer never sees the underlying `electron-updater` instance —
 * only `UpdateState` snapshots over IPC and a small command surface
 * (`check`, `install`, `openDownload`).
 */

let getMainWindow: (() => BrowserWindow | null) | null = null
let state: UpdateState = initialState('unsupported')
let periodicTimer: NodeJS.Timeout | null = null
let started = false

export function initAutoUpdater(getMainWindowFn: () => BrowserWindow | null): void {
  if (started) return
  started = true
  getMainWindow = getMainWindowFn
  state = initialState(resolveInstallMode())

  if (!app.isPackaged || state.installMode === 'unsupported') {
    return
  }

  // Pipe electron-updater's verbose logging into a rotating file so
  // failures the user reports can be diagnosed after the fact.
  log.transports.file.level = 'info'
  autoUpdater.logger = log

  autoUpdater.autoDownload = state.installMode === 'autoInstall'
  autoUpdater.autoInstallOnAppQuit = state.installMode === 'autoInstall'
  // Allow prerelease channels only if the current version is itself a
  // prerelease (semver tag contains a hyphen) — keeps stable users on
  // stable builds while letting early testers on `v0.x.0-beta.1` track
  // the beta track.
  autoUpdater.allowPrerelease = /-/.test(app.getVersion())

  autoUpdater.on('error', (err) => {
    log.warn('[auto-update] error:', err)
    dispatch({
      type: 'error',
      message: shortenError(err)
    })
  })

  autoUpdater.on('checking-for-update', () => {
    dispatch({ type: 'check-started' })
  })

  autoUpdater.on('update-not-available', () => {
    dispatch({ type: 'check-finished-no-update' })
  })

  autoUpdater.on('update-available', (info) => {
    dispatch({
      type: 'available',
      version: info.version,
      releaseUrl: `${RELEASE_URL_BASE}/tag/v${info.version}`
    })
  })

  autoUpdater.on('download-progress', (info) => {
    dispatch({
      type: 'download-progress',
      percent: info.percent,
      version: state.version
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    dispatch({ type: 'downloaded', version: info.version })
  })

  // Initial check + recurring poll. `electron-updater` debounces
  // overlapping requests internally; we still skip when state is in a
  // terminal-pending status to avoid noisy regressions.
  void runCheck('startup')
  periodicTimer = setInterval(() => {
    if (shouldSkipPeriodicCheck(state.status)) return
    void runCheck('periodic')
  }, PERIODIC_CHECK_MS)
}

export function shutdownAutoUpdater(): void {
  if (periodicTimer) {
    clearInterval(periodicTimer)
    periodicTimer = null
  }
  started = false
}

export function getUpdateState(): UpdateState {
  return state
}

export async function checkForUpdates(): Promise<UpdateState> {
  if (!state.canCheck) return state
  await runCheck('manual')
  return state
}

export function installUpdate(): UpdateState {
  if (!state.canInstall) return state
  dispatch({ type: 'install-started' })
  // `quitAndInstall` synchronously fires `before-quit` and then exits.
  // Wrap in setImmediate so the renderer round-trips the state update
  // (showing the disabled "Restarting…" button) before the process
  // tears down.
  setImmediate(() => {
    try {
      autoUpdater.quitAndInstall(false, true)
    } catch (err) {
      log.error('[auto-update] quitAndInstall failed:', err)
      dispatch({ type: 'error', message: shortenError(err) })
    }
  })
  return state
}

export function openUpdateDownload(): void {
  if (!state.canOpenDownload) return
  const url = state.releaseUrl ?? `${RELEASE_URL_BASE}/latest`
  void shell.openExternal(url)
}

function dispatch(action: UpdateAction): void {
  const next = reduce(state, action, { installMode: state.installMode })
  if (next === state) return
  state = next
  const win = getMainWindow?.()
  if (win && !win.isDestroyed()) {
    win.webContents.send('app:updateStateChanged', state)
  }
}

async function runCheck(reason: 'startup' | 'periodic' | 'manual'): Promise<void> {
  try {
    log.info(`[auto-update] check (${reason})`)
    await autoUpdater.checkForUpdates()
  } catch (err) {
    log.warn(`[auto-update] check (${reason}) failed:`, err)
    dispatch({ type: 'error', message: shortenError(err) })
  }
}

function resolveInstallMode(): InstallMode {
  if (!app.isPackaged) return 'unsupported'
  if (process.platform === 'darwin') return 'manualDownload'
  if (process.platform === 'win32') return 'autoInstall'
  if (process.platform === 'linux') {
    // electron-builder sets APPIMAGE to the .AppImage path when running
    // from one. Anything else (.deb, .rpm, source build) gets the
    // manual path so we don't try to invoke a privileged package
    // manager from inside the app.
    return process.env.APPIMAGE ? 'autoInstall' : 'manualDownload'
  }
  return 'unsupported'
}

function shortenError(err: unknown): string {
  if (err instanceof Error) {
    // First line is usually the most useful summary (`HttpError:
    // 404 not found`, `net::ERR_INTERNET_DISCONNECTED`, etc.).
    return err.message.split('\n')[0].slice(0, 160)
  }
  return String(err).slice(0, 160)
}
