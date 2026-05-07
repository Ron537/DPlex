import { useMemo, type JSX } from 'react'
import { Download, RefreshCcw, X } from 'lucide-react'
import { useUpdateStore } from '../../stores/updateStore'
import { useSettingsStore } from '../../stores/settingsStore'

/**
 * Slim toast surfaced at the bottom-right when an update is ready for
 * the user's attention.
 *
 * Two flavors driven by the main process's `installMode`:
 *
 * - `autoInstall` (Windows / Linux AppImage) — appears on `downloaded`
 *   with a "Restart and install" primary action.
 * - `manualDownload` (macOS / .deb) — appears on `available` with an
 *   "Open download page" primary action and a secondary "Skip this
 *   version" so the user isn't nagged on every launch.
 *
 * The banner respects two suppression mechanisms:
 *  - per-launch dismiss (auto-install case): clicking "Later" hides it
 *    until the next time the app starts.
 *  - persisted skip-version (manual case): the version string is
 *    written into `settings.skippedUpdateVersion` and the banner stays
 *    hidden until a newer version appears.
 */
export function UpdateBanner(): JSX.Element | null {
  const state = useUpdateStore((s) => s.state)
  const dismissed = useUpdateStore((s) => s.dismissed)
  const dismiss = useUpdateStore((s) => s.dismiss)
  const install = useUpdateStore((s) => s.install)
  const openDownload = useUpdateStore((s) => s.openDownload)
  const skippedVersion = useSettingsStore((s) => s.settings.skippedUpdateVersion)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  const visible = useMemo(() => {
    if (!state || !state.version) return false
    if (state.installMode === 'autoInstall') {
      return state.status === 'downloaded' && !dismissed
    }
    if (state.installMode === 'manualDownload') {
      if (state.status !== 'available' && state.status !== 'downloaded') return false
      if (skippedVersion === state.version) return false
      return !dismissed
    }
    return false
  }, [state, dismissed, skippedVersion])

  if (!state || !visible) return null

  const isAuto = state.installMode === 'autoInstall'
  const handlePrimary = (): void => {
    void (isAuto ? install() : openDownload())
  }
  const handleSkip = (): void => {
    if (state.version) {
      void updateSettings({ skippedUpdateVersion: state.version })
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed z-50 rounded-lg shadow-2xl flex flex-col gap-2"
      style={{
        right: 16,
        bottom: 16,
        width: 320,
        padding: '12px 14px',
        background: 'var(--dplex-bg-elev)',
        border: '1px solid var(--dplex-border-strong)',
        color: 'var(--dplex-text)',
        boxShadow:
          '0 18px 40px rgba(0,0,0,0.55), 0 0 0 1px var(--dplex-accent-ring)'
      }}
    >
      <div className="flex items-start gap-2">
        <div
          aria-hidden="true"
          className="flex items-center justify-center rounded-full flex-shrink-0"
          style={{
            width: 28,
            height: 28,
            background: 'var(--dplex-accent-soft)',
            color: 'var(--dplex-accent)'
          }}
        >
          {isAuto ? <RefreshCcw size={14} /> : <Download size={14} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold">
            DPlex v{state.version} {isAuto ? 'is ready to install' : 'is available'}
          </div>
          <div
            className="text-[11px] mt-0.5"
            style={{ color: 'var(--dplex-text-muted)' }}
          >
            {isAuto
              ? 'Restart now to apply the update, or close the app any time later.'
              : 'Download the new build from the GitHub release page and replace the current app.'}
          </div>
        </div>
        <button
          aria-label="Dismiss update banner"
          onClick={dismiss}
          className="flex-shrink-0 p-0.5 rounded hover:bg-[var(--dplex-hover)]"
          style={{ color: 'var(--dplex-text-muted)' }}
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex items-center gap-2 mt-1">
        <button
          onClick={handlePrimary}
          className="text-[11px] font-medium px-3 py-1 rounded"
          style={{
            background: 'var(--dplex-accent)',
            color: 'var(--dplex-bg)'
          }}
        >
          {isAuto ? 'Restart and install' : 'Open download page'}
        </button>
        {!isAuto && (
          <button
            onClick={handleSkip}
            className="text-[11px] px-2 py-1 rounded hover:bg-[var(--dplex-hover)]"
            style={{ color: 'var(--dplex-text-muted)' }}
          >
            Skip this version
          </button>
        )}
        <button
          onClick={dismiss}
          className="text-[11px] px-2 py-1 rounded hover:bg-[var(--dplex-hover)] ml-auto"
          style={{ color: 'var(--dplex-text-muted)' }}
        >
          Later
        </button>
      </div>
    </div>
  )
}
