import { useRef, useState, DragEvent } from 'react'
import {
  Plus,
  X,
  Pencil,
  Terminal as TerminalIcon,
  LayoutDashboard,
  SplitSquareHorizontal,
  SplitSquareVertical
} from 'lucide-react'
import { useTerminalStore } from '../../stores/terminalStore'
import { requestCloseTab } from '../../stores/closeConfirmStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useProjectStore } from '../../stores/projectStore'
import { useFocusFilter } from '../../hooks/useFocusFilter'
import { StatusDot } from '../common/StatusDot'
import { PopoverMenu } from '../common/PopoverMenu'
import { TAB_COLORS } from '../../utils/tabColors'
import { labelForVisual } from '../../utils/sessionStatusVisual'
import { effectiveSessionVisual } from '../../utils/sessionPairing'
import { getTabIdentity } from '../../utils/tabProject'
import { openInheritedTerminal, openInheritedSplit } from '../../utils/inheritCwd'
import { ShellSelector } from './ShellSelector'
import type { EditorGroup } from '../../types'
import { isTerminalTab, isFileDiffTab, isFileEditorTab, isDashboardTab } from '../../types'

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
  const renameTerminal = useTerminalStore((s) => s.renameTerminal)
  const setTabColor = useTerminalStore((s) => s.setTabColor)
  const promotePreviewTab = useTerminalStore((s) => s.promotePreviewTab)
  const moveTerminalToGroup = useTerminalStore((s) => s.moveTerminalToGroup)
  const reorderTab = useTerminalStore((s) => s.reorderTab)

  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  // Right-click tab context menu (color picker + rename/close), anchored at
  // the cursor via a 1×1 virtual anchor element.
  const [menu, setMenu] = useState<{ tabId: string; x: number; y: number } | null>(null)
  const menuAnchorRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const sessions = useSessionStore((s) => s.sessions)
  const projects = useProjectStore((s) => s.projects)
  const { isolate, dim, matches } = useFocusFilter()
  // Mirror EditorGroup's effective-active-tab derivation: in isolate mode a
  // group's stored activeTabId may point at a now-hidden tab, in which case the
  // content pane falls back to the first visible tab. Compute the same id here
  // so the tab strip's "active" styling matches what's actually rendered.
  const visibleTabs = isolate ? group.tabs.filter(matches) : group.tabs
  const effectiveActiveId = visibleTabs.some((t) => t.id === group.activeTabId)
    ? group.activeTabId
    : visibleTabs[0]?.id

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
          const isFileDiff = isFileDiffTab(tab)
          const isFileEditor = isFileEditorTab(tab)
          const isTerminal = isTerminalTab(tab)
          const tabSessionId = isTerminal ? tab.sessionId : undefined
          const tabProviderId = isTerminal ? tab.providerId : undefined
          const isActive = isActiveGroup && tab.id === effectiveActiveId
          const isPreview =
            (isFileDiff || isFileEditor) && (tab as { preview?: boolean }).preview === true
          const isDirty = isFileEditor && tab.dirty === true
          const identity = getTabIdentity(tab, projects)
          // Effective tab colour: an explicit per-tab colour wins; otherwise
          // the tab inherits its project's colour (shared across the origin +
          // its worktrees via `colorProject`).
          const tabColor = (tab as { color?: string }).color ?? identity?.colorProject.tabColor
          // A coloured tab tints its whole chip (stronger when active) so the
          // colour is unmistakable at a glance; uncoloured tabs keep the
          // default active/inactive surfaces.
          const tabBg = tabColor
            ? isActive
              ? `${tabColor}38`
              : `${tabColor}1F`
            : isActive
              ? 'var(--dplex-bg)'
              : 'var(--dplex-bg-alt)'
          // Isolate mode hides non-matching tabs entirely; dim mode keeps them
          // visible but de-emphasized. Iterate the real `group.tabs` (returning
          // null for hidden tabs) so drag-reorder indices stay correct.
          const inFocus = matches(tab)
          if (isolate && !inFocus) return null
          const dimmed = dim && !inFocus && !isActive
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
                backgroundColor: tabBg,
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
                } else if (isTerminal) {
                  handleDoubleClick(tab.id, tab.title)
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setActiveGroup(group.id)
                setMenu({ tabId: tab.id, x: e.clientX, y: e.clientY })
              }}
            >
              {/* Only the active tab gets the 2-px top stripe — flat VS Code
                  style. It adopts the tab's chosen colour (falling back to the
                  accent). Inactive tabs, coloured or not, carry no stripe; a
                  coloured inactive tab is identified by its full-chip tint. */}
              {isActive && (
                <span
                  aria-hidden
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 2,
                    backgroundColor: tabColor ?? 'var(--dplex-accent)',
                    boxShadow: `0 0 8px ${tabColor ? `${tabColor}66` : 'var(--dplex-accent-glow)'}`,
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
              ) : isDashboardTab(tab) ? (
                <LayoutDashboard
                  size={13}
                  className="flex-shrink-0"
                  style={{ color: isActive ? 'var(--dplex-text)' : 'var(--dplex-text-muted)' }}
                />
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
                  requestCloseTab(tab.id)
                }}
                className={`rounded p-0.5 transition-all ml-0.5 ${
                  isDirty ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
                style={{ color: 'var(--dplex-text-dim)' }}
                title={isDirty ? 'Unsaved changes — close' : 'Close'}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--dplex-bg-elev-2)'
                  e.currentTarget.style.color = 'var(--dplex-text)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent'
                  e.currentTarget.style.color = 'var(--dplex-text-dim)'
                }}
              >
                {isDirty && (
                  <span
                    aria-hidden
                    className="block group-hover:hidden"
                    style={{
                      width: 8,
                      height: 8,
                      margin: 1.5,
                      borderRadius: '50%',
                      backgroundColor: 'var(--dplex-text-muted)'
                    }}
                  />
                )}
                <X size={11} className={isDirty ? 'hidden group-hover:block' : 'block'} />
              </button>
            </div>
          )
        })}

        <button
          onClick={() => {
            setActiveGroup(group.id)
            void openInheritedTerminal(group.id)
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
            void openInheritedTerminal(group.id, shell)
          }}
        />
      </div>

      {/* Split controls — sticky on the right with a left separator. */}
      <div
        className="flex items-center gap-0.5 px-1.5 flex-shrink-0"
        style={{ borderLeft: '1px solid var(--dplex-border-subtle)', height: 36 }}
      >
        <button
          onClick={() => void openInheritedSplit(group.id, 'horizontal')}
          className="p-1 hover:bg-[var(--dplex-hover)] rounded transition-colors"
          style={{ color: 'var(--dplex-text-muted)' }}
          title="Split right"
        >
          <SplitSquareHorizontal size={13} />
        </button>
        <button
          onClick={() => void openInheritedSplit(group.id, 'vertical')}
          className="p-1 hover:bg-[var(--dplex-hover)] rounded transition-colors"
          style={{ color: 'var(--dplex-text-muted)' }}
          title="Split down"
        >
          <SplitSquareVertical size={13} />
        </button>
      </div>

      {menu &&
        (() => {
          const menuTab = group.tabs.find((t) => t.id === menu.tabId)
          if (!menuTab) return null
          const currentColor = (menuTab as { color?: string }).color
          return (
            <>
              <div
                ref={menuAnchorRef}
                aria-hidden
                style={{
                  position: 'fixed',
                  left: menu.x,
                  top: menu.y,
                  width: 1,
                  height: 1,
                  pointerEvents: 'none'
                }}
              />
              <PopoverMenu
                anchorRef={menuAnchorRef}
                open
                align="left"
                onClose={() => setMenu(null)}
                className="min-w-[184px]"
              >
                <div
                  className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase"
                  style={{ color: 'var(--dplex-text-faint)', letterSpacing: '0.08em' }}
                >
                  Tab color
                </div>
                <div className="flex items-center gap-1.5 px-3 pb-2">
                  {TAB_COLORS.map((c) => {
                    const selected = currentColor === c.value
                    return (
                      <button
                        key={c.id}
                        type="button"
                        title={c.label}
                        aria-pressed={selected}
                        onClick={() => {
                          setTabColor(menu.tabId, c.value)
                          setMenu(null)
                        }}
                        className="rounded-full transition-transform hover:scale-110"
                        style={{
                          width: 16,
                          height: 16,
                          backgroundColor: c.value,
                          boxShadow: selected
                            ? `0 0 0 2px var(--dplex-bg), 0 0 0 3px ${c.value}`
                            : 'none'
                        }}
                      />
                    )
                  })}
                  <button
                    type="button"
                    title="No color"
                    aria-label="Clear tab color"
                    onClick={() => {
                      setTabColor(menu.tabId, null)
                      setMenu(null)
                    }}
                    className="grid place-items-center rounded-full hover:bg-[var(--dplex-hover)]"
                    style={{
                      width: 16,
                      height: 16,
                      border: '1px solid var(--dplex-border-strong)',
                      color: 'var(--dplex-text-muted)'
                    }}
                  >
                    <X size={10} />
                  </button>
                </div>
                <div className="my-1" style={{ borderTop: '1px solid var(--dplex-border)' }} />
                {isTerminalTab(menuTab) && (
                  <button
                    type="button"
                    onClick={() => {
                      handleDoubleClick(menuTab.id, menuTab.title)
                      setMenu(null)
                    }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
                    style={{ color: 'var(--dplex-text)' }}
                  >
                    <Pencil size={12} /> Rename
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    requestCloseTab(menu.tabId)
                    setMenu(null)
                  }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
                  style={{ color: 'var(--dplex-text)' }}
                >
                  <X size={12} /> Close
                </button>
              </PopoverMenu>
            </>
          )
        })()}
    </div>
  )
}
