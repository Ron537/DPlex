import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink } from 'lucide-react'
import { useExternalResumeConfirmStore } from '../../stores/externalResumeConfirmStore'
import { useEscapeKey } from '../../hooks/useEscapeKey'

/**
 * Confirmation prompt shown before resuming a session that is already running
 * outside DPlex. Driven by `externalResumeConfirmStore`; mounted once at the
 * app root. Prevents an accidental click from opening a second connection to a
 * session another terminal is actively using.
 */
export function ExternalResumeConfirmModal(): React.JSX.Element | null {
  const pending = useExternalResumeConfirmStore((s) => s.pending)
  const cancel = useExternalResumeConfirmStore((s) => s.cancel)
  const confirm = useExternalResumeConfirmStore((s) => s.confirm)

  const open = pending !== null
  const dialogRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  useEscapeKey(cancel, open)

  // Move focus into the dialog on open and restore it to the previously
  // focused element on close, so keyboard focus never lingers behind the
  // overlay.
  useEffect(() => {
    if (!open) return
    restoreFocusRef.current = document.activeElement as HTMLElement | null
    confirmRef.current?.focus()
    return () => {
      restoreFocusRef.current?.focus?.()
    }
  }, [open])

  if (!pending) return null

  // Minimal focus trap: keep Tab / Shift+Tab cycling between the dialog's
  // own buttons while it's open.
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== 'Tab') return
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>('button')
    if (!focusables || focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[2500] flex items-center justify-center">
      <div
        className="absolute inset-0"
        style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        onClick={cancel}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="external-resume-title"
        onKeyDown={handleKeyDown}
        className="relative rounded-lg shadow-2xl p-5 w-[400px]"
        style={{
          backgroundColor: 'var(--dplex-bg-panel)',
          border: '1px solid var(--dplex-border)'
        }}
      >
        <div className="flex items-start gap-3">
          <ExternalLink
            size={20}
            style={{ color: 'var(--dplex-status-warning, #fbbf24)' }}
            className="flex-shrink-0 mt-0.5"
          />
          <div className="min-w-0">
            <h3
              id="external-resume-title"
              className="text-[14px] font-semibold"
              style={{ color: 'var(--dplex-text)' }}
            >
              Resume a session running outside DPlex?
            </h3>
            <p className="mt-1 text-[12px]" style={{ color: 'var(--dplex-text-muted)' }}>
              “{pending.displayName}” is already active in another terminal. Resuming it here opens
              a second connection to the same session, which may interfere with the one already
              running it.
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
            ref={confirmRef}
            type="button"
            className="px-3 py-1.5 text-[12px] rounded text-white"
            style={{ backgroundColor: 'var(--dplex-accent, #2563eb)' }}
            onClick={confirm}
            data-testid="external-resume-confirm"
          >
            Resume here
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
