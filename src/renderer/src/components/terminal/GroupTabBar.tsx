import { useRef, useState, DragEvent } from 'react'
import {
  Plus,
  X,
  Terminal as TerminalIcon,
  SplitSquareHorizontal,
  SplitSquareVertical
} from 'lucide-react'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useProjectStore } from '../../stores/projectStore'
import { useTabFocusStore } from '../../stores/tabFocusStore'
import { StatusDot } from '../common/StatusDot'
import { labelForVisual } from '../../utils/sessionStatusVisual'
import { effectiveSessionVisual } from '../../utils/sessionPairing'
import { getTabIdentity } from '../../utils/tabProject'
import { ShellSelector } from './ShellSelector'
import type { EditorGroup } from '../../types'

interface GroupTabBarProps {
  group: EditorGroup
  /**
   * Currently unused after the visual refresh — the active-group accent
   * was previously a bottom border on the whole tabbar. The new design
   * highlights the active *tab* with a top stripe, and the surrounding
   * group container provides the border. Kept in the prop signature so
   * callers don't break and so the design can re-use it later (e.g.
   * ambient glow on the active group).
   */
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

  const sessions = useSessionStore((s) => s.sessions)
  const projects = useProjectStore((s) => s.projects)
  const focusedProjectId = useTabFocusStore((s) => s.focusedProjectId)

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
      className="flex items-center select-none"
      style={{
        height: 36,
        backgroundColor: 'var(--dplex-bg-alt)',
        borderBottom: '1px solid var(--dplex-border-subtle)'
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
          const isActive = isActiveGroup && tab.id === group.activeTabId
          const isPreview = isFileDiff && (tab as { preview?: boolean }).preview === true
          const identity = getTabIdentity(tab, projects)
          const focusActive = focusedProjectId !== null
          const isInFocus =
            !focusActive ||
            (identity !== undefined &&
              (identity.colorProject.id === focusedProjectId ||
                identity.matched.id === focusedProjectId))
          const dimmed = focusActive && !isInFocus && !isActive
          const projectTitle = identity
            ? identity.matched.id === identity.colorProject.id
              ? identity.matched.name
              : `${identity.colorProject.name} › ${identity.matched.name}`
            : undefined
          return (
            <div
              key={tab.id}
              draggable
              onDragStart={(e) => handleDragStart(e, tab.id)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
              title={projectTitle ? `${tab.title} — ${projectTitle}` : undefined}
              className={`group flex items-center gap-2 px-3.5 cursor-pointer text-[12.5px] transition-colors relative ${
                dragOverIndex === index ? 'border-l-2' : ''
              }`}
              style={{
                height: 36,
                // Active tab loses its right separator and is pulled 1px
                // below the bar (and grows by 1px to keep its top edge
                // aligned) so it covers the bar's bottom border directly
                // beneath itself — the tab visually merges with the
                // editor content below, like VS Code / browser tabs.
                borderRight: isActive ? 'none' : '1px solid var(--dplex-border-subtle)',
                marginBottom: isActive ? -1 : 0,
                paddingBottom: isActive ? 1 : 0,
                borderLeftColor: dragOverIndex === index ? 'var(--dplex-accent)' : 'transparent',
                backgroundColor: isActive ? 'var(--dplex-bg)' : 'var(--dplex-bg-alt)',
                color: isActive ? 'var(--dplex-text)' : 'var(--dplex-text-muted)',
                opacity: dimmed ? 0.4 : 1,
                zIndex: isActive ? 1 : 0
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
              {/* Active tab gets a 2-px accent stripe along the top edge —
                  flat VS Code style. Project identity is now carried by
                  the avatar (below) and the pane's TabHeader, so the tab
                  itself only needs the active indicator. v2 adds a soft
                  glow under the stripe to match the visual identity. */}
              {isActive && (
                <span
                  aria-hidden
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 2,
                    backgroundColor: 'var(--dplex-accent)',
                    boxShadow: '0 0 8px var(--dplex-accent-glow)',
                    pointerEvents: 'none'
                  }}
                />
              )}
              {identity ? (
                <span
                  aria-hidden
                  className="inline-flex items-center justify-center rounded-[3px] font-bold leading-none flex-shrink-0"
                  style={{
                    width: 14,
                    height: 14,
                    backgroundColor: identity.color.bg,
                    color: identity.color.fg,
                    border: `1px solid ${identity.color.border}`,
                    fontSize: 9
                  }}
                >
                  {identity.initials}
                </span>
              ) : (
                <TerminalIcon
                  size={13}
                  className="flex-shrink-0"
                  style={{ color: isActive ? 'var(--dplex-text)' : 'var(--dplex-text-muted)' }}
                />
              )}
              {(() => {
                if (!tabSessionId || !tabProviderId) return null
                const session = sessions.find(
                  (s) => s.id === tabSessionId && s.aiTool === tabProviderId
                )
                // Guard against stale `detailedStatus` lingering on sessions
                // whose lock has died (status === 'idle'). Mirrors the same
                // safety check applied in ProjectAvatarButton.
                if (!session || session.status !== 'active') return null
                // `effectiveSessionVisual` treats active-but-untyped sessions
                // as `thinking` so a freshly-spawned session (still in PTY
                // bring-up before any JSONL events land) shows a live dot
                // instead of disappearing.
                const visual = effectiveSessionVisual(session)
                // Hide on idle to keep tabs visually quiet — only show when
                // the AI is actively working or waiting on the user.
                if (visual === 'idle') return null
                return <StatusDot visual={visual} title={labelForVisual(visual)} />
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
                  className="bg-transparent border-none outline-none text-[12.5px] w-24"
                  style={{ color: 'var(--dplex-text)' }}
                  autoFocus
                />
              ) : (
                <span
                  className="truncate max-w-[140px]"
                  style={{
                    fontStyle: isPreview ? 'italic' : undefined,
                    fontWeight: isActive ? 600 : undefined
                  }}
                  data-testid="editor-tab-label"
                >
                  {tab.title}
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  closeTerminal(tab.id)
                }}
                className="opacity-0 group-hover:opacity-100 rounded p-0.5 transition-all ml-0.5"
                style={{ color: 'var(--dplex-text-dim)' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--dplex-bg-elev-2)'
                  e.currentTarget.style.color = 'var(--dplex-text)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent'
                  e.currentTarget.style.color = 'var(--dplex-text-dim)'
                }}
              >
                <X size={11} />
              </button>
            </div>
          )
        })}

