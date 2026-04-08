import {
  Plus,
  X,
  Terminal as TerminalIcon,
  SplitSquareHorizontal,
  SplitSquareVertical
} from 'lucide-react'
import { useTerminalStore } from '../../stores/terminalStore'
import { useRef, useState } from 'react'

export function TabBar(): JSX.Element {
  const tabs = useTerminalStore((s) => s.tabs)
  const activeTabId = useTerminalStore((s) => s.activeTabId)
  const createTab = useTerminalStore((s) => s.createTab)
  const closeTab = useTerminalStore((s) => s.closeTab)
  const setActiveTab = useTerminalStore((s) => s.setActiveTab)
  const renameTab = useTerminalStore((s) => s.renameTab)
  const activeTerminalId = useTerminalStore((s) => s.activeTerminalId)
  const splitTerminal = useTerminalStore((s) => s.splitTerminal)

  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDoubleClick = (tabId: string, currentTitle: string): void => {
    setEditingTabId(tabId)
    setEditValue(currentTitle)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  const commitRename = (): void => {
    if (editingTabId && editValue.trim()) {
      renameTab(editingTabId, editValue.trim())
    }
    setEditingTabId(null)
  }

  return (
    <div className="flex items-center h-9 bg-[#16162a] border-b border-[#2a2a4a] select-none drag-region">
      {/* macOS traffic light spacer */}
      <div className="w-[72px] flex-shrink-0" />

      <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar flex-1 no-drag">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`group flex items-center gap-1.5 px-3 h-9 cursor-pointer text-xs transition-colors border-b-2 ${
              tab.id === activeTabId
                ? 'bg-[#1a1a2e] text-white border-blue-500'
                : 'text-zinc-400 border-transparent hover:bg-[#1e1e38] hover:text-zinc-200'
            }`}
            onClick={() => setActiveTab(tab.id)}
            onDoubleClick={() => handleDoubleClick(tab.id, tab.title)}
          >
            <TerminalIcon size={12} className="flex-shrink-0 text-zinc-500" />
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
                className="bg-transparent border-none outline-none text-xs text-white w-24"
                autoFocus
              />
            ) : (
              <span className="truncate max-w-[120px]">{tab.title}</span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.id)
              }}
              className="opacity-0 group-hover:opacity-100 hover:bg-white/10 rounded p-0.5 transition-opacity"
            >
              <X size={10} />
            </button>
          </div>
        ))}

        <button
          onClick={() => createTab()}
          className="flex items-center justify-center w-8 h-9 text-zinc-500 hover:text-white hover:bg-[#1e1e38] transition-colors"
          title="New terminal (⌘T)"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Split controls */}
      <div className="flex items-center gap-1 px-2 no-drag">
        <button
          onClick={() => activeTerminalId && splitTerminal(activeTerminalId, 'horizontal')}
          className="p-1 text-zinc-500 hover:text-white hover:bg-white/10 rounded transition-colors"
          title="Split right (⌘\)"
          disabled={!activeTerminalId}
        >
          <SplitSquareHorizontal size={14} />
        </button>
        <button
          onClick={() => activeTerminalId && splitTerminal(activeTerminalId, 'vertical')}
          className="p-1 text-zinc-500 hover:text-white hover:bg-white/10 rounded transition-colors"
          title="Split down (⌘⇧\)"
          disabled={!activeTerminalId}
        >
          <SplitSquareVertical size={14} />
        </button>
      </div>
    </div>
  )
}
