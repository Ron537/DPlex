/**
 * Unit tests for `terminalStore.detachTab` — the removal half of the
 * "move a tab to another Space" feature. detachTab must mirror closeTerminal's
 * removal/prune invariants EXACTLY while never destroying the terminal or closing
 * the session (the PTY keeps running in the registry so the tab can re-attach in
 * its new Space). Runs in node env.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTerminalStore } from '../../src/renderer/src/stores/terminalStore'
import type {
  EditorGroup,
  EditorTab,
  FileEditorTab,
  LayoutNode,
  TerminalTab
} from '../../src/renderer/src/types'

const destroy = vi.fn()
const closeSession = vi.fn().mockResolvedValue(undefined)

function setupWindow(): void {
  ;(globalThis as { window?: unknown }).window = {
    dplex: {
      sessions: {
        saveWorkspace: vi.fn().mockResolvedValue(undefined),
        saveWorkspaceSync: vi.fn(),
        close: (...a: unknown[]) => closeSession(...a)
      },
      pty: { destroy: (...a: unknown[]) => destroy(...a) }
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }
}

function termTab(id: string): TerminalTab {
  return {
    id,
    title: id,
    cwd: '/r',
    command: 'copilot',
    sessionId: `s-${id}`,
    providerId: 'copilot-cli'
  }
}

function previewTab(id: string): FileEditorTab {
  return {
    id,
    title: id,
    kind: 'fileEditor',
    rootFs: '/r',
    rootLabel: 'r',
    relPath: `src/${id}.ts`,
    preview: true
  }
}

function reset(groups: EditorGroup[], layout: LayoutNode, activeGroupId: string | null): void {
  useTerminalStore.setState({ groups, layout, activeGroupId, restored: false } as never)
}

beforeEach(() => {
  setupWindow()
  destroy.mockReset()
  closeSession.mockClear()
})
afterEach(() => vi.restoreAllMocks())

describe('terminalStore.detachTab', () => {
  it('returns null and leaves state untouched when the tab is not live', () => {
    reset(
      [{ id: 'g1', tabs: [termTab('a')], activeTabId: 'a' }],
      { type: 'group', groupId: 'g1' },
      'g1'
    )
    const before = useTerminalStore.getState().groups
    const out = useTerminalStore.getState().detachTab('ghost')
    expect(out).toBeNull()
    expect(useTerminalStore.getState().groups).toBe(before)
  })

  it('never destroys the terminal or closes the session', () => {
    reset(
      [{ id: 'g1', tabs: [termTab('a'), termTab('b')], activeTabId: 'a' }],
      { type: 'group', groupId: 'g1' },
      'g1'
    )
    const out = useTerminalStore.getState().detachTab('a')
    expect((out as TerminalTab).id).toBe('a')
    expect(destroy).not.toHaveBeenCalled()
    expect(closeSession).not.toHaveBeenCalled()
  })

  it('falls back to the previous tab when the removed tab was active', () => {
    reset(
      [{ id: 'g1', tabs: [termTab('a'), termTab('b'), termTab('c')], activeTabId: 'b' }],
      { type: 'group', groupId: 'g1' },
      'g1'
    )
    useTerminalStore.getState().detachTab('b')
    const g = useTerminalStore.getState().groups.find((x) => x.id === 'g1')!
    expect(g.tabs.map((t) => t.id)).toEqual(['a', 'c'])
    expect(g.activeTabId).toBe('a') // newTabs[max(0, idx-1)] = index 0
  })

  it('clears previewTabId and promotes the returned preview tab out of preview', () => {
    const pv = previewTab('pv')
    reset(
      [{ id: 'g1', tabs: [termTab('a'), pv], activeTabId: 'pv', previewTabId: 'pv' }],
      { type: 'group', groupId: 'g1' },
      'g1'
    )
    const out = useTerminalStore.getState().detachTab('pv') as FileEditorTab
    const g = useTerminalStore.getState().groups.find((x) => x.id === 'g1')!
    expect(g.previewTabId).toBeUndefined()
    expect(g.activeTabId).toBe('a')
    expect(out.preview).toBe(false) // promoteOnMove clears the preview flag
  })

  it('prunes an emptied group and collapses the split layout, recomputing activeGroupId', () => {
    const layout: LayoutNode = {
      type: 'split',
      direction: 'horizontal',
      children: [
        { type: 'group', groupId: 'g1' },
        { type: 'group', groupId: 'g2' }
      ]
    }
    reset(
      [
        { id: 'g1', tabs: [termTab('a')], activeTabId: 'a' },
        { id: 'g2', tabs: [termTab('b')], activeTabId: 'b' }
      ],
      layout,
      'g1'
    )
    useTerminalStore.getState().detachTab('a')
    const st = useTerminalStore.getState()
    expect(st.groups.map((g) => g.id)).toEqual(['g2'])
    // The split collapses to the surviving group node.
    expect(st.layout).toEqual({ type: 'group', groupId: 'g2' })
    expect(st.activeGroupId).toBe('g2')
  })

  it('resets to an empty workspace when the last tab is detached', () => {
    reset(
      [{ id: 'g1', tabs: [termTab('a')], activeTabId: 'a' }],
      { type: 'group', groupId: 'g1' },
      'g1'
    )
    const out = useTerminalStore.getState().detachTab('a')
    const st = useTerminalStore.getState()
    expect((out as EditorTab).id).toBe('a')
    expect(st.groups).toHaveLength(0)
    expect(st.layout).toEqual({ type: 'group', groupId: 'group-0' })
    expect(st.activeGroupId).toBeNull()
    expect(destroy).not.toHaveBeenCalled()
  })
})
