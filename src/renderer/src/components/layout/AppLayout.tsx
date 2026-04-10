import { useEffect, useRef, useState } from 'react'
import { useTerminalStore } from '../../stores/terminalStore'
import { persistWorkspaceNow } from '../../stores/terminalStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { SidePanel } from './SidePanel'
import { StatusBar } from './StatusBar'
import { GroupLayout } from '../terminal/GroupLayout'
import { SettingsModal } from '../settings/SettingsModal'
import { useSessions } from '../../hooks/useSessions'
import { getTheme } from '../../services/themes'
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

export function AppLayout(): JSX.Element {
  const groups = useTerminalStore((s) => s.groups)
  const layout = useTerminalStore((s) => s.layout)
  const createTerminal = useTerminalStore((s) => s.createTerminal)
  const sidebarVisible = useSettingsStore((s) => s.settings.sidebarVisible)
  const themeId = useSettingsStore((s) => s.settings.theme)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const theme = getTheme(themeId)

  // Apply theme CSS variables
  useEffect(() => {
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

  return (
    <div className="flex flex-col h-screen text-white overflow-hidden" style={{ backgroundColor: theme.ui.bg, color: theme.ui.text }}>
      {/* macOS title bar / drag region */}
      <div className="h-10 drag-region flex-shrink-0 flex items-center" style={{ backgroundColor: theme.ui.bgAlt, borderBottom: `1px solid ${theme.ui.border}` }}>
        <div className="w-[76px] flex-shrink-0" />
        <div className="flex-1 text-center">
          <span className="text-[11px] text-zinc-600 font-medium select-none">DPlex</span>
        </div>
        <div className="w-[76px] flex-shrink-0" />
      </div>

      <div className="flex flex-1 min-h-0">
        {sidebarVisible && <SidePanel />}

        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex-1 min-h-0">
            {groups.length > 0 ? (
              <GroupLayout node={layout} />
            ) : (
              <div className="flex items-center justify-center h-full text-zinc-500">
                <div className="text-center">
                  <div className="text-4xl mb-2">⬡</div>
                  <div className="text-sm font-medium">DPlex</div>
                  <div className="text-xs mt-1 text-zinc-600">Press ⌘T to open a new terminal</div>
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
