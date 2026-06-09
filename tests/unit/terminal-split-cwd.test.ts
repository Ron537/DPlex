/**
 * Unit tests for `terminalStore.splitGroup` cwd inheritance and the guard that
 * prevents an orphaned, unreachable group when the source group is closed
 * during the async cwd-resolution gap (issue #73).
 *
 * Runs in node env. We stub the `window.dplex` surface the store touches.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTerminalStore } from '../../src/renderer/src/stores/terminalStore'
import type { LayoutNode } from '../../src/renderer/src/types'

function setupWindow(): void {
  ;(globalThis as { window?: unknown }).window = {
    dplex: {
      sessions: {
        saveWorkspace: vi.fn().mockResolvedValue(undefined),
        saveWorkspaceSync: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined)
      },
      pty: { destroy: vi.fn() }
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }
}

beforeEach(() => {
  setupWindow()
  useTerminalStore.setState({
    groups: [],
    layout: { type: 'group', groupId: '' },
    activeGroupId: null,
    restored: false
  } as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Collect every groupId referenced by the layout tree. */
function layoutGroupIds(node: LayoutNode, acc: string[] = []): string[] {
  if (node.type === 'group' && node.groupId) acc.push(node.groupId)
  if (node.children) for (const c of node.children) layoutGroupIds(c, acc)
  return acc
}

describe('terminalStore.splitGroup — cwd inheritance', () => {
  it('passes the inherited cwd onto the new split tab', () => {
    useTerminalStore.getState().createTerminal()
    const sourceGroup = useTerminalStore.getState().activeGroupId!

    const tabId = useTerminalStore.getState().splitGroup(sourceGroup, 'horizontal', '/code/dplex')

    const tab = useTerminalStore
      .getState()
      .groups.flatMap((g) => g.tabs)
      .find((t) => t.id === tabId)!
    expect(tab.kind).not.toBe('fileDiff')
    if (tab.kind !== 'fileDiff') expect(tab.cwd).toBe('/code/dplex')
  })

  it('attaches the new split group to the layout tree', () => {
    useTerminalStore.getState().createTerminal()
    const sourceGroup = useTerminalStore.getState().activeGroupId!

    useTerminalStore.getState().splitGroup(sourceGroup, 'horizontal')

    const state = useTerminalStore.getState()
    const ids = layoutGroupIds(state.layout)
    // Every live group must be reachable from the layout tree.
    for (const g of state.groups) expect(ids).toContain(g.id)
    expect(ids).toContain(state.activeGroupId)
  })
})

describe('terminalStore.splitGroup — stale source group guard (issue #73)', () => {
  it('does not create an orphan group when the target group no longer exists', () => {
    useTerminalStore.getState().createTerminal()
    const liveGroup = useTerminalStore.getState().activeGroupId!

    // Simulate the async race: split a group id that was closed during the
    // cwd-resolution wait while another group is still active.
    const tabId = useTerminalStore.getState().splitGroup('group-gone', 'vertical', '/x')

    const state = useTerminalStore.getState()
    const ids = layoutGroupIds(state.layout)
    // No group is left dangling outside the layout.
    for (const g of state.groups) expect(ids).toContain(g.id)
    // The active group is reachable and the new tab exists somewhere live.
    expect(ids).toContain(state.activeGroupId)
    const tab = state.groups.flatMap((g) => g.tabs).find((t) => t.id === tabId)
    expect(tab).toBeDefined()
    expect(state.groups.some((g) => g.id === liveGroup)).toBe(true)
  })

  it('falls back to a standalone terminal when no groups remain', () => {
    // No groups at all — the guard should still produce a reachable terminal.
    const tabId = useTerminalStore.getState().splitGroup('group-gone', 'horizontal', '/y')

    const state = useTerminalStore.getState()
    expect(state.groups.length).toBe(1)
    const ids = layoutGroupIds(state.layout)
    expect(ids).toContain(state.activeGroupId)
    const tab = state.groups.flatMap((g) => g.tabs).find((t) => t.id === tabId)
    expect(tab).toBeDefined()
    if (tab && tab.kind !== 'fileDiff') expect(tab.cwd).toBe('/y')
  })
})
