import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useSpaceStore, spaceHasUnsavedEditors } from '../../stores/spaceStore'
import { useSpacesUiStore } from '../../stores/spacesUiStore'

/**
 * Confirmation for deleting a space. Deleting closes the space's AI sessions
 * and terminals (they don't leak in the background), so we always confirm.
 * Mounted once at the app root; driven by `spacesUiStore`.
 */
export function SpaceDeleteConfirm(): JSX.Element | null {
  const request = useSpacesUiStore((s) => s.deleteRequest)
  const cancel = useSpacesUiStore((s) => s.cancelDelete)

  useEscapeKey(cancel, !!request)

  if (!request) return null

  // A modal read is enough: the user can't edit while it's open, so the
  // unsaved-work state is effectively static for the dialog's lifetime.
  const hasUnsaved = spaceHasUnsavedEditors(request.id)

  const confirm = (): void => {
    useSpaceStore.getState().deleteSpace(request.id)
    cancel()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[2650] grid place-items-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel()
      }}
    >
      <div
        className="w-[400px] max-w-[92vw] dplex-pop"
        style={{
          padding: 20,
          borderRadius: 14,
          backgroundColor: 'var(--dplex-bg-elev)',
          border: '1px solid var(--dplex-border-strong)',
          boxShadow: '0 40px 90px -30px rgba(0,0,0,0.75)'
        }}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle
            size={20}
            style={{ color: 'var(--dplex-status-error)' }}
            className="flex-shrink-0 mt-0.5"
          />
          <div className="min-w-0">
            <h3 className="font-semibold" style={{ fontSize: 14, color: 'var(--dplex-text)' }}>
              Delete “{request.name}”?
            </h3>
            <p
              className="mt-1"
              style={{ fontSize: 12, color: 'var(--dplex-text-muted)', lineHeight: 1.5 }}
            >
              This closes the space&apos;s AI sessions and terminals and removes the space. Your
              projects and their files are untouched.
            </p>
            {hasUnsaved && (
              <p
                data-testid="space-delete-unsaved-warning"
                className="mt-2"
                style={{
                  fontSize: 12,
                  color: 'var(--dplex-status-error)',
                  lineHeight: 1.5,
                  fontWeight: 600
                }}
              >
                This space has unsaved editor changes that will be discarded. Save them first if you
                want to keep them.
              </p>
            )}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={cancel}
            className="transition-colors hover:bg-[var(--dplex-hover)]"
            style={{
              padding: '7px 13px',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--dplex-text)',
              border: '1px solid var(--dplex-border)'
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            data-testid="space-delete-confirm"
            style={{
              padding: '7px 13px',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              color: '#fff',
              backgroundColor: 'var(--dplex-status-error)'
            }}
          >
            Delete space
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
