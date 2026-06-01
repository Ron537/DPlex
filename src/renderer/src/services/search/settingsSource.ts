import { createElement } from 'react'
import {
  Palette,
  Terminal,
  Type,
  Bot,
  Clock,
  EyeOff,
  ListOrdered,
  Layers,
  Bell,
  BellRing,
  Focus,
  Volume2,
  Moon,
  Timer,
  AlarmClockOff,
  FolderTree,
  FileCog,
  Play,
  Rocket,
  Info,
  Settings as SettingsIcon
} from 'lucide-react'
import type { SearchItem, SearchSource, SettingsTab } from './types'
import { dispatchOpenSettings } from '../../utils/openSettings'

/** Lucide icon component shape — every icon in `lucide-react` matches it. */
type IconComponent = typeof SettingsIcon

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
  /** Per-row icon for the global search palette. Defaults to gear when
   *  omitted (used as a fallback for any unmapped entries). */
  Icon?: IconComponent
}

export const SETTINGS_ENTRIES: readonly SettingsEntry[] = [
  // Appearance
  {
    id: 'theme',
    label: 'Theme',
    description: 'Color theme for the app and terminal',
    tab: 'appearance',
    keywords: ['color', 'dark', 'light', 'palette', 'appearance'],
    Icon: Palette
  },
  // Terminal
  {
    id: 'default-shell',
    label: 'Default Shell',
    description: 'Shell used when opening new terminals',
    tab: 'terminal',
    keywords: ['bash', 'zsh', 'pwsh', 'powershell', 'fish', 'cmd'],
    Icon: Terminal
  },
  {
    id: 'font-size',
    label: 'Font Size',
    description: 'Terminal font size in pixels',
    tab: 'terminal',
    keywords: ['text', 'size', 'zoom'],
    Icon: Type
  },
  {
    id: 'font-family',
    label: 'Font Family',
    description: 'Terminal font family',
    tab: 'terminal',
    keywords: ['font', 'monospace', 'typeface'],
    Icon: Type
  },
  // AI Tools
  {
    id: 'default-ai-tool',
    label: 'Default AI Tool',
    description: 'AI CLI tool used for new sessions',
    tab: 'ai-tools',
    keywords: ['copilot', 'claude', 'provider', 'cli'],
    Icon: Bot
  },
  {
    id: 'session-max-age',
    label: 'Session Max Age',
    description: 'Hide sessions older than this many days',
    tab: 'ai-tools',
    keywords: ['cleanup', 'history', 'days', 'old'],
    Icon: Clock
  },
  {
    id: 'hide-empty-sessions',
    label: 'Hide empty sessions',
    description: 'Hide idle sessions with no messages yet',
    tab: 'ai-tools',
    keywords: ['empty', 'idle', 'filter'],
    Icon: EyeOff
  },
  {
    id: 'recent-sessions-in-projects',
    label: 'Recent sessions in projects',
    description: 'Show recent sessions inline in each project',
    tab: 'ai-tools',
    keywords: ['inline', 'project panel', 'expand'],
    Icon: Layers
  },
  {
    id: 'recent-sessions-count',
    label: 'Recent sessions count',
    description: 'How many recent sessions per project',
    tab: 'ai-tools',
    keywords: ['count', 'limit'],
    Icon: ListOrdered
  },
  // Notifications
  {
    id: 'notifications-enabled',
    label: 'Enable notifications',
    description: 'Master toggle for desktop notifications',
    tab: 'notifications',
    keywords: ['alerts', 'desktop', 'notify'],
    Icon: Bell
  },
  {
    id: 'notify-events',
    label: 'Notify me about',
    description: 'Approval, input, finished events',
    tab: 'notifications',
    keywords: ['approval', 'input', 'finished', 'events'],
    Icon: BellRing
  },
  {
    id: 'notify-only-unfocused',
    label: 'Only when unfocused',
    description: 'Suppress notifications while the window is focused',
    tab: 'notifications',
    keywords: ['focus', 'background', 'foreground'],
    Icon: Focus
  },
  {
    id: 'notify-sound',
    label: 'Play sound',
    description: 'Use the OS default sound for notifications',
    tab: 'notifications',
    keywords: ['audio', 'beep', 'chime'],
    Icon: Volume2
  },
  {
    id: 'do-not-disturb',
    label: 'Do not disturb',
    description: 'Quiet-hours window for notifications',
    tab: 'notifications',
    keywords: ['dnd', 'quiet', 'mute', 'hours', 'schedule'],
    Icon: Moon
  },
  {
    id: 'notify-cooldown',
    label: 'Notification cooldown',
    description: 'Minimum delay between notifications for the same session',
    tab: 'notifications',
    keywords: ['rate limit', 'throttle', 'spam'],
    Icon: Timer
  },
  {
    id: 'idle-escalation',
    label: 'Idle escalation',
    description: 'Re-notify after a waiting session is idle for this long',
    tab: 'notifications',
    keywords: ['re-notify', 'reminder', 'idle'],
    Icon: AlarmClockOff
  },
  // Worktrees
  {
    id: 'worktree-location-pattern',
    label: 'Worktree location pattern',
    description: 'Where new worktrees are created',
    tab: 'worktrees',
    keywords: ['path', 'location', 'directory', 'project', 'branch'],
    Icon: FolderTree
  },
  {
    id: 'worktree-env-files',
    label: 'Env files to copy',
    description: 'Files copied into new worktrees',
    tab: 'worktrees',
    keywords: ['.env', 'environment', 'config', 'secrets'],
    Icon: FileCog
  },
  {
    id: 'worktree-setup-script',
    label: 'Setup script',
    description: 'Shell script run after creating a worktree',
    tab: 'worktrees',
    keywords: ['script', 'install', 'bootstrap', 'post-create'],
    Icon: Play
  },
  {
    id: 'worktree-after-create',
    label: 'After creation',
    description: 'What to do once a worktree is ready',
    tab: 'worktrees',
    keywords: ['session', 'terminal', 'open'],
    Icon: Rocket
  },
  // About
  {
    id: 'about-version',
    label: 'About DPlex',
    description: 'Version info and update controls',
    tab: 'about',
    keywords: ['version', 'update', 'check for updates', 'release'],
    Icon: Info
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
      icon: tintedIcon(entry.Icon ?? SettingsIcon),
      run: () => openSettingsAt(entry)
    }))
  }
}

/** Settings rows wrap their lucide icon in a neutral tinted square so the
 *  palette stays visually consistent with the commands group. */
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
        backgroundColor: 'var(--dplex-bg-elev-2)',
        color: 'var(--dplex-text-muted)',
        border: '1px solid var(--dplex-border)',
        flex: 'none'
      }
    },
    createElement(Icon, { size: 13, strokeWidth: 2 })
  )
}
