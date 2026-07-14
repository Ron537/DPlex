import { useEffect, useCallback } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { ProviderIconSprite } from './components/common/ProviderIconSprite'
import { UpdateBanner } from './components/common/UpdateBanner'
import { CommandPalette } from './components/search/CommandPalette'
import { useSettingsStore } from './stores/settingsStore'
import { useTerminalStore } from './stores/terminalStore'
import { useProjectStore } from './stores/projectStore'
import { useProvidersStore } from './stores/providersStore'
import { useUpdateStore } from './stores/updateStore'
import { useCommandPaletteStore } from './stores/commandPaletteStore'
import { useSpaceStore } from './stores/spaceStore'
import { requestCloseTab } from './stores/closeConfirmStore'
import { getFileEditorHandle } from './services/fileEditorRegistry'
import { isFileEditorTab } from './types'
import { dispatchOpenSettings } from './utils/openSettings'
import { openInheritedTerminal, openInheritedSplit } from './utils/inheritCwd'
import { toggleFocus, useTabFocusStore } from './stores/tabFocusStore'
import { tabMatchesFocus } from './utils/tabFocus'

function App(): React.JSX.Element {
  const loadSettings = useSettingsStore((s) => s.loadSettings)
  const loadProviders = useProvidersStore((s) => s.load)
  const initUpdateStore = useUpdateStore((s) => s.init)
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar)
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
        // Suppress until Spaces hydrate: a tab spawned now would be discarded
        // (and its PTY leaked) by the pending hydrate's workspace swap.
        if (!useSpaceStore.getState().loaded) return
        void openInheritedTerminal(state.activeGroupId ?? undefined)
      }

      if (meta && e.key === 'w') {
        e.preventDefault()
        if (activeGroup) requestCloseTab(activeGroup.activeTabId)
      }

      // Cmd/Ctrl+S → save the active file editor tab (no-op otherwise).
      // Monaco registers its own Cmd/Ctrl+S command and consumes the event
      // while focused, so this bubble-phase handler only runs when the editor
      // is unfocused — avoiding a double save. We always preventDefault to
      // stop Chromium's "save page" dialog in the packaged app.
      if (meta && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        // Don't save the (background) editor when focus is in an unrelated
        // editable field — e.g. an inline rename input, the command palette,
        // or a settings/modal field. Monaco already consumed the event above
        // when it had focus, so any editable target here is not the editor.
        const target = e.target as HTMLElement | null
        const inEditableField =
          !!target &&
          (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        if (!inEditableField && activeGroup) {
          const tab = activeGroup.tabs.find((t) => t.id === activeGroup.activeTabId)
          if (tab && isFileEditorTab(tab)) {
            void getFileEditorHandle(tab.id)?.save()
          }
        }
      }

      // Cmd/Ctrl+Shift+E → reveal the Explorer side panel.
      if (meta && e.shiftKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault()
        useSettingsStore.getState().updateSettings({
          sidebarActiveTab: 'explorer',
          sidebarPanelCollapsed: false,
          sidebarVisible: true
        })
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

      // Cmd/Ctrl+Shift+O → toggle project focus (isolate/dim the active project).
      if (meta && e.shiftKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault()
        toggleFocus()
        return
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
        if (state.activeGroupId) void openInheritedSplit(state.activeGroupId, 'horizontal')
      }

      if (meta && e.shiftKey && e.key === '\\') {
        e.preventDefault()
        if (state.activeGroupId) void openInheritedSplit(state.activeGroupId, 'vertical')
      }

      // Key off the physical digit (e.code) so numeric tab-switching works on
      // every keyboard layout — on AZERTY the number row needs Shift to emit
      // '1'..'9', so an e.key range check would silently break it there. Require
      // NO shift and NO alt: the Space quick-switch (AppLayout) is
      // Cmd/Ctrl+Shift+Digit1..9, and excluding Alt keeps AltGr (Ctrl+Alt on
      // Windows/Linux) number-row input from being hijacked as a tab switch.
      const tabDigit = meta && !e.shiftKey && !e.altKey ? /^Digit([1-9])$/.exec(e.code) : null
      if (tabDigit) {
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
        // In isolate focus mode the numeric shortcut must address only the
        // tabs the user can actually see, otherwise it could activate a hidden
        // tab and desync the visible view from the real active tab.
        const focus = useTabFocusStore.getState()
        const isolateActive =
          focus.focusedProjectId !== null &&
          useSettingsStore.getState().settings.focusFilterMode === 'isolate'
        const projects = useProjectStore.getState().projects
        const isVisible = (t: Parameters<typeof tabMatchesFocus>[0]): boolean =>
          !isolateActive || tabMatchesFocus(t, projects, focus.focusedProjectId)
        const orderedGroups = orderedGroupIds
          .map((id) => state.groups.find((g) => g.id === id))
          .filter((g): g is NonNullable<typeof g> => Boolean(g))
        const flatTabs = orderedGroups.flatMap((g) =>
          g.tabs.filter(isVisible).map((t) => ({ groupId: g.id, tabId: t.id }))
        )
        const idx = parseInt(tabDigit[1], 10) - 1
        if (idx < flatTabs.length) {
          const target = flatTabs[idx]
          setActiveGroup(target.groupId)
          setActiveTerminalInGroup(target.groupId, target.tabId)
        }
      }
    },
    [toggleSidebar, setActiveGroup, setActiveTerminalInGroup, openSidebarSearch]
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
