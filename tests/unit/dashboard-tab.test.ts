/**
 * Unit tests for the Overview Dashboard tab in `terminalStore`:
 * the singleton open/focus invariant and workspace serialization.
 *
 * Runs in node env with a stubbed `window.dplex` (some actions persist the
 * workspace via the debounced saver).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useTerminalStore,
  _serializeWorkspaceForTests
} from '../../src/renderer/src/stores/terminalStore'
import { isDashboardTab } from '../../src/renderer/src/types'

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

function allTabs(): { kind?: string; id: string }[] {
  return useTerminalStore.getState().groups.flatMap((g) => g.tabs)
}

describe('openOrFocusDashboardTab', () => {
  it('creates a single dashboard tab when none exists', () => {
    const id = useTerminalStore.getState().openOrFocusDashboardTab()
    const dashboards = allTabs().filter((t) => t.kind === 'dashboard')
    expect(dashboards).toHaveLength(1)
    expect(dashboards[0].id).toBe(id)
  })

  it('focuses the existing dashboard instead of creating a second one', () => {
    const first = useTerminalStore.getState().openOrFocusDashboardTab()
    const second = useTerminalStore.getState().openOrFocusDashboardTab()
    expect(second).toBe(first)
    expect(allTabs().filter((t) => t.kind === 'dashboard')).toHaveLength(1)
  })

  it('activates the group and tab that hosts the dashboard', () => {
    const id = useTerminalStore.getState().openOrFocusDashboardTab()
    const state = useTerminalStore.getState()
    const group = state.groups.find((g) => g.id === state.activeGroupId)
    expect(group?.activeTabId).toBe(id)
  })

  it('persists the dashboard tab in the serialized workspace', () => {
    useTerminalStore.getState().openOrFocusDashboardTab()
    const data = _serializeWorkspaceForTests() as {
      groups: { tabs: { kind?: string }[] }[]
    }
    const persisted = data.groups.flatMap((g) => g.tabs).filter((t) => t.kind === 'dashboard')
    expect(persisted).toHaveLength(1)
  })

  it('produces tabs the isDashboardTab guard recognizes', () => {
    useTerminalStore.getState().openOrFocusDashboardTab()
    const tab = useTerminalStore.getState().groups[0].tabs[0]
    expect(isDashboardTab(tab)).toBe(true)
  })
})
