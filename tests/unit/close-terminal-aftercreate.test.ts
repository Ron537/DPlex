/**
 * Regression: `closeTerminal` must re-read store state AFTER `destroyTerminal`.
 *
 * `destroyTerminal` fires any pending exit handler *synchronously*. The worktree
 * `afterCreate: 'terminal'` flow registers such a handler on the setup PTY and,
 * when it exits, creates a brand-new terminal tab. If `closeTerminal` computed
 * its group/layout mutation from the PRE-destroy snapshot, that just-created tab
 * would be clobbered by the trailing `set(...)`. This test drives exactly that
 * race and asserts the new tab survives.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTerminalStore } from '../../src/renderer/src/stores/terminalStore'
import { registerExitHandler } from '../../src/renderer/src/services/terminalRegistry'

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

function tabExists(id: string): boolean {
  return useTerminalStore.getState().groups.some((g) => g.tabs.some((t) => t.id === id))
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

describe('closeTerminal + synchronous afterCreate exit handler', () => {
  it('preserves a tab created by the exit handler fired during destroy', () => {
    const setupId = useTerminalStore.getState().createTerminal()

    // Simulate worktree afterCreate: 'terminal' — on the setup PTY's exit, spawn
    // the follow-up terminal. destroyTerminal (below) fires this synchronously.
    let spawnedId = ''
    registerExitHandler(setupId, () => {
      spawnedId = useTerminalStore.getState().createTerminal()
    })

    useTerminalStore.getState().closeTerminal(setupId)

    expect(spawnedId).not.toBe('')
    // The follow-up tab created mid-destroy must still be present…
    expect(tabExists(spawnedId)).toBe(true)
    // …and the closed setup tab must be gone.
    expect(tabExists(setupId)).toBe(false)
    // The store must still expose an active group (not collapsed to empty).
    expect(useTerminalStore.getState().activeGroupId).not.toBeNull()
  })

  it('still removes the tab cleanly when the handler creates nothing', () => {
    const a = useTerminalStore.getState().createTerminal()
    const b = useTerminalStore.getState().createTerminal()
    useTerminalStore.getState().closeTerminal(a)
    expect(tabExists(a)).toBe(false)
    expect(tabExists(b)).toBe(true)
  })
})
