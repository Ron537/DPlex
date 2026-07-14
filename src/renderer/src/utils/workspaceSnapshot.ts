import type {
  DashboardTab,
  EditorGroup,
  EditorTab,
  FileDiffTab,
  FileEditorTab,
  LayoutNode,
  TerminalTab,
  WorkspaceSnapshot
} from '../types'
import { isDashboardTab, isFileDiffTab, isFileEditorTab, isTerminalTab } from '../types'
import { pruneLayoutToGroups } from './tabFocus'

/**
 * On-disk / IPC form of a single tab. Terminal tabs carry no `kind` (legacy
 * shape); the other kinds are discriminated. `kind: 'diff'` is a legacy
 * repo-level diff tab that is quietly dropped on reconstruction.
 */
export type PersistedTab =
  | (TerminalTab & { kind?: 'terminal' })
  | (FileDiffTab & { kind: 'fileDiff' })
  | (FileEditorTab & { kind: 'fileEditor' })
  | (DashboardTab & { kind: 'dashboard' })
  | { kind: 'diff' }

/**
 * Whether a session id is safe to interpolate into a shell-executed resume
 * command. Session ids originate from filesystem entry names, so a crafted
 * `.copilot/` / `.claude/` directory could otherwise plant shell metacharacters
 * that fire on restore. Mirrors the main-process guard (BaseSessionProvider
 * .validateSessionId); kept local because main/renderer don't share modules.
 */
function isShellSafeSessionId(sessionId: string): boolean {
  return !!sessionId && sessionId.length <= 128 && /^[A-Za-z0-9_-]+$/.test(sessionId)
}

export interface PersistedGroupSnapshot {
  id: string
  tabs: PersistedTab[]
  activeTabId: string
}

/**
 * On-disk / IPC form of a workspace. Lossy by design: plain shell terminals
 * (no `command`) and preview tabs are dropped because their processes cannot
 * survive an app restart. Used for `sessions.json` and for each Space inside
 * `spaces.json`.
 */
export interface PersistedWorkspaceSnapshot {
  layout: LayoutNode
  groups: PersistedGroupSnapshot[]
  activeGroupId: string | null
  savedAt: string
}

/** An empty workspace — no groups, single placeholder layout node. Used as the
 *  render state when no Space is in focus (Overview) and as the seed for a new
 *  empty Space. */
export const EMPTY_WORKSPACE: WorkspaceSnapshot = {
  layout: { type: 'group', groupId: 'group-0' },
  groups: [],
  activeGroupId: null
}

let movedGroupSeq = 0

/**
 * Inject a live tab into a (background) Space's workspace snapshot, focusing it.
 * Used to move a tab from the active Space into another Space without touching
 * its terminal: the PTY keeps running in the registry and re-attaches when the
 * target Space is next opened. Pure — returns a new snapshot, never mutates the
 * input; the caller owns removing the tab from its source (terminalStore
 * .detachTab).
 *
 * - Empty target → a fresh single group holding the tab becomes the whole
 *   workspace. The new group id is non-numeric (`group-moved-*`) so it can never
 *   collide with the `group-<n>` ids syncGroupCounter tracks once the snapshot is
 *   later swapped live.
 * - Non-empty target → the tab is appended to the target's active group (or the
 *   first group as a fallback) and focused there.
 */
export function injectTabIntoSnapshot(snap: WorkspaceSnapshot, tab: EditorTab): WorkspaceSnapshot {
  if (snap.groups.length === 0) {
    movedGroupSeq += 1
    const groupId = `group-moved-${Date.now()}-${movedGroupSeq}`
    return {
      layout: { type: 'group', groupId },
      groups: [{ id: groupId, tabs: [tab], activeTabId: tab.id }],
      activeGroupId: groupId
    }
  }
  const targetGroupId =
    snap.groups.find((g) => g.id === snap.activeGroupId)?.id ?? snap.groups[0].id
  return {
    ...snap,
    activeGroupId: targetGroupId,
    groups: snap.groups.map((g) =>
      g.id === targetGroupId ? { ...g, tabs: [...g.tabs, tab], activeTabId: tab.id } : g
    )
  }
}

/**
 * Serialize a live workspace snapshot to its persisted (lossy) form. Only AI
 * session terminal tabs (they carry a `command`) and PERMANENT
 * fileDiff/fileEditor/dashboard tabs are kept — plain shell terminals and
 * preview tabs are intentionally not persisted. Pure: no store access.
 */
