import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import type { PaneNode } from '../../types'
import { TerminalView } from './TerminalView'
import { useTerminalStore } from '../../stores/terminalStore'

interface SplitContainerProps {
  node: PaneNode
}

export function SplitContainer({ node }: SplitContainerProps): JSX.Element {
  const activeTerminalId = useTerminalStore((s) => s.activeTerminalId)
  const setActiveTerminal = useTerminalStore((s) => s.setActiveTerminal)

  if (node.type === 'terminal' && node.terminalId) {
    return (
      <TerminalView
        terminalId={node.terminalId}
        isActive={node.terminalId === activeTerminalId}
        onFocus={() => setActiveTerminal(node.terminalId!)}
      />
    )
  }

  if (node.type === 'split' && node.children) {
    const isVertical = node.direction === 'vertical'

    return (
      <Allotment vertical={isVertical}>
        {node.children.map((child, i) => (
          <Allotment.Pane key={child.terminalId || `pane-${i}`} minSize={100}>
            <SplitContainer node={child} />
          </Allotment.Pane>
        ))}
      </Allotment>
    )
  }

  return <div className="flex items-center justify-center h-full text-zinc-500">Empty pane</div>
}
