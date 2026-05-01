import { useRef, useState, DragEvent } from 'react'
import {
  Plus,
  X,
  Terminal as TerminalIcon,
  SplitSquareHorizontal,
  SplitSquareVertical
} from 'lucide-react'
import { useTerminalStore } from '../../stores/terminalStore'
import { useAttentionStore } from '../../stores/attentionStore'
import { ShellSelector } from './ShellSelector'
import type { EditorGroup } from '../../types'
import type { AttentionKind } from '../../../../preload/attentionTypes'

const DOT_COLOR: Record<AttentionKind, string> = {
  waitingForApproval: 'var(--dplex-status-approval)',
  waitingForInput: 'var(--dplex-status-waiting)',
  finished: 'var(--dplex-status-thinking)'
}

interface GroupTabBarProps {
  group: EditorGroup
  isActiveGroup: boolean
}

export function GroupTabBar({ group, isActiveGroup }: GroupTabBarProps): React.JSX.Element {
  const setActiveGroup = useTerminalStore((s) => s.setActiveGroup)
  const setActiveTerminalInGroup = useTerminalStore((s) => s.setActiveTerminalInGroup)
  const closeTerminal = useTerminalStore((s) => s.closeTerminal)
  const createTerminal = useTerminalStore((s) => s.createTerminal)
  const renameTerminal = useTerminalStore((s) => s.renameTerminal)
  const promotePreviewTab = useTerminalStore((s) => s.promotePreviewTab)
  const splitGroup = useTerminalStore((s) => s.splitGroup)
  const moveTerminalToGroup = useTerminalStore((s) => s.moveTerminalToGroup)
  const reorderTab = useTerminalStore((s) => s.reorderTab)

  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const activeEvents = useAttentionStore((s) => s.active)

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
    e.dataTransfer.setData('dplex/terminal-id', tabId)
    e.dataTransfer.setData('dplex/source-group', group.id)
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
    const terminalId = e.dataTransfer.getData('dplex/terminal-id')
    const sourceGroupId = e.dataTransfer.getData('dplex/source-group')
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
    const terminalId = e.dataTransfer.getData('dplex/terminal-id')
    const sourceGroupId = e.dataTransfer.getData('dplex/source-group')
    if (!terminalId || sourceGroupId === group.id) return
    moveTerminalToGroup(terminalId, group.id)
  }

  return (
    <div
      className="flex items-center h-8 select-none"
      style={{
        backgroundColor: 'var(--dplex-bg-alt)',
        borderBottom: isActiveGroup
          ? '1px solid var(--dplex-accent)'
          : '1px solid var(--dplex-border)'
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDrop={handleTabBarDrop}
    >
      <div className="flex items-center gap-0 overflow-x-auto no-scrollbar flex-1">
        {group.tabs.map((tab, index) => {
          const isFileDiff = tab.kind === 'fileDiff'
          const tabSessionId = isFileDiff ? undefined : tab.sessionId
          const tabProviderId = isFileDiff ? undefined : tab.providerId
          const isActive = tab.id === group.activeTabId
          const isPreview = isFileDiff && (tab as { preview?: boolean }).preview === true
          return (
            <div
              key={tab.id}
              draggable
              onDragStart={(e) => handleDragStart(e, tab.id)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
              className={`group flex items-center gap-1 px-2.5 h-8 cursor-pointer text-[11px] transition-colors relative ${
                dragOverIndex === index ? 'border-l-2' : ''
              }`}
              style={{
                borderRight: '1px solid var(--dplex-border)',
                borderLeftColor: dragOverIndex === index ? 'var(--dplex-accent)' : 'transparent',
                backgroundColor: isActive ? 'var(--dplex-bg)' : 'transparent',
                color: isActive ? 'var(--dplex-text)' : 'var(--dplex-text-muted)',
                boxShadow: isActive ? 'inset 0 -2px 0 0 var(--dplex-accent)' : undefined
              }}
              onClick={() => {
                setActiveGroup(group.id)
                setActiveTerminalInGroup(group.id, tab.id)
              }}
              onDoubleClick={() => {
                if (isPreview) {
                  promotePreviewTab(tab.id)
                } else if (!isFileDiff) {
                  handleDoubleClick(tab.id, tab.title)
                }
              }}
            >
              <TerminalIcon
                size={11}
                className="flex-shrink-0"
                style={{ color: 'var(--dplex-text-muted)' }}
              />
              {(() => {
                if (!tabSessionId || !tabProviderId) return null
                const compositeId = `${tabProviderId}:${tabSessionId}`
                const event = activeEvents.find(
                  (e) => e.compositeId === compositeId && !e.suppressed
                )
                if (!event) return null
                return (
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: DOT_COLOR[event.kind] }}
                    title={event.kind}
                  />
                )
              })()}
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
                <span
                  className="truncate max-w-[100px]"
                  style={{ fontStyle: isPreview ? 'italic' : undefined }}
                >
                  {tab.title}
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  closeTerminal(tab.id)
                }}
                className="opacity-0 group-hover:opacity-100 hover:bg-[var(--dplex-hover)] rounded p-0.5 transition-opacity ml-0.5"
              >
                <X size={9} />
              </button>
            </div>
          )
        })}

        <button
          onClick={() => {
            setActiveGroup(group.id)
            createTerminal(group.id)
          }}
          className="flex items-center justify-center w-7 h-8 hover:bg-[var(--dplex-hover)] transition-colors flex-shrink-0"
          style={{ color: 'var(--dplex-text-muted)' }}
          title="New terminal (default shell)"
        >
          <Plus size={12} />
        </button>
        <ShellSelector
          onSelect={(shell) => {
            setActiveGroup(group.id)
            createTerminal(group.id, undefined, undefined, shell)
          }}
        />
      </div>

      {/* Split controls */}
      <div className="flex items-center gap-0.5 px-1 flex-shrink-0">
        <button
          onClick={() => splitGroup(group.id, 'horizontal')}
          className="p-0.5 hover:bg-[var(--dplex-hover)] rounded transition-colors"
          style={{ color: 'var(--dplex-text-muted)' }}
          title="Split right"
        >
          <SplitSquareHorizontal size={12} />
        </button>
        <button
          onClick={() => splitGroup(group.id, 'vertical')}
          className="p-0.5 hover:bg-[var(--dplex-hover)] rounded transition-colors"
          style={{ color: 'var(--dplex-text-muted)' }}
          title="Split down"
        >
          <SplitSquareVertical size={12} />
        </button>
      </div>
    </div>
  )
}
