import { useEffect, useMemo, useRef, useState } from 'react'
import { Focus } from 'lucide-react'
import { useTerminalStore } from '../../stores/terminalStore'
import { persistWorkspaceNow } from '../../stores/terminalStore'
import { useSettingsStore, applyCssVarsSync } from '../../stores/settingsStore'
import { useAttentionStore } from '../../stores/attentionStore'
import { useSpaceStore } from '../../stores/spaceStore'
import { SidePanel } from './SidePanel'
import { ActivityBar } from './ActivityBar'
import { StatusBar } from './StatusBar'
import { GroupLayout } from '../terminal/GroupLayout'
import { SettingsModal } from '../settings/SettingsModal'
import { CloseConfirmModal } from '../common/CloseConfirmModal'
import { ExternalResumeConfirmModal } from '../common/ExternalResumeConfirmModal'
import { AttentionBellButton } from '../attention/AttentionBellButton'
import { ProjectFocusControl } from './ProjectFocusControl'
import { DPlexLogo } from '../common/DPlexLogo'
import { SpaceSwitcher } from '../spaces/SpaceSwitcher'
import { SpacesOverview } from '../spaces/SpacesOverview'
import { SpaceWelcome } from '../spaces/SpaceWelcome'
import { SpaceModal } from '../spaces/SpaceModal'
import { SpaceDeleteConfirm } from '../spaces/SpaceDeleteConfirm'
import { SpaceAttentionToasts } from '../spaces/SpaceAttentionToasts'
import { useSessions } from '../../hooks/useSessions'
import { getTheme } from '../../services/themes'
import { isMac } from '../../utils/shortcuts'
import { focusSessionTab } from '../../utils/sessionTabs'
import { wireGitPanelGlobals } from '../../stores/gitPanelStore'
import { wireGitGraphGlobals } from '../../stores/gitGraphStore'
import { wireFileExplorerGlobals } from '../../stores/fileExplorerStore'
import { wireFocusController, disableFocus } from '../../stores/tabFocusStore'
import { useFocusFilter } from '../../hooks/useFocusFilter'
import { pruneLayoutToGroups } from '../../utils/tabFocus'
import { isTerminalTab } from '../../types'

