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
  root.style.setProperty('--dplex-bg-panel', theme.ui.bgPanel ?? theme.ui.bgAlt)
  root.style.setProperty('--dplex-bg-elev', theme.ui.bgElev ?? theme.ui.bgAlt)
  root.style.setProperty('--dplex-border', theme.ui.border)
  root.style.setProperty('--dplex-border-strong', theme.ui.borderStrong ?? theme.ui.border)
  root.style.setProperty('--dplex-text', theme.ui.text)
  root.style.setProperty('--dplex-text-muted', theme.ui.textMuted)
  root.style.setProperty('--dplex-text-dim', theme.ui.textDim ?? theme.ui.textMuted)
  root.style.setProperty('--dplex-accent', theme.ui.accent)
  root.style.setProperty('--dplex-accent-2', theme.ui.accent2 ?? theme.ui.accent)
  root.style.setProperty('--dplex-accent-soft', hexToRgba(theme.ui.accent, 0.14))
  root.style.setProperty('--dplex-hover', theme.ui.hover || 'rgba(255,255,255,0.04)')
  root.style.setProperty('--dplex-scrollbar', theme.ui.scrollbar || 'rgba(255,255,255,0.15)')
  root.style.setProperty(
    '--dplex-scrollbar-hover',
    theme.ui.scrollbarHover || 'rgba(255,255,255,0.25)'
  )

  // Status colors — adapted for contrast on light vs dark backgrounds.
  // Each token must remain visually distinct from every other token in
  // both variants. The dark hues match the soft-pill rules in main.css.
  const isLight = theme.variant === 'light'
  root.style.setProperty('--dplex-status-idle', isLight ? '#9ca3af' : '#8a8a99')
  root.style.setProperty('--dplex-status-thinking', isLight ? '#2563eb' : '#60a5fa')
  root.style.setProperty('--dplex-status-executing', isLight ? '#16a34a' : '#4ade80')
  root.style.setProperty('--dplex-status-approval', isLight ? '#dc2626' : '#f87171')
  root.style.setProperty('--dplex-status-waiting', isLight ? '#d97706' : '#f59e0b')
  root.style.setProperty('--dplex-status-active', isLight ? '#16a34a' : '#4ade80')
  root.style.setProperty(
    '--dplex-status-active-bg',
    isLight ? 'rgba(22,163,74,0.12)' : 'rgba(74,222,128,0.12)'
  )

  document.body.style.backgroundColor = theme.ui.bg
  // Tell the browser to render native form controls (checkboxes, radios, ranges,
  // time inputs, scrollbars) in the matching light/dark mode.
  root.style.colorScheme = isLight ? 'light' : 'dark'
}

/**
 * Best-effort color → rgba() with the supplied alpha. Accepts #rgb, #rrggbb,
 * `rgb(r,g,b)`, or `rgba(r,g,b,a)`. The supplied `alpha` always wins —
 * any alpha encoded in an input `rgba(...)` string is overridden so callers
 * get the requested opacity regardless of the theme token's source format.
 * Used to derive the soft accent tint from any theme's accent color.
 */
function hexToRgba(color: string, alpha: number): string {
  const trimmed = color.trim()
  // rgb()/rgba() passthrough — re-emit with the requested alpha.
  const rgbMatch = trimmed.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/i
  )
  if (rgbMatch) {
    return `rgba(${rgbMatch[1]},${rgbMatch[2]},${rgbMatch[3]},${alpha})`
  }
  const hex = trimmed.replace(/^#/, '')
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16)
    const g = parseInt(hex[1] + hex[1], 16)
    const b = parseInt(hex[2] + hex[2], 16)
    return `rgba(${r},${g},${b},${alpha})`
  }
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    return `rgba(${r},${g},${b},${alpha})`
  }
  return color
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
  sidebarActiveTab: 'projects',
  sidebarPanelCollapsed: false,
  sessionPollIntervalMs: 5000,
  sessionMaxAgeDays: 7,
  hideEmptySessions: true,
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
  worktreeDefaults: DEFAULT_WORKTREE_DEFAULTS,
  projectPanelShowFooter: true,
  gitPanel: {
    open: false,
    width: 300,
    sectionCollapse: { changes: false }
  }
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
        },
        gitPanel: {
          ...DEFAULT_SETTINGS.gitPanel,
          ...(saved.gitPanel ?? {}),
          sectionCollapse: {
            ...DEFAULT_SETTINGS.gitPanel.sectionCollapse,
            ...(saved.gitPanel?.sectionCollapse ?? {})
          }
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
    const next = !current.sidebarPanelCollapsed
    set({ settings: { ...current, sidebarPanelCollapsed: next } })
    get().updateSettings({ sidebarPanelCollapsed: next })
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