export function serializeWorkspaceSnapshot(snap: WorkspaceSnapshot): PersistedWorkspaceSnapshot {
  return {
    layout: snap.layout,
    groups: snap.groups.map((g) => ({
      id: g.id,
      tabs: g.tabs
        .filter((t): boolean => {
          if (isFileDiffTab(t)) return t.preview !== true
          if (isFileEditorTab(t)) return t.preview !== true
          if (isDashboardTab(t)) return true
          return isTerminalTab(t) && !!t.command
        })
        .map((t): PersistedTab => {
          if (isDashboardTab(t)) {
            return { kind: 'dashboard', id: t.id, title: t.title, color: t.color }
          }
          if (isFileDiffTab(t)) {
            return {
              kind: 'fileDiff',
              id: t.id,
              title: t.title,
              repoRootFs: t.repoRootFs,
              repoLabel: t.repoLabel,
              scope: t.scope,
              file: t.file,
              sideBySide: t.sideBySide,
              color: t.color
            }
          }
          if (isFileEditorTab(t)) {
            return {
              kind: 'fileEditor',
              id: t.id,
              title: t.title,
              rootFs: t.rootFs,
              rootLabel: t.rootLabel,
              relPath: t.relPath,
              color: t.color
            }
          }
          return {
            id: t.id,
            title: t.title,
            cwd: t.cwd,
            command: t.command,
            sessionId: t.sessionId,
            providerId: t.providerId,
            worktreePath: t.worktreePath,
            worktreeBranch: t.worktreeBranch,
            color: t.color
          }
        }),
      activeTabId: g.activeTabId
      // previewTabId is deliberately NOT serialized — preview tabs are
      // transient and their slot is recomputed after reconstruction.
    })),
    activeGroupId: snap.activeGroupId,
    savedAt: new Date().toISOString()
  }
}

interface PersistedWorkspaceInput {
  layout: LayoutNode
  groups: Array<{ id: string; tabs: PersistedTab[]; activeTabId: string; previewTabId?: string }>
  activeGroupId: string | null
}

/**
 * Reconstruct a live workspace snapshot from its persisted form. AI terminal
 * tabs get a fresh resume command from their provider; plain shells were never
 * persisted; legacy `kind: 'diff'` tabs are dropped. Empty groups collapse and
 * the layout is pruned to the surviving groups. Returns null when nothing
 * restorable remains. Reused by boot restore and by Space hydration.
 */
export async function reconstructWorkspace(
  data: PersistedWorkspaceInput | null | undefined
): Promise<WorkspaceSnapshot | null> {
  try {
    if (!data || !Array.isArray(data.groups) || !data.layout) return null

    const restoredGroups: EditorGroup[] = []
    for (const g of data.groups) {
      // Isolate each group: a single malformed group must not discard the
      // entire space's workspace (which would then be persisted over as
      // EMPTY_WORKSPACE, losing every other group's tabs).
      try {
        if (!g || typeof g !== 'object' || !Array.isArray(g.tabs)) continue
        const keepers = g.tabs.filter((t) => {
          if (!t || typeof t !== 'object') return false
          if (t.kind === 'diff') return false
          if (t.kind === 'fileDiff') return true
          if (t.kind === 'fileEditor') return true
          if (t.kind === 'dashboard') return true
          return !!(t as TerminalTab).command
        })
        if (keepers.length === 0) continue

        const prepared = await Promise.all(
          keepers.map(async (t): Promise<EditorTab | null> => {
            // Isolate each tab too: one bad tab is dropped, not fatal.
            try {
              if (t.kind === 'dashboard') {
                return { ...(t as DashboardTab) }
              }
              if (t.kind === 'fileDiff') {
                const ft = t as FileDiffTab
                return { ...ft, preview: false }
              }
              if (t.kind === 'fileEditor') {
                const fe = t as FileEditorTab
                return { ...fe, preview: false, dirty: false }
              }
              const tt = t as TerminalTab
              if (!tt.sessionId) return { ...tt }
              if (tt.providerId) {
                try {
                  const cmd = await window.dplex.sessions.getResumeCommand(
                    tt.providerId,
                    tt.sessionId
                  )
                  if (cmd) return { ...tt, command: cmd }
                } catch {
                  // Provider lookup failed transiently — keep the persisted command.
                }
                return { ...tt }
              }
              if (
                tt.command &&
                !tt.command.includes('--resume') &&
                isShellSafeSessionId(tt.sessionId)
              ) {
                return { ...tt, command: `${tt.command} --resume=${tt.sessionId}` }
              }
              return { ...tt }
            } catch {
              return null
            }
          })
        )

        const preparedTabs = prepared.filter((t): t is EditorTab => t !== null)
        if (preparedTabs.length === 0) continue

        restoredGroups.push({
          id: g.id,
          tabs: preparedTabs,
          activeTabId: preparedTabs.find((t) => t.id === g.activeTabId)?.id ?? preparedTabs[0].id
        })
      } catch {
        continue
      }
    }

    if (restoredGroups.length === 0) return null

    const validIds = new Set(restoredGroups.map((g) => g.id))
    const prunedLayout = pruneLayoutToGroups(data.layout, validIds)
    if (!prunedLayout) return null

    const activeGroupId = validIds.has(data.activeGroupId ?? '')
      ? data.activeGroupId
      : restoredGroups[0].id

    return { groups: restoredGroups, layout: prunedLayout, activeGroupId }
  } catch {
    return null
  }
}
