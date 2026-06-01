import { useEffect, useCallback } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { ProviderIconSprite } from './components/common/ProviderIconSprite'
import { UpdateBanner } from './components/common/UpdateBanner'
import { CommandPalette } from './components/search/CommandPalette'
import { useSettingsStore } from './stores/settingsStore'
import { useTerminalStore } from './stores/terminalStore'
import { useProvidersStore } from './stores/providersStore'
import { useUpdateStore } from './stores/updateStore'
import { useCommandPaletteStore } from './stores/commandPaletteStore'
import { dispatchOpenSettings } from './utils/openSettings'

function App(): React.JSX.Element {
  const loadSettings = useSettingsStore((s) => s.loadSettings)
  const loadProviders = useProvidersStore((s) => s.load)
  const initUpdateStore = useUpdateStore((s) => s.init)
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar)
  const createTerminal = useTerminalStore((s) => s.createTerminal)
  const closeTerminal = useTerminalStore((s) => s.closeTerminal)
  const splitGroup = useTerminalStore((s) => s.splitGroup)
  const setActiveGroup = useTerminalStore((s) => s.setActiveGroup)
  const setActiveTerminalInGroup = useTerminalStore((s) => s.setActiveTerminalInGroup)

  useEffect(() => {
    loadSettings()
    loadProviders()
    return initUpdateStore()
  }, [loadSettings, loadProviders, initUpdateStore])

  const openSidebarSearch = useCallback(() => {
    useSettingsStore.getState().updateSettings({
      sidebarActiveTab: 'search',
      sidebarPanelCollapsed: false,
      sidebarVisible: true
    })
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('dplex:focus-search'))
    })
  }, [])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      const state = useTerminalStore.getState()
      const activeGroup = state.groups.find((g) => g.id === state.activeGroupId)

      if (meta && e.key === 't') {
        e.preventDefault()
        createTerminal(state.activeGroupId ?? undefined)
      }

      if (meta && e.key === 'w') {
        e.preventDefault()
        if (activeGroup) closeTerminal(activeGroup.activeTabId)
      }

      if (meta && e.key === 'b') {
        e.preventDefault()
        toggleSidebar()
      }

      // Cmd/Ctrl+F focuses the active panel's search input.
      // Cmd/Ctrl+Shift+F opens the activity-bar Search view.
      if (meta && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        if (e.shiftKey) {
          openSidebarSearch()
          return
        }
        const settingsStore = useSettingsStore.getState()
        if (settingsStore.settings.sidebarPanelCollapsed) {
          settingsStore.updateSettings({ sidebarPanelCollapsed: false })
        }
        requestAnimationFrame(() => {
          window.dispatchEvent(new CustomEvent('dplex:focus-search'))
        })
      }

      if (meta && e.key === ',') {
        e.preventDefault()
        dispatchOpenSettings()
      }

      // Cmd/Ctrl+P → global search palette (all categories).
      // Cmd/Ctrl+Shift+P → command runner (commands category only).
      //
      // These are *also* registered as `globalShortcut`s in main, which is
      // what catches the keystroke for real users on Linux/Windows where
      // Chromium would otherwise intercept Ctrl+P for print preview.
      // `globalShortcut` consumes native input before Chromium dispatches
      // the DOM event, so on real keystrokes only that path fires. This
      // DOM listener handles Playwright synthesized events (CDP injects
      // straight into the renderer, bypassing the OS pipeline that
      // `globalShortcut` listens on) and serves as a defensive fallback.
      if (meta && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault()
        useCommandPaletteStore.getState().toggle(e.shiftKey ? 'commands' : 'all')
      }

      if (meta && !e.shiftKey && e.key === '\\') {
        e.preventDefault()
        if (state.activeGroupId) splitGroup(state.activeGroupId, 'horizontal')
      }

      if (meta && e.shiftKey && e.key === '\\') {
        e.preventDefault()
        if (state.activeGroupId) splitGroup(state.activeGroupId, 'vertical')
      }

      if (meta && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        // Flatten groups in visual (layout-tree) order, then concatenate
        // their tabs so CMD/CTRL+1..9 selects the Nth tab globally across
        // all split groups, not just within the active one.
        const orderedGroupIds: string[] = []
        const walk = (node: typeof state.layout): void => {
          if (node.type === 'group' && node.groupId) {
            orderedGroupIds.push(node.groupId)
          } else if (node.children) {
            for (const c of node.children) walk(c)
          }
        }
        walk(state.layout)
        const orderedGroups = orderedGroupIds
          .map((id) => state.groups.find((g) => g.id === id))
          .filter((g): g is NonNullable<typeof g> => Boolean(g))
        const flatTabs = orderedGroups.flatMap((g) =>
          g.tabs.map((t) => ({ groupId: g.id, tabId: t.id }))
        )
        const idx = parseInt(e.key) - 1
        if (idx < flatTabs.length) {
          const target = flatTabs[idx]
          setActiveGroup(target.groupId)
          setActiveTerminalInGroup(target.groupId, target.tabId)
        }
      }
    },
    [
      createTerminal,
      closeTerminal,
      toggleSidebar,
      splitGroup,
      setActiveGroup,
      setActiveTerminalInGroup,
      openSidebarSearch
    ]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Subscribe to shortcuts forwarded from the main-process `globalShortcut`
  // accelerators. These are accelerators Chromium would otherwise consume
  // before any renderer keydown listener sees them (e.g. Ctrl+P → print
  // preview on Linux/Windows). The DOM keydown listener above stays in
  // place as a fallback for environments where `globalShortcut` doesn't
  // fire (e.g. Playwright synthesized events go straight to the renderer
  // via CDP, bypassing the OS pipeline).
  useEffect(() => {
    return window.dplex.shortcuts.onShortcut((id) => {
      if (id === 'palette.all') {
        useCommandPaletteStore.getState().toggle('all')
      } else if (id === 'palette.commands') {
        useCommandPaletteStore.getState().toggle('commands')
      } else if (id === 'sidebar.search') {
        openSidebarSearch()
      }
    })
  }, [openSidebarSearch])

  return (
    <>
      <ProviderIconSprite />
      <AppLayout />
      <UpdateBanner />
      <CommandPalette />
    </>
  )
}

export default App
