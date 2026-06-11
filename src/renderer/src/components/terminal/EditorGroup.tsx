import { useState, DragEvent } from 'react'
import type { EditorGroup as EditorGroupType } from '../../types'
import { isFileDiffTab, isFileEditorTab } from '../../types'
import { useTerminalStore } from '../../stores/terminalStore'
import { useFocusFilter } from '../../hooks/useFocusFilter'
import { GroupTabBar } from './GroupTabBar'
import { TabHeader } from './TabHeader'
import { TerminalView } from './TerminalView'
import { FileDiffTabView } from '../diff/FileDiffTabView'
import { FileEditorTabView } from './FileEditorTabView'

interface EditorGroupProps {
  group: EditorGroupType
}

type DropZone = 'left' | 'right' | 'top' | 'bottom' | null

export function EditorGroup({ group }: EditorGroupProps): React.JSX.Element {
  const activeGroupId = useTerminalStore((s) => s.activeGroupId)
  const setActiveGroup = useTerminalStore((s) => s.setActiveGroup)
  const setActiveTerminalInGroup = useTerminalStore((s) => s.setActiveTerminalInGroup)
  const moveTerminalToNewSplit = useTerminalStore((s) => s.moveTerminalToNewSplit)
  const isActiveGroup = group.id === activeGroupId
  const [dropZone, setDropZone] = useState<DropZone>(null)
  // In isolate mode only the focused project's tabs render; the effective
  // active tab falls back to the first visible tab when the stored active tab
  // is hidden. The store is never mutated — this is a pure render view.
  const { isolate, matches } = useFocusFilter()
  const visibleTabs = isolate ? group.tabs.filter(matches) : group.tabs
  const effectiveActiveId = visibleTabs.some((t) => t.id === group.activeTabId)
    ? group.activeTabId
    : visibleTabs[0]?.id
  const activeTab = visibleTabs.find((t) => t.id === effectiveActiveId)

  // Activate this group. When isolate focus has pushed the rendered (effective)
  // active tab away from the stored `activeTabId` (the stored one is hidden),
  // also commit the effective tab so the projectStore active-tab subscriber
  // doesn't read the hidden tab and retarget focus to another project.
  const activateGroup = (): void => {
    if (effectiveActiveId && effectiveActiveId !== group.activeTabId) {
      setActiveTerminalInGroup(group.id, effectiveActiveId)
    } else {
      setActiveGroup(group.id)
    }
  }

  const getDropZone = (e: DragEvent<HTMLDivElement>): DropZone => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    const edgeThreshold = 0.25

    if (x < edgeThreshold) return 'left'
    if (x > 1 - edgeThreshold) return 'right'
    if (y < edgeThreshold) return 'top'
    if (y > 1 - edgeThreshold) return 'bottom'
    return null
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>): void => {
    const terminalId = e.dataTransfer.types.includes('dplex/terminal-id')
    if (!terminalId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropZone(getDropZone(e))
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const terminalId = e.dataTransfer.getData('dplex/terminal-id')
    const sourceGroupId = e.dataTransfer.getData('dplex/source-group')
    const zone = dropZone
    setDropZone(null)

    if (!terminalId || !zone) return

    // Don't split if dragging within same group with only 1 tab
    const sourceGroup = useTerminalStore.getState().groups.find((g) => g.id === sourceGroupId)
    if (sourceGroupId === group.id && sourceGroup && sourceGroup.tabs.length <= 1) return

    const directionMap: Record<string, 'horizontal' | 'vertical'> = {
      left: 'horizontal',
      right: 'horizontal',
      top: 'vertical',
      bottom: 'vertical'
    }
    const positionMap: Record<string, 'before' | 'after'> = {
      left: 'before',
      right: 'after',
      top: 'before',
      bottom: 'after'
    }

    moveTerminalToNewSplit(terminalId, group.id, directionMap[zone], positionMap[zone])
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    // Only clear if truly leaving (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDropZone(null)
    }
  }

  return (
    <div className={`flex flex-col h-full ${isActiveGroup ? '' : ''}`} onClick={activateGroup}>
      <GroupTabBar group={group} isActiveGroup={isActiveGroup} />
      {activeTab && <TabHeader tab={activeTab} />}

      {/* Terminal area with drop zones */}
      <div
        className="flex-1 min-h-0 relative"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragLeave={handleDragLeave}
      >
        {/* Render all tabs — active on top, inactive hidden but laid out */}
        {visibleTabs.map((tab) => {
          const isActive = tab.id === effectiveActiveId
          return (
            <div
              key={tab.id}
              className="absolute inset-0"
              style={{
                visibility: isActive ? 'visible' : 'hidden',
                zIndex: isActive ? 1 : 0
              }}
            >
              {isFileDiffTab(tab) ? (
                <FileDiffTabView tab={tab} />
              ) : isFileEditorTab(tab) ? (
                <FileEditorTabView tab={tab} isActive={isActiveGroup && isActive} />
              ) : (
                <TerminalView
                  terminalId={tab.id}
                  isActive={isActiveGroup && isActive}
                  onFocus={activateGroup}
                />
              )}
            </div>
          )
        })}

        {/* Inactive-group dimming wash. Tinted toward the panel/sidebar
            tone so a non-focused group's content visually matches its
            inactive-looking tab without fully obscuring the content. */}
        {!isActiveGroup && (
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none z-10"
            style={{ backgroundColor: 'rgba(15,19,27,0.45)' }}
          />
        )}

        {/* Drop zone overlays */}
        {dropZone && (
          <div className="absolute inset-0 pointer-events-none z-20">
            <div
              className={`absolute bg-[var(--dplex-accent)]/20 border-2 border-[var(--dplex-accent)]/50 transition-all ${
                dropZone === 'left'
                  ? 'inset-y-0 left-0 w-1/2'
                  : dropZone === 'right'
                    ? 'inset-y-0 right-0 w-1/2'
                    : dropZone === 'top'
                      ? 'inset-x-0 top-0 h-1/2'
                      : 'inset-x-0 bottom-0 h-1/2'
              }`}
            />
          </div>
        )}
      </div>
    </div>
  )
}
