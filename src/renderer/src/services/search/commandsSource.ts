import type { SearchItem, SearchSource } from './types'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useProjectStore } from '../../stores/projectStore'
import { dispatchOpenSettings } from '../../utils/openSettings'
import { MOD, SHIFT } from '../../utils/shortcuts'

interface CommandEntry {
  id: string
  label: string
  description?: string
  shortcut?: string
  keywords?: string[]
  run: () => void | Promise<void>
}

const COMMANDS: readonly CommandEntry[] = [
  {
    id: 'add-project',
    label: 'Add Project',
    description: 'Pick a folder and add it to the Projects panel',
    keywords: ['new', 'folder', 'open', 'create'],
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
    run: () => {
      useSettingsStore.getState().toggleSidebar()
    }
  },
  {
    id: 'show-projects',
    label: 'Show Projects',
    description: 'Reveal the Projects view in the sidebar',
    keywords: ['focus', 'view'],
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
    run: () => {
      dispatchOpenSettings({ section: 'notifications', highlightId: 'notifications-enabled' })
    }
  },
  {
    id: 'refresh-sessions',
    label: 'Refresh Sessions',
    description: 'Re-scan AI session history from disk',
    keywords: ['reload', 'rescan'],
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
      run: c.run
    }))
  }
}
