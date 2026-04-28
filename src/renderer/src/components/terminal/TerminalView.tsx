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
      className={`terminal-container w-full h-full relative ${isActive ? 'ring-1 ring-[var(--dplex-accent)]/30' : ''}`}
      onClick={onFocus}
    >
      <div ref={containerRef} className="w-full h-full" />
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
