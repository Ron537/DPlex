import { useRef } from 'react'
import { useTerminal } from '../../hooks/useTerminal'

interface TerminalViewProps {
  terminalId: string
  isActive: boolean
  onFocus: () => void
}

export function TerminalView({ terminalId, isActive, onFocus }: TerminalViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  useTerminal({ terminalId, containerRef })

  return (
    <div
      className={`terminal-container w-full h-full relative ${isActive ? 'ring-1 ring-blue-500/30' : ''}`}
      onClick={onFocus}
    >
      <div ref={containerRef} className="w-full h-full" />
    </div>
  )
}
