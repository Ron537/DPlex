import { useMemo } from 'react'
import { FolderOpen, History, GitBranch, Settings } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useGitPanelStore } from '../../stores/gitPanelStore'
import { useProjectStore } from '../../stores/projectStore'
import { useAttentionStore } from '../../stores/attentionStore'
import { MOD, SHIFT } from '../../utils/shortcuts'

type ActivityId = 'projects' | 'sessions' | 'git'

interface ActivityItem {
  id: ActivityId
  label: string
  shortcut?: string
  Icon: typeof FolderOpen
}

const ITEMS: ActivityItem[] = [
  { id: 'projects', label: 'Projects', Icon: FolderOpen },
  { id: 'sessions', label: 'Sessions', Icon: History },
  { id: 'git', label: 'Source Control', shortcut: `${MOD}${SHIFT}G`, Icon: GitBranch }
]

const BAR_WIDTH = 48

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
        backgroundColor: 'var(--dplex-activity-bar-bg)',
        borderRight: '1px solid var(--dplex-border)',
        paddingTop: 6,
        paddingBottom: 6
      }}
    >
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
              margin: '2px 0',
              borderRadius: 6,
              color: isActive ? 'var(--dplex-text)' : 'var(--dplex-text-muted)',
              backgroundColor: 'transparent'
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.backgroundColor = 'var(--dplex-hover)'
                e.currentTarget.style.color = 'var(--dplex-text)'
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent'
              if (!isActive) e.currentTarget.style.color = 'var(--dplex-text-muted)'
            }}
          >
            {isActive && (
              <span
                aria-hidden
                className="absolute"
                style={{
                  left: -4,
                  top: 6,
                  bottom: 6,
                  width: 2,
                  borderRadius: '0 2px 2px 0',
                  backgroundColor: 'var(--dplex-accent)'
                }}
              />
            )}
            <Icon size={20} strokeWidth={1.8} />
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
                  color: 'var(--dplex-bg)',
                  boxShadow: '0 0 0 2px var(--dplex-activity-bar-bg)'
                }}
              >
                {badge}
              </span>
            )}
            {showAttn && !badge && (
              <span
                aria-hidden
                className="absolute"
                style={{
                  top: 5,
                  right: 5,
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  backgroundColor: 'var(--dplex-status-waiting)',
                  boxShadow: '0 0 0 2px var(--dplex-activity-bar-bg)'
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
          margin: '2px 0',
          borderRadius: 6,
          color: 'var(--dplex-text-muted)'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--dplex-hover)'
          e.currentTarget.style.color = 'var(--dplex-text)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = 'var(--dplex-text-muted)'
        }}
      >
        <Settings size={20} strokeWidth={1.8} />
      </button>
    </div>
  )
}
