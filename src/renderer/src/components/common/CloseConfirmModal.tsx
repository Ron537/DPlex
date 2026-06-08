import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'
import { useCloseConfirmStore } from '../../stores/closeConfirmStore'
import { useEscapeKey } from '../../hooks/useEscapeKey'

/**
 * Save / Don't Save / Cancel prompt shown when closing a file editor tab with
 * unsaved changes. Driven by `closeConfirmStore`; mounted once at the app root.
 */
export function CloseConfirmModal(): React.JSX.Element | null {
  const pendingTabId = useCloseConfirmStore((s) => s.pendingTabId)
  const pendingTitle = useCloseConfirmStore((s) => s.pendingTitle)
  const cancel = useCloseConfirmStore((s) => s.cancel)
  const saveAndClose = useCloseConfirmStore((s) => s.saveAndClose)
  const closeWithoutSaving = useCloseConfirmStore((s) => s.closeWithoutSaving)

  useEscapeKey(cancel, pendingTabId !== null)

  if (!pendingTabId) return null

  return createPortal(
    <div className="fixed inset-0 z-[2500] flex items-center justify-center">
      <div
        className="absolute inset-0"
        style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        onClick={cancel}
      />
      <div
        className="relative rounded-lg shadow-2xl p-5 w-[380px]"
        style={{
          backgroundColor: 'var(--dplex-bg-panel)',
          border: '1px solid var(--dplex-border)'
        }}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle
            size={20}
            style={{ color: 'var(--dplex-status-warning, #fbbf24)' }}
            className="flex-shrink-0 mt-0.5"
          />
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold" style={{ color: 'var(--dplex-text)' }}>
              Save changes to “{pendingTitle}”?
            </h3>
            <p className="mt-1 text-[12px]" style={{ color: 'var(--dplex-text-muted)' }}>
              Your changes will be lost if you don’t save them.
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="px-3 py-1.5 text-[12px] rounded hover:bg-[var(--dplex-hover)]"
            style={{ color: 'var(--dplex-text)', border: '1px solid var(--dplex-border)' }}
            onClick={cancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="px-3 py-1.5 text-[12px] rounded hover:bg-[var(--dplex-hover)]"
            style={{ color: 'var(--dplex-text-muted)', border: '1px solid var(--dplex-border)' }}
            onClick={closeWithoutSaving}
          >
            Don’t Save
          </button>
          <button
            type="button"
            className="px-3 py-1.5 text-[12px] rounded text-white"
            style={{ backgroundColor: 'var(--dplex-accent, #2563eb)' }}
            onClick={() => void saveAndClose()}
            data-testid="close-confirm-save"
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
