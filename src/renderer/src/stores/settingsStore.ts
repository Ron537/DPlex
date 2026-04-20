import { create } from 'zustand'
import type { AppSettings, WorktreeDefaults } from '../types'
import { getTheme } from '../services/themes'

// Read cached theme from localStorage synchronously to avoid flash
function getCachedTheme(): string {
  try {
    return localStorage.getItem('dplex-theme') || 'dplex'
  } catch {
    return 'dplex'
  }
}

function cacheTheme(themeId: string): void {
  try {
    localStorage.setItem('dplex-theme', themeId)
  } catch {
    // ignore
  }
}

// Apply CSS variables synchronously — called before React renders
export function applyCssVarsSync(themeId: string): void {
  const theme = getTheme(themeId)
  const root = document.documentElement
  root.style.setProperty('--dplex-bg', theme.ui.bg)
  root.style.setProperty('--dplex-bg-alt', theme.ui.bgAlt)
  root.style.setProperty('--dplex-border', theme.ui.border)
  root.style.setProperty('--dplex-text', theme.ui.text)
  root.style.setProperty('--dplex-text-muted', theme.ui.textMuted)
  root.style.setProperty('--dplex-accent', theme.ui.accent)
  root.style.setProperty('--dplex-hover', theme.ui.hover || 'rgba(255,255,255,0.1)')
  root.style.setProperty('--dplex-scrollbar', theme.ui.scrollbar || 'rgba(255,255,255,0.15)')
  root.style.setProperty('--dplex-scrollbar-hover', theme.ui.scrollbarHover || 'rgba(255,255,255,0.25)')

  // Status colors — adapted for contrast on light vs dark backgrounds
  const isLight = theme.variant === 'light'
  root.style.setProperty('--dplex-status-idle', isLight ? '#9ca3af' : '#6b7280')
  root.style.setProperty('--dplex-status-thinking', isLight ? '#2563eb' : '#3b82f6')
  root.style.setProperty('--dplex-status-executing', isLight ? '#d97706' : '#f59e0b')
  root.style.setProperty('--dplex-status-approval', isLight ? '#dc2626' : '#ef4444')
  root.style.setProperty('--dplex-status-waiting', isLight ? '#16a34a' : '#22c55e')
  root.style.setProperty('--dplex-status-active', isLight ? '#16a34a' : '#22c55e')
  root.style.setProperty('--dplex-status-active-bg', isLight ? 'rgba(22,163,74,0.12)' : 'rgba(34,197,94,0.12)')

  document.body.style.backgroundColor = theme.ui.bg
  // Tell the browser to render native form controls (checkboxes, radios, ranges,
  // time inputs, scrollbars) in the matching light/dark mode.
  root.style.colorScheme = isLight ? 'light' : 'dark'
}

const cachedTheme = getCachedTheme()

let sidebarWidthPersistTimer: ReturnType<typeof setTimeout> | null = null

export const DEFAULT_WORKTREE_DEFAULTS: WorktreeDefaults = {
  locationPattern: '../{project}-{branch}',
  envFiles: ['.env', '.env.local', '.env.*.local'],
  setupScript: '',
  afterCreate: 'session'
}

const DEFAULT_SETTINGS: AppSettings = {
  defaultShell: '',
  defaultAITool: 'copilot-cli',
  fontSize: 14,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  theme: cachedTheme,
  sidebarWidth: 260,
  sidebarVisible: true,
  sessionPollIntervalMs: 5000,
  sessionMaxAgeDays: 7,
  notificationsEnabled: true,
  notifyOnApproval: true,
  notifyOnInput: true,
  notifyOnFinished: true,
  notifyOnlyWhenUnfocused: true,
  notificationSound: false,
  dndFrom: null,
  dndTo: null,
  notificationCooldownSeconds: 30,
  idleTooLongMinutes: 5,
  worktreeDefaults: DEFAULT_WORKTREE_DEFAULTS
}

interface SettingsState {
  settings: AppSettings
  loaded: boolean
  loadSettings: () => Promise<void>
  updateSettings: (partial: Partial<AppSettings>) => Promise<void>
  toggleSidebar: () => void
  setSidebarWidth: (width: number) => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  loadSettings: async () => {
    try {
      const saved = (await window.dplex.settings.getAll()) as Partial<AppSettings>
      const merged: AppSettings = {
        ...DEFAULT_SETTINGS,
        ...saved,
        worktreeDefaults: {
          ...DEFAULT_WORKTREE_DEFAULTS,
          ...(saved.worktreeDefaults ?? {})
        }
      }
      set({ settings: merged, loaded: true })
      cacheTheme(merged.theme)
    } catch {
      set({ loaded: true })
    }
  },

  updateSettings: async (partial) => {
    const newSettings = { ...get().settings, ...partial }
    set({ settings: newSettings })
    if (partial.theme) cacheTheme(partial.theme)
    // Atomic merge — avoids read-modify-write race with projectStore
    await window.dplex.settings.merge(partial)
  },

  toggleSidebar: () => {
    const current = get().settings
    const next = !current.sidebarVisible
    set({ settings: { ...current, sidebarVisible: next } })
    get().updateSettings({ sidebarVisible: next })
  },

  setSidebarWidth: (width) => {
    const current = get().settings
    set({ settings: { ...current, sidebarWidth: width } })
    // Debounced persist — called on every pixel during resize
    if (sidebarWidthPersistTimer) clearTimeout(sidebarWidthPersistTimer)
    sidebarWidthPersistTimer = setTimeout(() => {
      get().updateSettings({ sidebarWidth: width })
    }, 500)
  }
}))
