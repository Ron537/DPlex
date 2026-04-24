import { FolderKanban, MessagesSquare, Settings } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'

type SidebarTab = 'projects' | 'sessions'

interface ActivityBarProps {
  onOpenSettings: () => void
}

const ACTIVITY_BAR_WIDTH = 52
const BUTTON_HEIGHT = 48

export function ActivityBar({ onOpenSettings }: ActivityBarProps): React.JSX.Element {
  const activeTab = useSettingsStore((s) => s.settings.sidebarActiveTab)
  const collapsed = useSettingsStore((s) => s.settings.sidebarPanelCollapsed)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  const handleTabClick = (tab: SidebarTab): void => {
    if (tab === activeTab) {
      // Click active icon → toggle panel collapsed state
      updateSettings({ sidebarPanelCollapsed: !collapsed })
    } else {
      // Click different icon → switch tab; uncollapse if collapsed
      updateSettings({
        sidebarActiveTab: tab,
        sidebarPanelCollapsed: false
      })
    }
  }

  const buttonStyle = (active: boolean): React.CSSProperties => ({
    width: ACTIVITY_BAR_WIDTH,
    height: BUTTON_HEIGHT,
    color: active && !collapsed ? 'var(--dplex-text)' : 'var(--dplex-text-muted)',
    position: 'relative'
  })

  return (
    <div
      className="flex flex-col items-center flex-shrink-0 gap-0.5 pt-1"
      style={{
        width: ACTIVITY_BAR_WIDTH,
        backgroundColor: 'var(--dplex-bg)',
        borderRight: '1px solid var(--dplex-border)'
      }}
    >
      <button
        onClick={() => handleTabClick('projects')}
        className="flex items-center justify-center hover:text-[var(--dplex-text)] transition-colors cursor-pointer"
        style={buttonStyle(activeTab === 'projects')}
        title="Projects"
      >
        {activeTab === 'projects' && !collapsed && (
          <span
            className="absolute left-0 top-0 bottom-0"
            style={{ width: 2, backgroundColor: 'var(--dplex-accent)' }}
          />
        )}
        <FolderKanban size={22} />
      </button>

      <button
        onClick={() => handleTabClick('sessions')}
        className="flex items-center justify-center hover:text-[var(--dplex-text)] transition-colors cursor-pointer"
        style={buttonStyle(activeTab === 'sessions')}
        title="Sessions"
      >
        {activeTab === 'sessions' && !collapsed && (
          <span
            className="absolute left-0 top-0 bottom-0"
            style={{ width: 2, backgroundColor: 'var(--dplex-accent)' }}
          />
        )}
        <MessagesSquare size={22} />
      </button>

      <div className="flex-1" />

      <button
        onClick={onOpenSettings}
        className="flex items-center justify-center hover:text-[var(--dplex-text)] transition-colors cursor-pointer"
        style={{
          width: ACTIVITY_BAR_WIDTH,
          height: BUTTON_HEIGHT,
          color: 'var(--dplex-text-muted)'
        }}
        title="Settings"
      >
        <Settings size={22} />
      </button>
    </div>
  )
}
