import { useEffect, useRef, useState } from 'react'
import { useTerminalStore } from '../../stores/terminalStore'
import { persistWorkspaceNow } from '../../stores/terminalStore'
import { useSettingsStore, applyCssVarsSync } from '../../stores/settingsStore'
import { useAttentionStore } from '../../stores/attentionStore'
import { useCommandPaletteStore } from '../../stores/commandPaletteStore'
import { SidePanel } from './SidePanel'
import { ActivityBar } from './ActivityBar'
import { StatusBar } from './StatusBar'
import { GroupLayout } from '../terminal/GroupLayout'
import { SettingsModal } from '../settings/SettingsModal'
import { AttentionBellButton } from '../attention/AttentionBellButton'
import { DPlexLogo } from '../common/DPlexLogo'
import { useSessions } from '../../hooks/useSessions'
import { getTheme } from '../../services/themes'
import { MOD } from '../../utils/shortcuts'
import { focusSessionTab } from '../../utils/sessionTabs'
import { wireGitPanelGlobals } from '../../stores/gitPanelStore'
import type { TerminalTab, FileDiffTab, EditorTab, EditorGroup, LayoutNode } from '../../types'

// Prune layout tree to only include groups that exist in the restored set
function pruneLayout(node: LayoutNode, validGroupIds: Set<string>): LayoutNode | null {
  if (node.type === 'group') {
    return node.groupId && validGroupIds.has(node.groupId) ? node : null
  }
  if (!node.children) return null
  const filtered = node.children
    .map((c) => pruneLayout(c, validGroupIds))
    .filter(Boolean) as LayoutNode[]
  if (filtered.length === 0) return null
  if (filtered.length === 1) return filtered[0]
  return { ...node, children: filtered }
}

async function loadPersistedWorkspace(): Promise<{
  groups: EditorGroup[]
  layout: LayoutNode
  activeGroupId: string | null
} | null> {
  try {
    type PersistedTab =
      | (TerminalTab & { kind?: 'terminal' })
      | (FileDiffTab & { kind: 'fileDiff' })
      | { kind: 'diff' } // Legacy repo-level diff tab — quietly dropped on restore.
    const data = (await window.dplex.sessions.loadWorkspace()) as {
      groups: Array<{
        id: string
        tabs: PersistedTab[]
        activeTabId: string
        previewTabId?: string
      }>
      layout: LayoutNode
      activeGroupId: string | null
    } | null
    if (!data || !data.groups || !data.layout) return null

    const restoredGroups: EditorGroup[] = []
    for (const g of data.groups) {
      // Keep fileDiff tabs as-is; AI terminal tabs (command present) get
      // resume commands; plain shells are dropped (we never persisted them).
      // Legacy `kind: 'diff'` repo-level diff tabs are quietly dropped — the
      // Git panel replaces that experience.
      const keepers = (g.tabs || []).filter((t) => {
        if (t.kind === 'diff') return false
        if (t.kind === 'fileDiff') return true
        return !!(t as TerminalTab).command
      })
      if (keepers.length === 0) continue

      const preparedTabs: EditorTab[] = await Promise.all(
        keepers.map(async (t): Promise<EditorTab> => {
          if (t.kind === 'fileDiff') {
            const ft = t as FileDiffTab
            // Restored fileDiff tabs are always permanent — preview tabs
            // weren't persisted. Defensive scrub in case of future schema drift.
            return { ...ft, preview: false }
          }
          const tt = t as TerminalTab
          if (!tt.sessionId) return { ...tt }
          if (tt.providerId) {
            try {
              const cmd = await window.dplex.sessions.getResumeCommand(tt.providerId, tt.sessionId)
              if (cmd) return { ...tt, command: cmd }
            } catch {
              // Provider lookup failed transiently. Preserve the persisted
              // command as-is rather than blindly applying Copilot's
              // `--resume=<id>` shape, which is wrong for other providers.
            }
            return { ...tt }
          }
          if (tt.command && !tt.command.includes('--resume')) {
            return { ...tt, command: `${tt.command} --resume=${tt.sessionId}` }
          }
          return { ...tt }
        })
      )

      restoredGroups.push({
        id: g.id,
        tabs: preparedTabs,
        activeTabId: preparedTabs.find((t) => t.id === g.activeTabId)?.id ?? preparedTabs[0].id
        // previewTabId is intentionally not restored.
      })
    }

    if (restoredGroups.length === 0) return null

    // Prune layout to only include valid (non-empty) groups
    const validIds = new Set(restoredGroups.map((g) => g.id))
    const prunedLayout = pruneLayout(data.layout, validIds)
    if (!prunedLayout) return null

    // Ensure activeGroupId references a valid group
    const activeGroupId = validIds.has(data.activeGroupId ?? '')
      ? data.activeGroupId
      : restoredGroups[0].id

    return {
      groups: restoredGroups,
      layout: prunedLayout,
      activeGroupId
    }
  } catch {
    return null
  }
}

