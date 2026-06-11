import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useProjectStore } from '../../src/renderer/src/stores/projectStore'
import { useTerminalStore } from '../../src/renderer/src/stores/terminalStore'
import { useSettingsStore } from '../../src/renderer/src/stores/settingsStore'
import {
  useTabFocusStore,
  enableFocus,
  disableFocus,
  toggleFocus
} from '../../src/renderer/src/stores/tabFocusStore'
import type { EditorGroup, Project, TerminalTab } from '../../src/renderer/src/types'

interface SettingsMock {
  getAll: ReturnType<typeof vi.fn>
  merge: ReturnType<typeof vi.fn>
}

let settingsMock: SettingsMock

function installWindow(): void {
  settingsMock = {
    getAll: vi.fn().mockResolvedValue({}),
    merge: vi.fn().mockResolvedValue(undefined)
  }
  ;(globalThis as { window?: unknown }).window = {
    dplex: {
      settings: settingsMock,
      sessions: { saveWorkspace: vi.fn(), saveWorkspaceSync: vi.fn() }
    }
  }
  // The projectStore active-tab subscriber schedules DOM scroll work via
  // requestAnimationFrame; stub it as a no-op (callback never runs) so the
  // controller tests can drive terminal-store state without a DOM.
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
}

function makeProject(id: string, root: string): Project {
  return {
    id,
    name: id,
    path: root,
    addedAt: new Date().toISOString()
  } as Project
}

function term(id: string, cwd: string): TerminalTab {
  return { id, title: id, kind: 'terminal', cwd }
}

function setMode(mode: 'dim' | 'isolate'): void {
  useSettingsStore.setState((s) => ({ settings: { ...s.settings, focusFilterMode: mode } }))
}

function setTerminal(groups: EditorGroup[], activeGroupId: string | null): void {
  useTerminalStore.setState({ groups, activeGroupId, restored: true } as never)
}