        <button
          onClick={() => {
            setActiveGroup(group.id)
            createTerminal(group.id)
          }}
          className="flex items-center justify-center hover:bg-[var(--dplex-hover)] transition-colors flex-shrink-0"
          style={{ width: 32, height: 36, color: 'var(--dplex-text-muted)' }}
          title="New terminal (default shell)"
        >
          <Plus size={13} />
        </button>
        <ShellSelector
          onSelect={(shell) => {
            setActiveGroup(group.id)
            createTerminal(group.id, undefined, undefined, shell)
          }}
        />
      </div>

      {/* Split controls — sticky on the right with a left separator. */}
      <div
        className="flex items-center gap-0.5 px-1.5 flex-shrink-0"
        style={{ borderLeft: '1px solid var(--dplex-border-subtle)', height: 36 }}
      >
        <button
          onClick={() => splitGroup(group.id, 'horizontal')}
          className="p-1 hover:bg-[var(--dplex-hover)] rounded transition-colors"
          style={{ color: 'var(--dplex-text-muted)' }}
          title="Split right"
        >
          <SplitSquareHorizontal size={13} />
        </button>
        <button
          onClick={() => splitGroup(group.id, 'vertical')}
          className="p-1 hover:bg-[var(--dplex-hover)] rounded transition-colors"
          style={{ color: 'var(--dplex-text-muted)' }}
          title="Split down"
        >
          <SplitSquareVertical size={13} />
        </button>
      </div>
    </div>
  )
}
