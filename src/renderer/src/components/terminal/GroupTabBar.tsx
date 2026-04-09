import { useRef, useState, DragEvent } from 'react'
import { Plus, X, Terminal as TerminalIcon, SplitSquareHorizontal, SplitSquareVertical } from 'lucide-react'
import { useTerminalStore } from '../../stores/terminalStore'
import type { EditorGroup } from '../../types'

interface GroupTabBarProps {
  group: EditorGroup
  isActiveGroup: boolean
}

export function GroupTabBar({ group, isActiveGroup }: GroupTabBarProps): JSX.Element {
  const setActiveGroup = useTerminalStore((s) => s.setActiveGroup)
  const setActiveTerminalInGroup = useTerminalStore((s) => s.setActiveTerminalInGroup)
  const closeTerminal = useTerminalStore((s) => s.closeTerminal)
  const createTerminal = useTerminalStore((s) => s.createTerminal)
  const renameTerminal = useTerminalStore((s) => s.renameTerminal)
  const splitGroup = useTerminalStore((s) => s.splitGroup)
  const moveTerminalToGroup = useTerminalStore((s) => s.moveTerminalToGroup)
  const reorderTab = useTerminalStore((s) => s.reorderTab)

  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDoubleClick = (tabId: string, currentTitle: string): void => {
    setEditingTabId(tabId)
    setEditValue(currentTitle)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  const commitRename = (): void => {
    if (editingTabId && editValue.trim()) {
      renameTerminal(editingTabId, editValue.trim())
    }
    setEditingTabId(null)
  }

  const handleDragStart = (e: DragEvent, tabId: string): void => {
    e.dataTransfer.setData('tplex/terminal-id', tabId)
    e.dataTransfer.setData('tplex/source-group', group.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: DragEvent, index: number): void => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIndex(index)
  }

  const handleDragLeave = (): void => {
    setDragOverIndex(null)
  }

  const handleDrop = (e: DragEvent, dropIndex: number): void => {
    e.preventDefault()
    setDragOverIndex(null)
    const terminalId = e.dataTransfer.getData('tplex/terminal-id')
    const sourceGroupId = e.dataTransfer.getData('tplex/source-group')
    if (!terminalId) return

    if (sourceGroupId === group.id) {
      // Reorder within same group
      const fromIndex = group.tabs.findIndex((t) => t.id === terminalId)
      if (fromIndex !== -1 && fromIndex !== dropIndex) {
        reorderTab(group.id, fromIndex, dropIndex)
      }
    } else {
      // Move from another group
      moveTerminalToGroup(terminalId, group.id, dropIndex)
    }
  }

  const handleTabBarDrop = (e: DragEvent): void => {
    e.preventDefault()
    setDragOverIndex(null)
    const terminalId = e.dataTransfer.getData('tplex/terminal-id')
    const sourceGroupId = e.dataTransfer.getData('tplex/source-group')
    if (!terminalId || sourceGroupId === group.id) return
    moveTerminalToGroup(terminalId, group.id)
  }

  return (
    <div
      className={`flex items-center h-8 bg-[#16162a] border-b select-none ${
        isActiveGroup ? 'border-blue-500/40' : 'border-[#2a2a4a]'
      }`}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
      onDrop={handleTabBarDrop}
    >
      <div className="flex items-center gap-0 overflow-x-auto no-scrollbar flex-1">
        {group.tabs.map((tab, index) => (
          <div
            key={tab.id}
            draggable
            onDragStart={(e) => handleDragStart(e, tab.id)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, index)}
            className={`group flex items-center gap-1 px-2.5 h-8 cursor-pointer text-[11px] transition-colors border-r border-[#2a2a4a] ${
              dragOverIndex === index ? 'border-l-2 border-l-blue-500' : ''
            } ${
              tab.id === group.activeTabId
                ? 'bg-[#1a1a2e] text-white'
                : 'text-zinc-500 hover:bg-[#1e1e38] hover:text-zinc-300'
            }`}
            onClick={() => {
              setActiveGroup(group.id)
              setActiveTerminalInGroup(group.id, tab.id)
            }}
            onDoubleClick={() => handleDoubleClick(tab.id, tab.title)}
          >
            <TerminalIcon size={11} className="flex-shrink-0 text-zinc-600" />
            {editingTabId === tab.id ? (
              <input
                ref={inputRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') setEditingTabId(null)
                }}
                className="bg-transparent border-none outline-none text-[11px] text-white w-20"
                autoFocus
              />
            ) : (
              <span className="truncate max-w-[100px]">{tab.title}</span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                closeTerminal(tab.id)
              }}
              className="opacity-0 group-hover:opacity-100 hover:bg-white/10 rounded p-0.5 transition-opacity ml-0.5"
            >
              <X size={9} />
            </button>
          </div>
        ))}

        <button
          onClick={() => {
            setActiveGroup(group.id)
            createTerminal(group.id)
          }}
          className="flex items-center justify-center w-7 h-8 text-zinc-600 hover:text-white hover:bg-[#1e1e38] transition-colors flex-shrink-0"
          title="New terminal"
        >
          <Plus size={12} />
        </button>
      </div>

      {/* Split controls */}
      <div className="flex items-center gap-0.5 px-1 flex-shrink-0">
        <button
          onClick={() => splitGroup(group.id, 'horizontal')}
          className="p-0.5 text-zinc-600 hover:text-white hover:bg-white/10 rounded transition-colors"
          title="Split right"
        >
          <SplitSquareHorizontal size={12} />
        </button>
        <button
          onClick={() => splitGroup(group.id, 'vertical')}
          className="p-0.5 text-zinc-600 hover:text-white hover:bg-white/10 rounded transition-colors"
          title="Split down"
        >
          <SplitSquareVertical size={12} />
        </button>
      </div>
    </div>
  )
}
