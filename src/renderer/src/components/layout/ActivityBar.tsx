import { useMemo } from 'react'
import {
  FolderOpen,
  Clock,
  GitBranch,
  Settings,
  Search,
  Files,
  LayoutDashboard
} from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useGitPanelStore } from '../../stores/gitPanelStore'
import { useProjectStore } from '../../stores/projectStore'
import { useAttentionStore } from '../../stores/attentionStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { isDashboardTab } from '../../types'
import { MOD, SHIFT } from '../../utils/shortcuts'

type ActivityId = 'search' | 'projects' | 'sessions' | 'git' | 'explorer'

interface ActivityItem {
  id: ActivityId
  label: string
  shortcut?: string
  Icon: typeof FolderOpen
}

const ITEMS: ActivityItem[] = [
  { id: 'projects', label: 'Projects', Icon: FolderOpen },
  // Plain Clock matches the v2 mockup; reads as "recent / past sessions"
  // and stays visually distinct from the GitBranch "history" association.
  { id: 'sessions', label: 'Sessions', Icon: Clock },
  { id: 'explorer', label: 'Explorer', shortcut: `${MOD}${SHIFT}E`, Icon: Files },
  { id: 'git', label: 'Source Control', shortcut: `${MOD}${SHIFT}G`, Icon: GitBranch },
  { id: 'search', label: 'Search', shortcut: `${MOD}${SHIFT}F`, Icon: Search }
]

// v2 rail — wider footprint for the larger active-state stripe + glow.
const BAR_WIDTH = 56

interface ActivityBarProps {
  onOpenSettings: () => void
}

export function ActivityBar({ onOpenSettings }: ActivityBarProps): React.JSX.Element {
  const activeTab = useSettingsStore((s) => s.settings.sidebarActiveTab)
  const panelCollapsed = useSettingsStore((s) => s.settings.sidebarPanelCollapsed)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

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

  // Whether the focused editor tab is the Overview Dashboard.
  const dashboardActive = useTerminalStore((s) => {
    const group = s.groups.find((g) => g.id === s.activeGroupId)
    if (!group) return false
    const tab = group.tabs.find((t) => t.id === group.activeTabId)
    return !!tab && isDashboardTab(tab)
  })
  const openDashboard = useTerminalStore((s) => s.openOrFocusDashboardTab)

  const select = (id: ActivityId): void => {
    if (id === activeTab && !panelCollapsed) {
      // Click active item again → collapse the panel (VSCode behavior).
      updateSettings({ sidebarPanelCollapsed: true })
      return
    }
    updateSettings({ sidebarActiveTab: id, sidebarPanelCollapsed: false })
  }

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
        {dashboardActive && (
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
      {ITEMS.map(({ id, label, shortcut, Icon }) => {
        const isActive = activeTab === id && !panelCollapsed
        const badge =
          id === 'git' && gitCount > 0 ? (gitCount > 99 ? '99+' : String(gitCount)) : null
        const showAttn = id === 'sessions' && attentionCount > 0
        const title = shortcut ? `${label} (${shortcut})` : label
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={label}
            title={title}
            onClick={() => select(id)}
            data-testid={`activity-bar-${id}`}
            className="relative grid place-items-center transition-colors"
            style={{
              width: 40,
              height: 40,
              marginBottom: 4,
              borderRadius: 10,
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
          </button>
        )
      })}
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
