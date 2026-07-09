/**
 * Unit tests for per-tab colour in `terminalStore`:
 *   - `setTabColor` sets / clears a colour on the target tab only
 *   - the chosen colour survives workspace serialization (and is dropped
 *     once cleared, so cleared tabs don't carry an empty `color` field).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  useTerminalStore,
  _serializeWorkspaceForTests
} from '../../src/renderer/src/stores/terminalStore'

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

function tabById(id: string): { id: string; color?: string } | undefined {
  for (const g of useTerminalStore.getState().groups) {
    const t = g.tabs.find((x) => x.id === id)
    if (t) return t as { id: string; color?: string }
  }
  return undefined
}

function serializedTab(id: string): { id: string; color?: string } | undefined {
  const snap = _serializeWorkspaceForTests() as {
    groups: Array<{ tabs: Array<{ id: string; color?: string }> }>
  }
  return snap.groups.flatMap((g) => g.tabs).find((t) => t.id === id)
}

describe('setTabColor', () => {
  it('sets a colour on the target tab and clears it with null', () => {
    const id = useTerminalStore.getState().createTerminal()
    expect(tabById(id)?.color).toBeUndefined()

    useTerminalStore.getState().setTabColor(id, '#F87171')
    expect(tabById(id)?.color).toBe('#F87171')

    useTerminalStore.getState().setTabColor(id, null)
    expect(tabById(id)?.color).toBeUndefined()
  })

  it('only colours the matching tab', () => {
    const a = useTerminalStore.getState().createTerminal()
    const b = useTerminalStore.getState().createTerminal()

    useTerminalStore.getState().setTabColor(a, '#60A5FA')
    expect(tabById(a)?.color).toBe('#60A5FA')
    expect(tabById(b)?.color).toBeUndefined()
  })
})

describe('serializeWorkspace — tab colour', () => {
  it('persists a colour on a session (command) tab and omits it once cleared', () => {
    // Session tabs (those with a `command`) are the ones we persist.
    const id = useTerminalStore.getState().createTerminal(undefined, 'Copilot', 'copilot')

    useTerminalStore.getState().setTabColor(id, '#A78BFA')
    expect(serializedTab(id)?.color).toBe('#A78BFA')

    useTerminalStore.getState().setTabColor(id, null)
    const cleared = serializedTab(id)
    expect(cleared?.color).toBeUndefined()
    // Cleared tabs must not serialize a lingering `color` key.
    expect(JSON.stringify(cleared)).not.toContain('color')
  })
})
