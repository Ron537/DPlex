import { useMemo, useRef, useState, type DragEvent } from 'react'
import {
  FolderOpen,
  Clock,
  GitBranch,
  Settings,
  Search,
  Files,
  LayoutDashboard,
  Layers,
  ArrowUp,
  ArrowDown
} from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useGitPanelStore } from '../../stores/gitPanelStore'
import { useProjectStore } from '../../stores/projectStore'
import { useAttentionStore } from '../../stores/attentionStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { isDashboardTab, type ActivityBarId } from '../../types'
import { MOD, SHIFT } from '../../utils/shortcuts'
import { useBackgroundAttention } from '../../hooks/useSpaceAttention'
import { attentionColorVar } from '../spaces/spaceVisuals'
import { PopoverMenu } from '../common/PopoverMenu'
import { reconcileActivityBarOrder, reorderActivityBar } from '../../utils/activityBarOrder'

interface ActivityItem {
  label: string
  shortcut?: string
  Icon: typeof FolderOpen
}

const ITEM_BY_ID: Record<ActivityBarId, ActivityItem> = {
  projects: { label: 'Projects', Icon: FolderOpen },
  spaces: { label: 'Spaces', Icon: Layers },
  // Plain Clock matches the v2 mockup; reads as "recent / past sessions"
  // and stays visually distinct from the GitBranch "history" association.
  sessions: { label: 'Sessions', Icon: Clock },
  explorer: { label: 'Explorer', shortcut: `${MOD}${SHIFT}E`, Icon: Files },
  git: { label: 'Source Control', shortcut: `${MOD}${SHIFT}G`, Icon: GitBranch },
  search: { label: 'Search', shortcut: `${MOD}${SHIFT}F`, Icon: Search }
}

// v2 rail — wider footprint for the larger active-state stripe + glow.
const BAR_WIDTH = 56

interface ActivityBarProps {
  onOpenSettings: () => void
}

