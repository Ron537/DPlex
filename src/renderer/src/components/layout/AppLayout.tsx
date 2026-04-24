import { useEffect, useRef, useState } from 'react'
import { useTerminalStore } from '../../stores/terminalStore'
import { persistWorkspaceNow } from '../../stores/terminalStore'
import { useSettingsStore, applyCssVarsSync } from '../../stores/settingsStore'
import { useAttentionStore } from '../../stores/attentionStore'
import { SidePanel } from './SidePanel'
import { ActivityBar } from './ActivityBar'
import { StatusBar } from './StatusBar'
import { GroupLayout } from '../terminal/GroupLayout'
import { SettingsModal } from '../settings/SettingsModal'
import { AttentionBellButton } from '../attention/AttentionBellButton'
import { useSessions } from '../../hooks/useSessions'
import { getTheme } from '../../services/themes'
import { MOD } from '../../utils/shortcuts'
import { focusSessionTab } from '../../utils/sessionTabs'
import type { TerminalTab, EditorGroup, LayoutNode } from '../../types'

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
    const data = await window.dplex.sessions.loadWorkspace() as {
      groups: Array<{ id: string; tabs: TerminalTab[]; activeTabId: string }>
      layout: LayoutNode
      activeGroupId: string | null
    } | null
    if (!data || !data.groups || !data.layout) return null

    // Filter to only AI tabs (have command) and rebuild groups
    const restoredGroups: EditorGroup[] = []
    for (const g of data.groups) {
      const aiTabs = (g.tabs || []).filter((t) => t.command)
      if (aiTabs.length === 0) continue

      // For tabs with sessionId, rewrite command to --resume
      const preparedTabs: TerminalTab[] = aiTabs.map((t) => {
        if (t.sessionId && t.command && !t.command.includes('--resume')) {
          return { ...t, command: `${t.command} --resume=${t.sessionId}` }
        }
        return { ...t }
      })

      restoredGroups.push({
        id: g.id,
        tabs: preparedTabs,
        activeTabId: preparedTabs.find((t) => t.id === g.activeTabId)?.id ?? preparedTabs[0].id
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
          useTerminalStore.getState().restoreWorkspace(
            workspace.groups,
            workspace.layout,
            workspace.activeGroupId
          )
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
      if (!tab?.sessionId || !tab.providerId) return null
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
    <div className="flex flex-col h-screen text-white overflow-hidden" style={{ backgroundColor: theme.ui.bg, color: theme.ui.text }}>
      {/* macOS title bar / drag region */}
      <div className="h-10 drag-region flex-shrink-0 flex items-center" style={{ backgroundColor: theme.ui.bgAlt, borderBottom: `1px solid ${theme.ui.border}` }}>
        <div className="w-[76px] flex-shrink-0" />
        <div className="flex-1 text-center">
          <span className="text-[11px] text-zinc-600 font-medium select-none">DPlex</span>
        </div>
        <div className="w-[76px] flex-shrink-0 flex items-center justify-end pr-2">
          <AttentionBellButton />
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <ActivityBar onOpenSettings={() => setSettingsOpen(true)} />
        <SidePanel />

        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex-1 min-h-0">
            {groups.length > 0 ? (
              <GroupLayout node={layout} />
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center flex flex-col items-center gap-4">
                  {/* DPlex logo */}
                  <svg viewBox="0 0 512 512" width="72" height="72" style={{ opacity: 0.6 }}>
                    {/* Sidebar */}
                    <rect x="66" y="86" width="105" height="340" rx="14" fill="var(--dplex-text-muted)" opacity="0.4"/>
                    <rect x="66" y="86" width="105" height="340" rx="14" fill="none" stroke="var(--dplex-text-muted)" strokeWidth="2" opacity="0.3"/>
                    {/* Sidebar entries */}
                    <rect x="80" y="112" width="76" height="9" rx="4" fill="var(--dplex-text-muted)" opacity="0.4"/>
                    <rect x="80" y="128" width="50" height="5" rx="2.5" fill="var(--dplex-text-muted)" opacity="0.25"/>
                    <rect x="66" y="150" width="3" height="35" rx="1.5" fill="var(--dplex-accent)"/>
                    <rect x="80" y="156" width="76" height="9" rx="4" fill="var(--dplex-text)" opacity="0.5"/>
                    <rect x="80" y="172" width="40" height="5" rx="2.5" fill="var(--dplex-accent)" opacity="0.4"/>
                    <rect x="80" y="200" width="76" height="9" rx="4" fill="var(--dplex-text-muted)" opacity="0.2"/>
                    {/* Divider */}
                    <rect x="181" y="96" width="2" height="320" rx="1" fill="var(--dplex-text-muted)" opacity="0.3"/>
                    {/* Terminal area */}
                    <rect x="193" y="86" width="253" height="340" rx="14" fill="var(--dplex-text-muted)" opacity="0.2"/>
                    <rect x="193" y="86" width="253" height="340" rx="14" fill="none" stroke="var(--dplex-text-muted)" strokeWidth="2" opacity="0.2"/>
                    {/* Tab bar */}
                    <rect x="207" y="97" width="55" height="4" rx="2" fill="var(--dplex-accent)" opacity="0.8"/>
                    <rect x="270" y="97" width="40" height="4" rx="2" fill="var(--dplex-text-muted)" opacity="0.2"/>
                    {/* Prompt 1 */}
                    <path d="M220,175 L248,196 L220,217" stroke="var(--dplex-accent)" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                    <rect x="262" y="188" width="90" height="8" rx="4" fill="var(--dplex-text-muted)" opacity="0.4"/>
                    {/* Response lines */}
                    <rect x="220" y="240" width="185" height="7" rx="3.5" fill="var(--dplex-text-muted)" opacity="0.2"/>
                    <rect x="220" y="258" width="140" height="7" rx="3.5" fill="var(--dplex-text-muted)" opacity="0.15"/>
                    <rect x="220" y="276" width="165" height="7" rx="3.5" fill="var(--dplex-text-muted)" opacity="0.18"/>
                    {/* Prompt 2 — green like the icon */}
                    <path d="M220,325 L248,346 L220,367" stroke="var(--dplex-status-waiting)" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                    <rect x="262" y="338" width="60" height="8" rx="4" fill="var(--dplex-text-muted)" opacity="0.3"/>
                    <rect x="332" y="332" width="5" height="24" rx="2.5" fill="var(--dplex-status-waiting)"/>
                  </svg>
                  <div>
                    <div className="text-sm font-semibold" style={{ color: 'var(--dplex-text-muted)' }}>DPlex</div>
                    <div className="text-xs mt-1" style={{ color: 'var(--dplex-text-muted)', opacity: 0.8 }}>
                      Press {MOD}T to open a new terminal
                    </div>
                  </div>
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