export function AppLayout(): React.JSX.Element {
  const groups = useTerminalStore((s) => s.groups)
  const layout = useTerminalStore((s) => s.layout)
  const createTerminal = useTerminalStore((s) => s.createTerminal)
  const themeId = useSettingsStore((s) => s.settings.theme)
  const [settingsOpen, setSettingsOpen] = useState(false)

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
  const restored = useTerminalStore((s) => s.restored)

  useEffect(() => {
    if (!initialized.current && settingsLoaded && groups.length === 0 && !restored) {
      initialized.current = true
      // Try to restore persisted workspace, fall back to fresh terminal
      loadPersistedWorkspace().then((workspace) => {
        if (workspace) {
          useTerminalStore
            .getState()
            .restoreWorkspace(workspace.groups, workspace.layout, workspace.activeGroupId)
        } else {
          createTerminal()
        }
      })
    }
  }, [settingsLoaded])

  // Save workspace before the window unloads
  useEffect(() => {
    const handleBeforeUnload = (): void => {
      persistWorkspaceNow()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
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
    const computeActiveComposite = (state: ReturnType<typeof useTerminalStore.getState>) => {
      const activeGroup = state.groups.find((g) => g.id === state.activeGroupId)
      if (!activeGroup) return null
      const tab = activeGroup.tabs.find((t) => t.id === activeGroup.activeTabId)
      if (!tab || tab.kind === 'fileDiff' || !tab.sessionId || !tab.providerId) return null
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
        <div className="w-[76px] flex-shrink-0 flex items-center justify-end pr-2 no-drag">
          <AttentionBellButton />
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <ActivityBar onOpenSettings={() => setSettingsOpen(true)} />
        <SidePanel />

        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex-1 min-w-0 min-h-0">
            {groups.length > 0 ? (
              <GroupLayout node={layout} />
            ) : (
              <div
                className="flex items-center justify-center h-full px-6"
                style={{
                  backgroundImage:
                    'radial-gradient(ellipse 800px 400px at 50% 30%, var(--dplex-accent-faint) 0%, transparent 70%)'
                }}
              >
                <div className="flex flex-col items-center gap-7 text-center max-w-md">
                  <div
                    aria-hidden
                    className="relative flex items-center justify-center"
                    style={{
                      filter: 'drop-shadow(0 16px 40px var(--dplex-accent-glow))'
                    }}
                  >
                    <DPlexLogo size={72} />
                  </div>

                  <div className="flex flex-col gap-2">
                    <h1
                      className="text-[28px] font-semibold tracking-tight"
                      style={{ color: 'var(--dplex-text)', letterSpacing: '-0.02em' }}
                    >
                      Welcome to DPlex
                    </h1>
                    <p
                      className="text-[14px] leading-relaxed"
                      style={{ color: 'var(--dplex-text-muted)' }}
                    >
                      Your terminal multiplexer for AI-assisted development. Open a terminal, start
                      an AI session, or jump straight into your projects.
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 w-full">
                    <button
                      onClick={() => createTerminal()}
                      className="flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all"
                      style={{
                        background: 'var(--dplex-bg-elev)',
                        border: '1px solid var(--dplex-border)',
                        color: 'var(--dplex-text)',
                        textAlign: 'left',
                        boxShadow: 'var(--dplex-shadow-sm)'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--dplex-bg-elev-2)'
                        e.currentTarget.style.borderColor = 'var(--dplex-border-strong)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'var(--dplex-bg-elev)'
                        e.currentTarget.style.borderColor = 'var(--dplex-border)'
                      }}
                    >
                      <span
                        aria-hidden
                        className="grid place-items-center flex-shrink-0"
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          background: 'var(--dplex-accent-soft)',
                          border: '1px solid var(--dplex-accent-ring)',
                          color: 'var(--dplex-accent)'
                        }}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                      </span>
                      <span className="flex-1 text-[13px] font-medium">Open a new terminal</span>
                      <kbd
                        className="text-[10.5px] font-medium"
                        style={{
                          fontFamily: 'var(--dplex-font-mono)',
                          color: 'var(--dplex-text-dim)',
                          background: 'var(--dplex-bg-elev-2)',
                          border: '1px solid var(--dplex-border-subtle)',
                          borderRadius: 4,
                          padding: '2px 6px'
                        }}
                      >
                        {MOD}T
                      </kbd>
                    </button>

                    <button
                      onClick={() => useCommandPaletteStore.getState().toggle('all')}
                      className="flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all"
                      style={{
                        background: 'var(--dplex-bg-elev)',
                        border: '1px solid var(--dplex-border)',
                        color: 'var(--dplex-text)',
                        textAlign: 'left',
                        boxShadow: 'var(--dplex-shadow-sm)'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--dplex-bg-elev-2)'
                        e.currentTarget.style.borderColor = 'var(--dplex-border-strong)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'var(--dplex-bg-elev)'
                        e.currentTarget.style.borderColor = 'var(--dplex-border)'
                      }}
                    >
                      <span
                        aria-hidden
                        className="grid place-items-center flex-shrink-0"
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          background: 'var(--dplex-accent-soft)',
                          border: '1px solid var(--dplex-accent-ring)',
                          color: 'var(--dplex-accent)'
                        }}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <circle cx="11" cy="11" r="7" />
                          <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                      </span>
                      <span className="flex-1 text-[13px] font-medium">
                        Search projects &amp; sessions
                      </span>
                      <kbd
                        className="text-[10.5px] font-medium"
                        style={{
                          fontFamily: 'var(--dplex-font-mono)',
                          color: 'var(--dplex-text-dim)',
                          background: 'var(--dplex-bg-elev-2)',
                          border: '1px solid var(--dplex-border-subtle)',
                          borderRadius: 4,
                          padding: '2px 6px'
                        }}
                      >
                        {MOD}P
                      </kbd>
                    </button>
                  </div>

                  <p className="text-[11px]" style={{ color: 'var(--dplex-text-faint)' }}>
                    Press{' '}
                    <kbd
                      style={{
                        fontFamily: 'var(--dplex-font-mono)',
                        background: 'var(--dplex-bg-elev)',
                        border: '1px solid var(--dplex-border-subtle)',
                        borderRadius: 3,
                        padding: '1px 5px'
                      }}
                    >
                      {MOD},
                    </kbd>{' '}
                    to open settings, or{' '}
                    <kbd
                      style={{
                        fontFamily: 'var(--dplex-font-mono)',
                        background: 'var(--dplex-bg-elev)',
                        border: '1px solid var(--dplex-border-subtle)',
                        borderRadius: 3,
                        padding: '1px 5px'
                      }}
                    >
                      {MOD}B
                    </kbd>{' '}
                    to toggle the sidebar
                  </p>
                </div>
              </div>
            )}
          </div>

          <StatusBar onOpenSettings={() => setSettingsOpen(true)} />
        </div>
      </div>

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
