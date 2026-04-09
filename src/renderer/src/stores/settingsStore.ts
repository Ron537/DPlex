import { create } from 'zustand'
import type { AppSettings } from '../types'
import { getTheme } from '../services/themes'

// Read cached theme from localStorage synchronously to avoid flash
function getCachedTheme(): string {
  try {
    return localStorage.getItem('tplex-theme') || 'midnight'
  } catch {
    return 'midnight'
  }
}

function cacheTheme(themeId: string): void {
  try {
    localStorage.setItem('tplex-theme', themeId)
  } catch {
    // ignore
  }
}

// Apply CSS variables synchronously — called before React renders
export function applyCssVarsSync(themeId: string): void {
  const theme = getTheme(themeId)
  const root = document.documentElement
  root.style.setProperty('--tplex-bg', theme.ui.bg)
  root.style.setProperty('--tplex-bg-alt', theme.ui.bgAlt)
  root.style.setProperty('--tplex-border', theme.ui.border)
  root.style.setProperty('--tplex-text', theme.ui.text)
  root.style.setProperty('--tplex-text-muted', theme.ui.textMuted)
  root.style.setProperty('--tplex-accent', theme.ui.accent)
  document.body.style.backgroundColor = theme.ui.bg
}

const cachedTheme = getCachedTheme()

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
      const saved = await window.tplex.settings.getAll()
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
    await window.tplex.settings.setAll(newSettings)
  },

  toggleSidebar: () => {
    const current = get().settings
    set({ settings: { ...current, sidebarVisible: !current.sidebarVisible } })
  },

  setSidebarWidth: (width) => {
    const current = get().settings
    set({ settings: { ...current, sidebarWidth: width } })
  }
}))
