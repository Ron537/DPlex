import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import type { LayoutNode } from '../../types'
import { useTerminalStore } from '../../stores/terminalStore'
import { EditorGroup } from './EditorGroup'

interface GroupLayoutProps {
  node: LayoutNode
}

export function GroupLayout({ node }: GroupLayoutProps): JSX.Element {
  const groups = useTerminalStore((s) => s.groups)

  if (node.type === 'group' && node.groupId) {
    const group = groups.find((g) => g.id === node.groupId)
    if (!group) {
      return <div className="flex items-center justify-center h-full text-zinc-600 text-xs">Empty group</div>
    }
    return <EditorGroup group={group} />
  }

  if (node.type === 'split' && node.children && node.children.length > 0) {
    const isVertical = node.direction === 'vertical'
    return (
      <Allotment vertical={isVertical}>
        {node.children.map((child, i) => (
          <Allotment.Pane key={child.groupId || `split-${i}`} minSize={120}>
            <GroupLayout node={child} />
          </Allotment.Pane>
        ))}
      </Allotment>
    )
  }

  return <div className="flex items-center justify-center h-full text-zinc-600 text-xs">Empty</div>
}
