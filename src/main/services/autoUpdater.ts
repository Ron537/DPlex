import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

/**
 * Wires automatic-update checks for packaged builds.
 *
 * electron-updater reads its feed location from `publish:` in
 * `electron-builder.yml` at build time. For DPlex that's GitHub Releases
 * — a signed release tagged `v*` appears in the users' app within a few
 * hours of publishing.
 *
 * Skipped entirely in development and unpackaged builds: there's no
 * meaningful update feed and the updater logs noisy errors otherwise.
 *
 * This is a minimal hook: it logs progress, surfaces failures quietly,
 * and installs downloaded updates on next quit. It does not yet display
 * an in-app banner or let the user defer an update — those are UI
 * additions that can come later.
 */
export function initAutoUpdater(getMainWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // Allow prerelease channels only if the current version is itself a
  // prerelease (semver tag contains a hyphen) — keeps stable users on
  // stable builds while letting early testers on `v0.2.0-beta.1` track
  // the beta track.
  autoUpdater.allowPrerelease = /-/.test(app.getVersion())

  autoUpdater.on('error', (err) => {
    // Never throw into the main event loop — a missing feed or offline
    // user must not crash the app. Log for debugging only.
    console.warn('[auto-update] error:', err?.message ?? err)
  })

  autoUpdater.on('update-available', (info) => {
    console.log('[auto-update] update available:', info.version)
  })

  autoUpdater.on('update-not-available', () => {
    console.log('[auto-update] already up to date')
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[auto-update] update downloaded:', info.version)
    // Let the renderer surface a toast/banner when we add one. The update
    // installs automatically on next quit, so no forced restart.
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('app:updateDownloaded', { version: info.version })
    }
  })

  // Fire-and-forget check. electron-updater debounces internally and
  // handles retries, so we don't schedule our own polling.
  autoUpdater.checkForUpdates().catch((err) => {
    console.warn('[auto-update] initial check failed:', err?.message ?? err)
  })
}
