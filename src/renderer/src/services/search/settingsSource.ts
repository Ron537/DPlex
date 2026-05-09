import type { SearchItem, SearchSource, SettingsTab } from './types'
import { dispatchOpenSettings } from '../../utils/openSettings'

/** Curated list of settings rows surfaced by the global search. The `id`
 *  field must match a `data-setting-id` attribute on the corresponding
 *  `<SettingItem>` in `SettingsModal.tsx` so the modal can scroll the row
 *  into view and pulse-highlight it. */
export interface SettingsEntry {
  id: string
  label: string
  description?: string
  tab: SettingsTab
  keywords?: string[]
}

export const SETTINGS_ENTRIES: readonly SettingsEntry[] = [
  // Appearance
  {
    id: 'theme',
    label: 'Theme',
    description: 'Color theme for the app and terminal',
    tab: 'appearance',
    keywords: ['color', 'dark', 'light', 'palette', 'appearance']
  },
  // Terminal
  {
    id: 'default-shell',
    label: 'Default Shell',
    description: 'Shell used when opening new terminals',
    tab: 'terminal',
    keywords: ['bash', 'zsh', 'pwsh', 'powershell', 'fish', 'cmd']
  },
  {
    id: 'font-size',
    label: 'Font Size',
    description: 'Terminal font size in pixels',
    tab: 'terminal',
    keywords: ['text', 'size', 'zoom']
  },
  {
    id: 'font-family',
    label: 'Font Family',
    description: 'Terminal font family',
    tab: 'terminal',
    keywords: ['font', 'monospace', 'typeface']
  },
  // AI Tools
  {
    id: 'default-ai-tool',
    label: 'Default AI Tool',
    description: 'AI CLI tool used for new sessions',
    tab: 'ai-tools',
    keywords: ['copilot', 'claude', 'provider', 'cli']
  },
  {
    id: 'session-max-age',
    label: 'Session Max Age',
    description: 'Hide sessions older than this many days',
    tab: 'ai-tools',
    keywords: ['cleanup', 'history', 'days', 'old']
  },
  {
    id: 'hide-empty-sessions',
    label: 'Hide empty sessions',
    description: 'Hide idle sessions with no messages yet',
    tab: 'ai-tools',
    keywords: ['empty', 'idle', 'filter']
  },
  {
    id: 'recent-sessions-in-projects',
    label: 'Recent sessions in projects',
    description: 'Show recent sessions inline in each project',
    tab: 'ai-tools',
    keywords: ['inline', 'project panel', 'expand']
  },
  {
    id: 'recent-sessions-count',
    label: 'Recent sessions count',
    description: 'How many recent sessions per project',
    tab: 'ai-tools',
    keywords: ['count', 'limit']
  },
  // Notifications
  {
    id: 'notifications-enabled',
    label: 'Enable notifications',
    description: 'Master toggle for desktop notifications',
    tab: 'notifications',
    keywords: ['alerts', 'desktop', 'notify']
  },
  {
    id: 'notify-events',
    label: 'Notify me about',
    description: 'Approval, input, finished events',
    tab: 'notifications',
    keywords: ['approval', 'input', 'finished', 'events']
  },
  {
    id: 'notify-only-unfocused',
    label: 'Only when unfocused',
    description: 'Suppress notifications while the window is focused',
    tab: 'notifications',
    keywords: ['focus', 'background', 'foreground']
  },
  {
    id: 'notify-sound',
    label: 'Play sound',
    description: 'Use the OS default sound for notifications',
    tab: 'notifications',
    keywords: ['audio', 'beep', 'chime']
  },
  {
    id: 'do-not-disturb',
    label: 'Do not disturb',
    description: 'Quiet-hours window for notifications',
    tab: 'notifications',
    keywords: ['dnd', 'quiet', 'mute', 'hours', 'schedule']
  },
  {
    id: 'notify-cooldown',
    label: 'Notification cooldown',
    description: 'Minimum delay between notifications for the same session',
    tab: 'notifications',
    keywords: ['rate limit', 'throttle', 'spam']
  },
  {
    id: 'idle-escalation',
    label: 'Idle escalation',
    description: 'Re-notify after a waiting session is idle for this long',
    tab: 'notifications',
    keywords: ['re-notify', 'reminder', 'idle']
  },
  // Worktrees
  {
    id: 'worktree-location-pattern',
    label: 'Worktree location pattern',
    description: 'Where new worktrees are created',
    tab: 'worktrees',
    keywords: ['path', 'location', 'directory', 'project', 'branch']
  },
  {
    id: 'worktree-env-files',
    label: 'Env files to copy',
    description: 'Files copied into new worktrees',
    tab: 'worktrees',
    keywords: ['.env', 'environment', 'config', 'secrets']
  },
  {
    id: 'worktree-setup-script',
    label: 'Setup script',
    description: 'Shell script run after creating a worktree',
    tab: 'worktrees',
    keywords: ['script', 'install', 'bootstrap', 'post-create']
  },
  {
    id: 'worktree-after-create',
    label: 'After creation',
    description: 'What to do once a worktree is ready',
    tab: 'worktrees',
    keywords: ['session', 'terminal', 'open']
  },
  // About
  {
    id: 'about-version',
    label: 'About DPlex',
    description: 'Version info and update controls',
    tab: 'about',
    keywords: ['version', 'update', 'check for updates', 'release']
  }
]

function openSettingsAt(entry: SettingsEntry): void {
  // Defer slightly so the modal mounts before scrolling.
  dispatchOpenSettings({ section: entry.tab, highlightId: entry.id })
}

export const settingsSource: SearchSource = {
  category: 'settings',
  // Settings are static — `ctx` is unused but kept for the SearchSource shape.
  getItems: (): SearchItem[] => {
    return SETTINGS_ENTRIES.map((entry) => ({
      id: `setting:${entry.id}`,
      category: 'settings',
      label: entry.label,
      description: entry.description,
      keywords: entry.keywords,
      run: () => openSettingsAt(entry)
    }))
  }
}