beforeEach(() => {
  installWindow()
  useProjectStore.setState({ projects: [], activeProjectId: null, loaded: false } as never)
  useTerminalStore.setState({ groups: [], activeGroupId: null, restored: true } as never)
  setMode('dim')
  useTabFocusStore.getState().clear()
  useTabFocusStore.setState({ isolateSelectionByProject: {} })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('tabFocusStore × project removal', () => {
  it('clears focus when the focused project is removed', () => {
    useProjectStore.setState({
      projects: [makeProject('p1', '/r1'), makeProject('p2', '/r2')]
    } as never)
    useTabFocusStore.getState().setFocusedProject('p1')
    expect(useTabFocusStore.getState().focusedProjectId).toBe('p1')

    useProjectStore.getState().removeProject('p1')

    expect(useTabFocusStore.getState().focusedProjectId).toBeNull()
  })

  it('leaves focus untouched when a different project is removed', () => {
    useProjectStore.setState({
      projects: [makeProject('p1', '/r1'), makeProject('p2', '/r2')]
    } as never)
    useTabFocusStore.getState().setFocusedProject('p1')

    useProjectStore.getState().removeProject('p2')

    expect(useTabFocusStore.getState().focusedProjectId).toBe('p1')
  })

  it('toggleFocusedProject clears when toggling the currently focused project', () => {
    useTabFocusStore.getState().setFocusedProject('p1')
    useTabFocusStore.getState().toggleFocusedProject('p1')
    expect(useTabFocusStore.getState().focusedProjectId).toBeNull()
  })

  it('toggleFocusedProject switches when toggling a different project', () => {
    useTabFocusStore.getState().setFocusedProject('p1')
    useTabFocusStore.getState().toggleFocusedProject('p2')
    expect(useTabFocusStore.getState().focusedProjectId).toBe('p2')
  })

  it('restores the pre-isolate selection when the focused project is removed', () => {
    useProjectStore.setState({
      projects: [makeProject('alpha', '/repos/alpha'), makeProject('beta', '/repos/beta')]
    } as never)
    setMode('isolate')
    setTerminal(
      [
        {
          id: 'g1',
          tabs: [term('beta1', '/repos/beta'), term('alpha1', '/repos/alpha')],
          activeTabId: 'beta1'
        }
      ],
      'g1'
    )
    // Simulate selecting project "alpha" in the sidebar while a beta tab is
    // active (setActiveProject doesn't move the active tab). Set this AFTER the
    // terminal so the projectStore active-tab subscriber doesn't realign it.
    useProjectStore.setState({ activeProjectId: 'alpha' } as never)
    enableFocus()
    // Isolate jumped the active tab to the alpha tab.
    expect(useTerminalStore.getState().groups[0].activeTabId).toBe('alpha1')

    useProjectStore.getState().removeProject('alpha')

    expect(useTabFocusStore.getState().focusedProjectId).toBeNull()
    // Pre-isolate selection (beta1) is restored, not left on alpha1.
    expect(useTerminalStore.getState().groups[0].activeTabId).toBe('beta1')
    // Snapshot is cleared so a later enable can't wrongly restore it.
    expect(useTabFocusStore.getState().preIsolateSnapshot).toBeNull()
  })
})

describe('focus controller (enable / disable / toggle)', () => {
  beforeEach(() => {
    useProjectStore.setState({
      projects: [makeProject('alpha', '/repos/alpha'), makeProject('beta', '/repos/beta')],
      activeProjectId: 'alpha'
    } as never)
    // Active tab is a non-project scratch terminal, so the projectStore
    // active-tab subscriber leaves activeProjectId = 'alpha'. g1 also holds an
    // alpha tab (hidden behind scratch); g2 holds another alpha tab.
    setTerminal(
      [
        {
          id: 'g1',
          tabs: [term('scratch', '/tmp/scratch'), term('alpha1', '/repos/alpha')],
          activeTabId: 'scratch'
        },
        { id: 'g2', tabs: [term('alpha2', '/repos/alpha')], activeTabId: 'alpha2' }
      ],
      'g1'
    )
  })

  it('enableFocus targets the active project', () => {
    enableFocus()
    expect(useTabFocusStore.getState().focusedProjectId).toBe('alpha')
  })

  it('isolate enable switches the active selection onto a matching tab', () => {
    setMode('isolate')
    enableFocus()
    const ts = useTerminalStore.getState()
    expect(ts.activeGroupId).toBe('g1')
    expect(ts.groups.find((g) => g.id === 'g1')?.activeTabId).toBe('alpha1')
    // pre-isolate selection was captured for restore
    expect(useTabFocusStore.getState().preIsolateSelection).toEqual({
      groupId: 'g1',
      tabId: 'scratch'
    })
  })

  it('disableFocus restores the pre-isolate selection', () => {
    setMode('isolate')
    enableFocus()
    disableFocus()
    expect(useTabFocusStore.getState().focusedProjectId).toBeNull()
    const ts = useTerminalStore.getState()
    expect(ts.activeGroupId).toBe('g1')
    expect(ts.groups.find((g) => g.id === 'g1')?.activeTabId).toBe('scratch')
  })

  it('dim enable does not move the active selection', () => {
    setMode('dim')
    enableFocus()
    const ts = useTerminalStore.getState()
    expect(ts.groups.find((g) => g.id === 'g1')?.activeTabId).toBe('scratch')
    expect(useTabFocusStore.getState().preIsolateSelection).toBeNull()
  })

  it('toggleFocus flips focus on and off', () => {
    toggleFocus()
    expect(useTabFocusStore.getState().focusedProjectId).toBe('alpha')
    toggleFocus()
    expect(useTabFocusStore.getState().focusedProjectId).toBeNull()
  })

  it('enableFocus is a no-op when there is no resolvable target', () => {
    useProjectStore.setState({ activeProjectId: null } as never)
    setTerminal([{ id: 'g1', tabs: [term('scratch', '/tmp/x')], activeTabId: 'scratch' }], 'g1')
    enableFocus()
    expect(useTabFocusStore.getState().focusedProjectId).toBeNull()
  })

  it('disableFocus still restores the pre-isolate selection after the style flips to dim', () => {
    setMode('isolate')
    enableFocus()
    // User flips the focus style to dim while still focused (no controller
    // wired in this unit test, so preIsolateSelection is retained).
    setMode('dim')
    disableFocus()
    const ts = useTerminalStore.getState()
    expect(ts.groups.find((g) => g.id === 'g1')?.activeTabId).toBe('scratch')
  })

  it('restores every group in a split when isolate jumps the active group', () => {
    // g1 (active) has no alpha tab, so isolating alpha must jump to g2 and
    // change g2's active tab. Toggling off must restore BOTH groups exactly,
    // not just the originally active group.
    setMode('isolate')
    setTerminal(
      [
        { id: 'g1', tabs: [term('scratch', '/tmp/scratch')], activeTabId: 'scratch' },
        {
          id: 'g2',
          tabs: [term('beta1', '/repos/beta'), term('alpha1', '/repos/alpha')],
          activeTabId: 'beta1'
        }
      ],
      'g1'
    )
    enableFocus()
    const afterEnable = useTerminalStore.getState()
    // Focus jumped to the only group with an alpha tab and selected it.
    expect(afterEnable.activeGroupId).toBe('g2')
    expect(afterEnable.groups.find((g) => g.id === 'g2')?.activeTabId).toBe('alpha1')

    disableFocus()
    const restored = useTerminalStore.getState()
    expect(restored.activeGroupId).toBe('g1')
    expect(restored.groups.find((g) => g.id === 'g1')?.activeTabId).toBe('scratch')
    // g2's active tab is restored to beta1 (not left on alpha1).
    expect(restored.groups.find((g) => g.id === 'g2')?.activeTabId).toBe('beta1')
  })
})

describe('focus controller × worktrees', () => {
  function worktreeProject(id: string, root: string, parentProjectId: string): Project {
    return {
      id,
      name: id,
      path: root,
      addedAt: new Date().toISOString(),
      parentProjectId
    } as Project
  }

  it('focuses the family (parent) project when a worktree is active', () => {
    useProjectStore.setState({
      projects: [
        makeProject('repo', '/repos/r'),
        worktreeProject('repo-wt', '/repos/r-wt', 'repo')
      ],
      activeProjectId: 'repo-wt'
    } as never)
    setTerminal([{ id: 'g1', tabs: [term('scratch', '/tmp/x')], activeTabId: 'scratch' }], 'g1')
    enableFocus()
    expect(useTabFocusStore.getState().focusedProjectId).toBe('repo')
  })
})

describe('focus controller follow-active-project', () => {
  it('does not override an explicit navigation to a specific tab of another project', async () => {
    const { wireFocusController } = await import('../../src/renderer/src/stores/tabFocusStore')
    useProjectStore.setState({
      projects: [makeProject('alpha', '/repos/alpha'), makeProject('beta', '/repos/beta')],
      activeProjectId: 'alpha'
    } as never)
    // beta1 and beta2 both belong to beta; the user will jump straight to beta2.
    setTerminal(
      [
        {
          id: 'g1',
          tabs: [
            term('alpha1', '/repos/alpha'),
            term('beta1', '/repos/beta'),
            term('beta2', '/repos/beta')
          ],
          activeTabId: 'alpha1'
        }
      ],
      'g1'
    )
    setMode('isolate')
    enableFocus()
    expect(useTabFocusStore.getState().focusedProjectId).toBe('alpha')

    const off = wireFocusController()
    try {
      // Seed a remembered beta selection (beta1) to prove the follow path does
      // NOT snap back to it when the user explicitly navigates to beta2.
      useTabFocusStore.setState((s) => ({
        isolateSelectionByProject: {
          ...s.isolateSelectionByProject,
          beta: { groupId: 'g1', tabId: 'beta1' }
        }
      }))
      // Explicit navigation: activate beta2, then mark beta active (as the
      // projectStore active-tab subscriber would).
      useTerminalStore.getState().setActiveTerminalInGroup('g1', 'beta2')
      useProjectStore.getState().setActiveProject('beta')

      expect(useTabFocusStore.getState().focusedProjectId).toBe('beta')
      // The user's explicit beta2 selection is preserved (not reverted to beta1).
      const ts = useTerminalStore.getState()
      expect(ts.groups.find((g) => g.id === 'g1')?.activeTabId).toBe('beta2')
    } finally {
      off()
    }
  })
})
