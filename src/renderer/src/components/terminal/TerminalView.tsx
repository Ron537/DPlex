import { useRef, useEffect } from 'react'
import { useTerminal } from '../../hooks/useTerminal'
import {
  enableWebglRenderer,
  fitTerminal,
  getTerminalEntry,
  setTerminalVisible
} from '../../services/terminalRegistry'
import { Loader2 } from 'lucide-react'

interface TerminalViewProps {
  terminalId: string
  /** True when this is the tab currently displayed by its group (regardless of
   *  which group has focus). Drives fitting and GPU-context acquisition. */
  isVisible: boolean
  /** True when this tab is displayed AND its group is the focused one. */
  isFocused: boolean
  onFocus: () => void
}

export function TerminalView({
  terminalId,
  isVisible,
  isFocused,
  onFocus
}: TerminalViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const { ready } = useTerminal({ terminalId, containerRef })

  // Becoming visible: claim a WebGL context (hidden terminals don't get one)
  // and refit, since the pane may have been resized while this tab was hidden.
  // Deferred a frame so the visibility flip has been laid out — measuring a
  // still-hidden element yields no usable dimensions.
  useEffect(() => {
    setTerminalVisible(terminalId, isVisible)
    if (!isVisible) return
    const raf = requestAnimationFrame(() => {
      enableWebglRenderer(terminalId)
      fitTerminal(terminalId)
    })
    return () => {
      cancelAnimationFrame(raf)
      setTerminalVisible(terminalId, false)
    }
  }, [isVisible, terminalId])

  // Focus the terminal once it's the focused tab and has started producing
  // output (focusing a not-yet-started terminal is a no-op users can't see).
  useEffect(() => {
    if (!isFocused || !isVisible) return
    const entry = getTerminalEntry(terminalId)
    if (entry) entry.term.focus()
  }, [isFocused, isVisible, ready, terminalId])

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
        ...(isFocused
          ? {
              // Three-sided active ring — top edge is intentionally
              // omitted so the active tab and the terminal area read as
              // a single continuous surface (no visible seam under the
              // tab).
              boxShadow:
                'inset 1px 0 0 var(--dplex-accent-ring), inset -1px 0 0 var(--dplex-accent-ring), inset 0 -1px 0 var(--dplex-accent-ring)'
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