export function AppLayout(): React.JSX.Element {
  const groups = useTerminalStore((s) => s.groups)
  const layout = useTerminalStore((s) => s.layout)
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId)
  const spaces = useSpaceStore((s) => s.spaces)
  const spaceLoaded = useSpaceStore((s) => s.loaded)
  const themeId = useSettingsStore((s) => s.settings.theme)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Project focus filter: in isolate mode the rendered layout is pruned to the
  // groups that still have matching tabs (empty groups collapse). The terminal
  // store is never mutated — `effLayout` is a derived view only.
  const { isolate, matches } = useFocusFilter()
  const visibleGroupIds = useMemo(() => {
    if (!isolate) return null
    const ids = new Set<string>()
    for (const g of groups) if (g.tabs.some(matches)) ids.add(g.id)
    return ids
  }, [isolate, groups, matches])
  const effLayout = useMemo(
    () => (visibleGroupIds ? pruneLayoutToGroups(layout, visibleGroupIds) : layout),
    [visibleGroupIds, layout]
  )
  const activeSpace = activeSpaceId ? (spaces.find((s) => s.id === activeSpaceId) ?? null) : null

  useEffect(() => {
    const handler = (): void => setSettingsOpen(true)
    window.addEventListener('dplex:open-settings', handler)
    return () => window.removeEventListener('dplex:open-settings', handler)
  }, [])

  const theme = getTheme(themeId)

  // Apply theme CSS variables (including status colors)
  useEffect(() => {
    applyCssVarsSync(themeId)
  }, [themeId])

  useSessions()

  const initialized = useRef(false)
  const settingsLoaded = useSettingsStore((s) => s.loaded)

  // Boot: load + migrate Spaces, restore the active space's arrangement, and
  // ensure a terminal exists if a space is in focus but empty (fresh install /
  // migrated-empty). When no space is in focus we intentionally do nothing —
  // the Overview is the home base and must not auto-spawn an orphan terminal.
  useEffect(() => {
    if (initialized.current || !settingsLoaded) return
    initialized.current = true
    void useSpaceStore
      .getState()
      .hydrate()
      .then(() => {
        const { activeSpaceId: activeId } = useSpaceStore.getState()
        if (activeId && useTerminalStore.getState().groups.length === 0) {
          useTerminalStore.getState().createTerminal()
        }
      })
  }, [settingsLoaded])

  // Save workspace before the window unloads
  useEffect(() => {
    const handleBeforeUnload = (): void => {
      persistWorkspaceNow()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  // Cmd/Ctrl+Shift+1..9 quick-switches to the Nth space. Keyed off `e.code`
  // (Digit1..Digit9) so it is layout- and shift-independent, and suppressed
  // while typing. Cmd/Ctrl+1..9 alone is already bound to tab switching, so
  // Spaces take the Shift modifier. On macOS, Cmd+Shift+3/4/5 are reserved by
  // the OS for screenshots (the OS still delivers the event, but acting on it
  // would fight the screenshot UI), so those three positions are skipped there.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod || !e.shiftKey || e.altKey) return
      const m = /^Digit([1-9])$/.exec(e.code)
      if (!m) return
      if (!useSpaceStore.getState().loaded) return
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      }
      const digit = parseInt(m[1], 10)
      if (isMac && (digit === 3 || digit === 4 || digit === 5)) return
      const idx = digit - 1
      const spaces = useSpaceStore.getState().spaces
      if (idx < spaces.length) {
        e.preventDefault()
        useSpaceStore.getState().switchSpace(spaces[idx].id)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Listen for settings open event from keyboard shortcut
  useEffect(() => {
    const handler = (): void => setSettingsOpen(true)
    window.addEventListener('dplex:open-settings', handler)
    return () => window.removeEventListener('dplex:open-settings', handler)
  }, [])

  // Initialize attention store: hydrate snapshot + subscribe to updates.
  useEffect(() => {
    const unsub = useAttentionStore.getState().init()
    return () => {
      unsub()
    }
  }, [])

  // Wire global Git-panel side-effects exactly once.
  useEffect(() => {
    const off = wireGitPanelGlobals()
    return () => off()
  }, [])

  // Wire global commit-graph refresh side-effects exactly once.
  useEffect(() => {
    const off = wireGitGraphGlobals()
    return () => off()
  }, [])

  // Wire global file-explorer side-effects exactly once (active-project
  // binding + the single per-root filesystem watcher).
  useEffect(() => {
    const off = wireFileExplorerGlobals()
    return () => off()
  }, [])

  // Wire the project-focus controller exactly once (follow-active-project +
  // per-project selection memory for isolate mode).
  useEffect(() => {
    const off = wireFocusController()
    return () => off()
  }, [])

  // Cmd/Ctrl+Shift+G activates the Source Control activity-bar item.
  // If it's already active, collapses the side panel. Suppressed while
  // typing in an input/textarea/contenteditable and while Monaco's find
  // widget is open (Monaco owns Cmd+Shift+G for "find previous").
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod || !e.shiftKey) return
      if (e.key !== 'G' && e.key !== 'g') return
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        if (target.isContentEditable) return
        if (document.querySelector('.find-widget.visible')) return
      }
      e.preventDefault()
      const settings = useSettingsStore.getState()
      const cur = settings.settings
      if (cur.sidebarActiveTab === 'git' && !cur.sidebarPanelCollapsed) {
        settings.updateSettings({ sidebarPanelCollapsed: true })
      } else {
        settings.updateSettings({ sidebarActiveTab: 'git', sidebarPanelCollapsed: false })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Wire main-process focus-session intent → focus matching tab in renderer.
  useEffect(() => {
    const unsub = window.dplex.attention.onFocusSession((compositeId) => {
      const [providerId, ...rest] = compositeId.split(':')
      const sessionId = rest.join(':')
      if (!providerId || !sessionId) return
      focusSessionTab(sessionId, providerId)
    })
    return () => {
      unsub()
    }
  }, [])

  // Auto-acknowledge "finished" events when the user focuses the owning tab.
  // Track the composite id of the active AI session tab so main can make
  // notification decisions tab-aware (only suppress when user is looking at
  // THIS session). Also auto-ack `finished` when that tab becomes active.
  useEffect(() => {
    const computeActiveComposite = (
      state: ReturnType<typeof useTerminalStore.getState>
    ): string | null => {
      const activeGroup = state.groups.find((g) => g.id === state.activeGroupId)
      if (!activeGroup) return null
      const tab = activeGroup.tabs.find((t) => t.id === activeGroup.activeTabId)
      if (!tab || !isTerminalTab(tab) || !tab.sessionId || !tab.providerId) return null
      return `${tab.providerId}:${tab.sessionId}`
    }

    // Push initial value on mount.
    window.dplex.attention.setActiveTab(computeActiveComposite(useTerminalStore.getState()))

    const unsubscribe = useTerminalStore.subscribe((state, prev) => {
      const current = computeActiveComposite(state)
      const previous = computeActiveComposite(prev)
      if (current === previous) return
      window.dplex.attention.setActiveTab(current)
      if (current) {
        const attention = useAttentionStore.getState()
        const event = attention.active.find((e) => e.compositeId === current)
        if (event && event.kind === 'finished') {
          attention.acknowledge(current)
        }
      }
    })
    return unsubscribe
  }, [])

  return (
    <div
      className="flex flex-col h-screen overflow-hidden"
      style={{ backgroundColor: theme.ui.bg, color: theme.ui.text }}
    >
      {/* macOS title bar / drag region — v2: gradient logo + name centered */}
      <div
        className="h-10 drag-region flex-shrink-0 flex items-center"
        style={{
          backgroundColor: 'var(--dplex-bg-panel)',
          borderBottom: '1px solid var(--dplex-border-subtle)'
        }}
      >
        <div className="w-[76px] flex-shrink-0" />
        <div className="flex-1 flex items-center justify-center gap-2 pointer-events-none select-none">
          <DPlexLogo size={18} flat />
          <span
            className="text-[11px] font-semibold"
            style={{ color: 'var(--dplex-text-2)', letterSpacing: '0.02em' }}
          >
            DPlex
          </span>
        </div>
        <div className="flex-shrink-0 flex items-center justify-end gap-2 pl-3 pr-2 no-drag">
          <ProjectFocusControl />
          <AttentionBellButton />
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <ActivityBar onOpenSettings={() => setSettingsOpen(true)} />
        <SidePanel />

        <div className="flex flex-col flex-1 min-w-0">
          {activeSpaceId === null ? (
            <div className="flex-1 min-w-0 min-h-0 relative">
              {/* Hold the Overview until Spaces have hydrated: rendering it
                  (and its create/switch controls) mid-boot lets the user
                  mutate state that the pending hydrate would then clobber. */}
              {spaceLoaded ? <SpacesOverview /> : null}
            </div>
          ) : (
            <>
              <SpaceSwitcher />
              <div className="flex-1 min-w-0 min-h-0">
                {groups.length > 0 ? (
                  effLayout ? (
                    <GroupLayout node={effLayout} />
                  ) : (
                    <div
                      className="flex items-center justify-center h-full px-6 text-center"
                      style={{ backgroundColor: 'var(--dplex-bg)' }}
                    >
                      <div className="flex flex-col items-center gap-4 max-w-sm">
                        <Focus size={28} style={{ color: 'var(--dplex-text-dim)' }} />
                        <div className="flex flex-col gap-1">
                          <p className="text-sm font-medium" style={{ color: 'var(--dplex-text)' }}>
                            No tabs for this project
                          </p>
                          <p className="text-xs" style={{ color: 'var(--dplex-text-muted)' }}>
                            Focus is isolating a project with no open tabs.
                          </p>
                        </div>
                        <button
                          onClick={() => disableFocus()}
                          className="inline-flex items-center gap-1.5 px-3 rounded-full transition-colors"
                          style={{
                            height: 26,
                            border: '1px solid var(--dplex-border)',
                            color: 'var(--dplex-text)',
                            backgroundColor: 'var(--dplex-bg-elev)'
                          }}
                        >
                          Show all tabs
                        </button>
                      </div>
                    </div>
                  )
                ) : activeSpace ? (
                  <SpaceWelcome space={activeSpace} />
                ) : null}
              </div>
            </>
          )}

          <StatusBar onOpenSettings={() => setSettingsOpen(true)} />
        </div>
      </div>

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <CloseConfirmModal />
      <ExternalResumeConfirmModal />
      <SpaceModal />
      <SpaceDeleteConfirm />
      <SpaceAttentionToasts />
    </div>
  )
}
