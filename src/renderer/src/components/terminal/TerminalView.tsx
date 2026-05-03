import { useRef, useEffect } from 'react'
import { useTerminal } from '../../hooks/useTerminal'
import { fitTerminal, getTerminalEntry } from '../../services/terminalRegistry'
import { Loader2 } from 'lucide-react'

interface TerminalViewProps {
  terminalId: string
  isActive: boolean
  onFocus: () => void
}

export function TerminalView({
  terminalId,
  isActive,
  onFocus
}: TerminalViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const { ready } = useTerminal({ terminalId, containerRef })

  // Fit and focus when this terminal becomes active
  useEffect(() => {
    if (isActive) {
      fitTerminal(terminalId)
      const entry = getTerminalEntry(terminalId)
      if (entry) entry.term.focus()
    }
  }, [isActive, terminalId])

  // Focus when terminal becomes ready (first data received)
  useEffect(() => {
    if (ready && isActive) {
      const entry = getTerminalEntry(terminalId)
      if (entry) entry.term.focus()
    }
  }, [ready, isActive, terminalId])

  return (
    <div
      className="terminal-container w-full h-full relative"
      onClick={onFocus}
      style={{
        // Match the terminal palette's background so any unused space
        // below the last fitted row (xterm's canvas only covers full
        // rows × cell-height) shows the same color, not the parent's
        // darker chrome.
        backgroundColor: 'var(--dplex-bg)',
        ...(isActive
          ? {
              // Three-sided active ring — top edge is intentionally
              // omitted so the active tab and the terminal area read as
              // a single continuous surface (no visible seam under the
              // tab).
              boxShadow:
                'inset 1px 0 0 rgba(123,162,255,0.3), inset -1px 0 0 rgba(123,162,255,0.3), inset 0 -1px 0 rgba(123,162,255,0.3)'
            }
          : {})
      }}
    >
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ backgroundColor: 'var(--dplex-bg)' }}
      />
      {!ready && (
        <div
          className="absolute inset-0 flex items-center justify-center z-10"
          style={{ backgroundColor: 'var(--dplex-bg)' }}
        >
          <div className="flex items-center gap-2" style={{ color: 'var(--dplex-text-muted)' }}>
            <Loader2 size={16} className="animate-spin" />
            <span className="text-xs">Starting terminal...</span>
          </div>
        </div>
      )}
    </div>
  )
}