export function ActivityBar({ onOpenSettings }: ActivityBarProps): React.JSX.Element {
  const activeTab = useSettingsStore((s) => s.settings.sidebarActiveTab)
  const panelCollapsed = useSettingsStore((s) => s.settings.sidebarPanelCollapsed)
  const activityBarOrder = useSettingsStore((s) => s.settings.activityBarOrder)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  // The rendered order, normalized against the canonical set so unknown/missing
  // ids never break the rail (robust across added or removed views).
  const order = useMemo(() => reconcileActivityBarOrder(activityBarOrder), [activityBarOrder])

  // Drag-to-reorder state. `dropTarget` holds the item under the cursor and
  // which edge the dragged icon would land on, driving the insertion line.
  const [dragId, setDragId] = useState<ActivityBarId | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: ActivityBarId; after: boolean } | null>(null)

  // Keyboard/right-click reorder: a context menu with Move up / Move down, an
  // accessible alternative to drag (mirrors the projects list). Anchored to the
  // icon that opened it.
  const [menuId, setMenuId] = useState<ActivityBarId | null>(null)
  const menuAnchorRef = useRef<HTMLButtonElement | null>(null)

  const persistOrder = (next: ActivityBarId[]): void => {
    if (next.some((id, i) => id !== order[i])) updateSettings({ activityBarOrder: next })
  }

  const isReorderDrag = (e: DragEvent): boolean =>
    e.dataTransfer.types.includes('dplex/activity-id')

  const handleDragStart = (e: DragEvent, id: ActivityBarId): void => {
    e.dataTransfer.setData('dplex/activity-id', id)
    e.dataTransfer.effectAllowed = 'move'
    setDragId(id)
  }

  const handleDragOver = (e: DragEvent, id: ActivityBarId): void => {
    if (!isReorderDrag(e)) return
    // Accept the drop; without preventDefault the browser rejects it.
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (id === dragId) {
      setDropTarget(null)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const after = e.clientY > rect.top + rect.height / 2
    setDropTarget((cur) => (cur?.id === id && cur.after === after ? cur : { id, after }))
  }

  const handleDragLeave = (id: ActivityBarId): void => {
    setDropTarget((cur) => (cur?.id === id ? null : cur))
  }

  const handleDrop = (e: DragEvent, targetId: ActivityBarId): void => {
    if (!isReorderDrag(e)) return
    e.preventDefault()
    const draggedId = (e.dataTransfer.getData('dplex/activity-id') || dragId) as ActivityBarId | ''
    const rect = e.currentTarget.getBoundingClientRect()
    const after = e.clientY > rect.top + rect.height / 2
    setDragId(null)
    setDropTarget(null)
    if (!draggedId || draggedId === targetId) return
    persistOrder(reorderActivityBar(order, draggedId, targetId, after ? 'after' : 'before'))
  }

  const handleDragEnd = (): void => {
    setDragId(null)
    setDropTarget(null)
  }

  const openMenu = (e: React.MouseEvent<HTMLButtonElement>, id: ActivityBarId): void => {
    e.preventDefault()
    menuAnchorRef.current = e.currentTarget
    setMenuId(id)
  }

  const moveItem = (id: ActivityBarId, dir: 'up' | 'down'): void => {
    const i = order.indexOf(id)
    const targetId = dir === 'up' ? order[i - 1] : order[i + 1]
    setMenuId(null)
    if (!targetId) return
    persistOrder(reorderActivityBar(order, id, targetId, dir === 'up' ? 'before' : 'after'))
  }

  const select = (id: ActivityBarId): void => {
    if (id === activeTab && !panelCollapsed) {
      // Click active item again → collapse the panel (VSCode behavior).
      updateSettings({ sidebarPanelCollapsed: true })
      return
    }
    updateSettings({ sidebarActiveTab: id, sidebarPanelCollapsed: false })
  }

  // Source-control change count for the active project.
  const byRepo = useGitPanelStore((s) => s.byRepo)
  const resolveActiveRoot = useGitPanelStore((s) => s.resolveActiveRoot)
  const activeProject = useProjectStore(
    (s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null
  )
  const gitCount = useMemo(() => {
    if (!activeProject) return 0
    const root = resolveActiveRoot(activeProject)
    return byRepo[root]?.files.length ?? 0
  }, [activeProject, byRepo, resolveActiveRoot])

  // Sessions attention dot — show whenever the inbox has any active events.
  const attentionCount = useAttentionStore((s) => s.active.length)

  // Spaces ring — pings when a backgrounded space needs a decision.
  const bgAttention = useBackgroundAttention()

  // Whether the focused editor tab is the Overview Dashboard.
  const dashboardActive = useTerminalStore((s) => {
    const group = s.groups.find((g) => g.id === s.activeGroupId)
    if (!group) return false
    const tab = group.tabs.find((t) => t.id === group.activeTabId)
    return !!tab && isDashboardTab(tab)
  })
  const openDashboard = useTerminalStore((s) => s.openOrFocusDashboardTab)

  return (
    <div
      role="tablist"
      aria-label="Sidebar views"
      className="flex flex-col items-center flex-shrink-0"
      style={{
        width: BAR_WIDTH,
        backgroundColor: 'var(--dplex-bg-activity)',
        borderRight: '1px solid var(--dplex-border-subtle)',
        paddingTop: 12,
        paddingBottom: 12
      }}
    >
      {/* Dashboard — an action (opens/focuses the dashboard tab), not a
          side-panel view. Sits above the view switches with its own divider. */}
      <button
        type="button"
        aria-label="Dashboard"
        aria-selected={dashboardActive}
        title="Dashboard"
        onClick={() => openDashboard()}
        data-testid="activity-bar-dashboard"
        className="relative grid place-items-center transition-colors"
        style={{
          width: 40,
          height: 40,
          marginBottom: 8,
          borderRadius: 10,
          color: dashboardActive ? 'var(--dplex-accent)' : 'var(--dplex-text-dim)',
          backgroundColor: dashboardActive ? 'var(--dplex-accent-soft)' : 'transparent'
        }}
        onMouseEnter={(e) => {
          if (!dashboardActive) {
            e.currentTarget.style.backgroundColor = 'var(--dplex-bg-elev)'
            e.currentTarget.style.color = 'var(--dplex-text-2)'
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = dashboardActive
            ? 'var(--dplex-accent-soft)'
            : 'transparent'
          e.currentTarget.style.color = dashboardActive
            ? 'var(--dplex-accent)'
            : 'var(--dplex-text-dim)'
        }}
      >
        <LayoutDashboard size={18} strokeWidth={1.8} />
      </button>
      <div
        aria-hidden
        style={{
          width: 24,
          height: 1,
          marginBottom: 8,
          backgroundColor: 'var(--dplex-border-subtle)'
        }}
      />
      {order.map((id) => {
        const { label, shortcut, Icon } = ITEM_BY_ID[id]
        const isActive = activeTab === id && !panelCollapsed
        const badge =
          id === 'git' && gitCount > 0 ? (gitCount > 99 ? '99+' : String(gitCount)) : null
        const showAttn = id === 'sessions' && attentionCount > 0
        const spacesAttnColor =
          id === 'spaces' && bgAttention.total > 0 && bgAttention.topKind
            ? attentionColorVar(bgAttention.topKind)
            : null
        const title = shortcut ? `${label} (${shortcut})` : label
        const isDragging = dragId === id
        const showInsertBefore = dropTarget?.id === id && !dropTarget.after
        const showInsertAfter = dropTarget?.id === id && dropTarget.after
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={label}
            title={title}
            draggable
            onClick={() => select(id)}
            onContextMenu={(e) => openMenu(e, id)}
            onDragStart={(e) => handleDragStart(e, id)}
            onDragOver={(e) => handleDragOver(e, id)}
            onDragLeave={() => handleDragLeave(id)}
            onDrop={(e) => handleDrop(e, id)}
            onDragEnd={handleDragEnd}
            data-testid={`activity-bar-${id}`}
            className="relative grid place-items-center transition-colors"
            style={{
              width: 40,
              height: 40,
              marginBottom: 4,
              borderRadius: 10,
              cursor: 'grab',
              opacity: isDragging ? 0.4 : 1,
              color: isActive ? 'var(--dplex-accent)' : 'var(--dplex-text-dim)',
              backgroundColor: isActive ? 'var(--dplex-accent-soft)' : 'transparent'
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.backgroundColor = 'var(--dplex-bg-elev)'
                e.currentTarget.style.color = 'var(--dplex-text-2)'
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = isActive
                ? 'var(--dplex-accent-soft)'
                : 'transparent'
              e.currentTarget.style.color = isActive
                ? 'var(--dplex-accent)'
                : 'var(--dplex-text-dim)'
            }}
          >
            {(showInsertBefore || showInsertAfter) && (
              <span
                data-testid={`activity-bar-${id}-drop`}
                aria-hidden
                className="absolute"
                style={{
                  left: 2,
                  right: 2,
                  height: 2,
                  borderRadius: 1,
                  top: showInsertBefore ? -3 : undefined,
                  bottom: showInsertAfter ? -3 : undefined,
                  backgroundColor: 'var(--dplex-accent)',
                  boxShadow: '0 0 8px var(--dplex-accent-glow)'
                }}
              />
            )}
            {isActive && (
              <span
                aria-hidden
                className="absolute"
                style={{
                  left: -8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 3,
                  height: 20,
                  borderRadius: '0 2px 2px 0',
                  backgroundColor: 'var(--dplex-accent)',
                  boxShadow: '0 0 12px var(--dplex-accent-glow)'
                }}
              />
            )}
            <Icon size={18} strokeWidth={1.8} />
            {badge && (
              <span
                data-testid={`activity-bar-${id}-badge`}
                className="absolute text-[9px] font-bold rounded-full tabular-nums"
                style={{
                  top: 2,
                  right: 2,
                  minWidth: 16,
                  height: 16,
                  padding: '0 4px',
                  lineHeight: '16px',
                  textAlign: 'center',
                  backgroundColor: 'var(--dplex-accent)',
                  color: 'var(--dplex-accent-fg)',
                  // Outline via box-shadow rather than border so the 16 × 16
                  // box stays purely for content; a 2 px border with
                  // box-sizing: border-box (Tailwind preflight default)
                  // would shrink the content area to 12 px and crop the
                  // glyph baseline. Drop the accent glow — a counter pill
                  // is informational, not status-y, and the active-tab
                  // stripe already owns the accent-glow vocabulary.
                  boxShadow: '0 0 0 2px var(--dplex-bg-activity)'
                }}
              >
                {badge}
              </span>
            )}
            {showAttn && !badge && (
              <span
                aria-hidden
                className="absolute dplex-pulse-dot"
                style={{
                  top: 5,
                  right: 5,
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  backgroundColor: 'var(--dplex-status-approval)',
                  boxShadow:
                    '0 0 0 2px var(--dplex-bg-activity), 0 0 8px var(--dplex-status-approval)'
                }}
              />
            )}
            {spacesAttnColor && (
              <span
                data-testid="activity-bar-spaces-attn"
                aria-hidden
                className="absolute dplex-pulse-dot"
                style={{
                  top: 5,
                  right: 5,
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  backgroundColor: spacesAttnColor,
                  boxShadow: `0 0 0 2px var(--dplex-bg-activity), 0 0 8px ${spacesAttnColor}`
                }}
              />
            )}
          </button>
        )
      })}
      {menuId && (
        <PopoverMenu
          anchorRef={menuAnchorRef}
          open
          onClose={() => setMenuId(null)}
          align="left"
          className="min-w-[150px]"
        >
          <button
            type="button"
            disabled={order.indexOf(menuId) === 0}
            onClick={() => moveItem(menuId, 'up')}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            style={{ color: 'var(--dplex-text)' }}
          >
            <ArrowUp size={11} /> Move up
          </button>
          <button
            type="button"
            disabled={order.indexOf(menuId) === order.length - 1}
            onClick={() => moveItem(menuId, 'down')}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            style={{ color: 'var(--dplex-text)' }}
          >
            <ArrowDown size={11} /> Move down
          </button>
        </PopoverMenu>
      )}
      <div className="flex-1" />
      <button
        type="button"
        aria-label="Settings"
        title={`Settings (${MOD},)`}
        onClick={onOpenSettings}
        data-testid="activity-bar-settings"
        className="grid place-items-center transition-colors"
        style={{
          width: 40,
          height: 40,
          marginTop: 4,
          borderRadius: 10,
          color: 'var(--dplex-text-dim)'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--dplex-bg-elev)'
          e.currentTarget.style.color = 'var(--dplex-text-2)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = 'var(--dplex-text-dim)'
        }}
      >
        <Settings size={18} strokeWidth={1.8} />
      </button>
    </div>
  )
}
