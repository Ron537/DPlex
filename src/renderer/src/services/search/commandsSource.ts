import { createElement } from 'react'
import {
  ChevronRight,
  FolderPlus,
  Plus as PlusIcon,
  X as XIcon,
  SplitSquareHorizontal,
  SplitSquareVertical,
  PanelLeft,
  FolderOpen,
  Clock,
  GitBranch,
  Search as SearchIcon,
  Settings as SettingsIcon,
  BellRing,
  RefreshCw
} from 'lucide-react'
import type { SearchItem, SearchSource } from './types'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useProjectStore } from '../../stores/projectStore'
import { dispatchOpenSettings } from '../../utils/openSettings'
import { MOD, SHIFT } from '../../utils/shortcuts'

/** Lucide icon component shape — every icon in `lucide-react` matches it. */
type IconComponent = typeof ChevronRight

interface CommandEntry {
  id: string
  label: string
  description?: string
  shortcut?: string
  keywords?: string[]
  /** Per-command lucide icon so each row has a distinct visual identity. */
  Icon: IconComponent
  run: () => void | Promise<void>
}

const COMMANDS: readonly CommandEntry[] = [
  {
    id: 'add-project',
    label: 'Add Project',
    description: 'Pick a folder and add it to the Projects panel',
    keywords: ['new', 'folder', 'open', 'create'],
    Icon: FolderPlus,
    run: () => {
      void useProjectStore.getState().addProject()
    }
  },
  {
    id: 'new-terminal',
    label: 'New Terminal',
    description: 'Open a new shell terminal',
    shortcut: `${MOD}T`,
    keywords: ['shell', 'open', 'create'],
    Icon: PlusIcon,
    run: () => {
      const ts = useTerminalStore.getState()
      ts.createTerminal(ts.activeGroupId ?? undefined)
    }
  },
  {
    id: 'close-terminal',
    label: 'Close Active Terminal',
    description: 'Close the currently focused terminal tab',
    shortcut: `${MOD}W`,
    keywords: ['kill', 'tab'],
    Icon: XIcon,
    run: () => {
      const ts = useTerminalStore.getState()
      const group = ts.groups.find((g) => g.id === ts.activeGroupId)
      if (group) ts.closeTerminal(group.activeTabId)
    }
  },
  {
    id: 'split-right',
    label: 'Split Editor Right',
    description: 'Split the active group horizontally',
    shortcut: `${MOD}\\`,
    keywords: ['split', 'horizontal', 'pane'],
    Icon: SplitSquareHorizontal,
    run: () => {
      const ts = useTerminalStore.getState()
      if (ts.activeGroupId) ts.splitGroup(ts.activeGroupId, 'horizontal')
    }
  },
  {
    id: 'split-down',
    label: 'Split Editor Down',
    description: 'Split the active group vertically',
    shortcut: `${MOD}${SHIFT}\\`,
    keywords: ['split', 'vertical', 'pane'],
    Icon: SplitSquareVertical,
    run: () => {
      const ts = useTerminalStore.getState()
      if (ts.activeGroupId) ts.splitGroup(ts.activeGroupId, 'vertical')
    }
  },
  {
    id: 'toggle-sidebar',
    label: 'Toggle Sidebar',
    description: 'Show or hide the side panel',
    shortcut: `${MOD}B`,
    keywords: ['hide', 'show', 'panel'],
    Icon: PanelLeft,
    run: () => {
      useSettingsStore.getState().toggleSidebar()
    }
  },
  {
    id: 'show-projects',
    label: 'Show Projects',
    description: 'Reveal the Projects view in the sidebar',
    keywords: ['focus', 'view'],
    Icon: FolderOpen,
    run: () => {
      useSettingsStore
        .getState()
        .updateSettings({ sidebarActiveTab: 'projects', sidebarPanelCollapsed: false })
    }
  },
  {
    id: 'show-sessions',
    label: 'Show Sessions',
    description: 'Reveal the Sessions view in the sidebar',
    keywords: ['focus', 'view'],
    Icon: Clock,
    run: () => {
      useSettingsStore
        .getState()
        .updateSettings({ sidebarActiveTab: 'sessions', sidebarPanelCollapsed: false })
    }
  },
  {
    id: 'show-source-control',
    label: 'Show Source Control',
    description: 'Reveal the Source Control (Git) view',
    shortcut: `${MOD}${SHIFT}G`,
    keywords: ['git', 'changes', 'diff', 'view'],
    Icon: GitBranch,
    run: () => {
      useSettingsStore
        .getState()
        .updateSettings({ sidebarActiveTab: 'git', sidebarPanelCollapsed: false })
    }
  },
  {
    id: 'show-search',
    label: 'Show Search',
    description: 'Reveal the global Search view in the sidebar',
    keywords: ['find', 'view'],
    Icon: SearchIcon,
    run: () => {
      useSettingsStore
        .getState()
        .updateSettings({ sidebarActiveTab: 'search', sidebarPanelCollapsed: false })
    }
  },
  {
    id: 'open-settings',
    label: 'Open Settings',
    description: 'Open the Settings window',
    shortcut: `${MOD},`,
    keywords: ['preferences', 'config', 'options'],
    Icon: SettingsIcon,
    run: () => {
      dispatchOpenSettings()
    }
  },
  {
    id: 'open-notification-settings',
    label: 'Notification Settings',
    description: 'Open Settings on the Notifications tab',
    keywords: [
      'enable notifications',
      'disable notifications',
      'alerts',
      'sound',
      'do not disturb',
      'dnd',
      'desktop'
    ],
    Icon: BellRing,
    run: () => {
      dispatchOpenSettings({ section: 'notifications', highlightId: 'notifications-enabled' })
    }
  },
  {
    id: 'refresh-sessions',
    label: 'Refresh Sessions',
    description: 'Re-scan AI session history from disk',
    keywords: ['reload', 'rescan'],
    Icon: RefreshCw,
    run: () => {
      void useSessionStore.getState().refreshSessions()
    }
  }
]

export const commandsSource: SearchSource = {
  category: 'commands',
  // Commands are static — `ctx` is unused but kept for the SearchSource shape.
  getItems: (): SearchItem[] => {
    return COMMANDS.map((c) => ({
      id: `command:${c.id}`,
      category: 'commands',
      label: c.label,
      description: c.description,
      hint: c.shortcut,
      keywords: c.keywords,
      icon: tintedIcon(c.Icon),
      run: c.run
    }))
  }
}

/** Wraps a lucide icon in an accent-tinted square. Same footprint as
 *  every other search-row icon so column rhythm stays aligned. */
function tintedIcon(Icon: IconComponent): React.JSX.Element {
  return createElement(
    'span',
    {
      'aria-hidden': true,
      style: {
        display: 'grid',
        placeItems: 'center',
        width: 24,
        height: 24,
        borderRadius: 7,
        backgroundColor: 'var(--dplex-accent-soft)',
        color: 'var(--dplex-accent)',
        border: '1px solid var(--dplex-accent-ring)',
        flex: 'none'
      }
    },
    createElement(Icon, { size: 13, strokeWidth: 2 })
  )
}
