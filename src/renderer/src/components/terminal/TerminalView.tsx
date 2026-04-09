import { useRef } from 'react'
import { useTerminal } from '../../hooks/useTerminal'
import { Loader2 } from 'lucide-react'

interface TerminalViewProps {
  terminalId: string
  isActive: boolean
  onFocus: () => void
}

export function TerminalView({ terminalId, isActive, onFocus }: TerminalViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const { ready } = useTerminal({ terminalId, containerRef })

  return (
    <div
      className={`terminal-container w-full h-full relative ${isActive ? 'ring-1 ring-blue-500/30' : ''}`}
      onClick={onFocus}
    >
      <div ref={containerRef} className="w-full h-full" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center z-10" style={{ backgroundColor: 'var(--tplex-bg)' }}>
          <div className="flex items-center gap-2" style={{ color: 'var(--tplex-text-muted)' }}>
            <Loader2 size={16} className="animate-spin" />
            <span className="text-xs">Starting terminal...</span>
          </div>
        </div>
      )}
    </div>
  )
}
