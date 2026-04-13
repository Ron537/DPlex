import { create } from 'zustand'
import type { AppSettings } from '../types'
import { getTheme } from '../services/themes'

// Read cached theme from localStorage synchronously to avoid flash
function getCachedTheme(): string {
  try {
    return localStorage.getItem('dplex-theme') || 'midnight'
  } catch {
    return 'midnight'
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
  document.body.style.backgroundColor = theme.ui.bg
}

const cachedTheme = getCachedTheme()

let sidebarWidthPersistTimer: ReturnType<typeof setTimeout> | null = null

const DEFAULT_SETTINGS: AppSettings = {
  defaultShell: '',
  defaultAITool: 'copilot-cli',
  fontSize: 14,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  theme: cachedTheme,
  sidebarWidth: 260,
  sidebarVisible: true,
  sessionPollIntervalMs: 5000
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
      const saved = await window.dplex.settings.getAll()
      const merged = { ...DEFAULT_SETTINGS, ...saved }
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
