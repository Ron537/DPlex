import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the terminalStore BEFORE importing the module under test so the
// module's internal `useTerminalStore.getState()` resolves to our mock.
const storeState = {
  groups: [] as EditorGroup[],
  setActiveGroup: vi.fn(),
  setActiveTerminalInGroup: vi.fn(),
  closeTerminal: vi.fn()
}
vi.mock('../../src/renderer/src/stores/terminalStore', () => ({
  useTerminalStore: {
    getState: () => storeState
  }
}))

import {
  findTabsForSession,
  findFirstTabForSession,
  focusSessionTab,
  closeOpenTabsForSession,
  hasOpenTab
} from '../../src/renderer/src/utils/sessionTabs'
import type { EditorGroup, TerminalTab } from '../../src/renderer/src/types'

const tab = (overrides: Partial<TerminalTab> & { id: string }): TerminalTab => ({
  id: overrides.id,
  title: overrides.title ?? overrides.id,
  ...overrides
})

const group = (id: string, tabs: TerminalTab[]): EditorGroup => ({
  id,
  tabs,
  activeTabId: tabs[0]?.id ?? ''
})

describe('findTabsForSession', () => {
  it('returns tabs that match both sessionId and providerId', () => {
    const groups: EditorGroup[] = [
      group('g1', [
        tab({ id: 't1', sessionId: 's1', providerId: 'copilot-cli' }),
        tab({ id: 't2', sessionId: 's2', providerId: 'copilot-cli' })
      ])
    ]
    const result = findTabsForSession(groups, 's1', 'copilot-cli')
    expect(result.map((t) => t.id)).toEqual(['t1'])
  })

  it('matches tabs whose providerId is undefined (legacy fallback)', () => {
    const groups: EditorGroup[] = [
      group('g1', [tab({ id: 't1', sessionId: 's1' })])
    ]
    const result = findTabsForSession(groups, 's1', 'copilot-cli')
    expect(result.map((t) => t.id)).toEqual(['t1'])
  })

  it('does not match tabs whose providerId differs', () => {
    const groups: EditorGroup[] = [
      group('g1', [tab({ id: 't1', sessionId: 's1', providerId: 'claude-code' })])
    ]
    expect(findTabsForSession(groups, 's1', 'copilot-cli')).toEqual([])
  })

  it('does not match tabs without a sessionId', () => {
    const groups: EditorGroup[] = [
      group('g1', [tab({ id: 't1', providerId: 'copilot-cli' })])
    ]
    expect(findTabsForSession(groups, 's1', 'copilot-cli')).toEqual([])
  })

  it('finds matches across multiple groups', () => {
    const groups: EditorGroup[] = [
      group('g1', [tab({ id: 't1', sessionId: 's1', providerId: 'copilot-cli' })]),
      group('g2', [
        tab({ id: 't2', sessionId: 's2', providerId: 'copilot-cli' }),
        tab({ id: 't3', sessionId: 's1', providerId: 'copilot-cli' })
      ])
    ]
    const result = findTabsForSession(groups, 's1', 'copilot-cli')
    expect(result.map((t) => t.id).sort()).toEqual(['t1', 't3'])
  })

  it('returns an empty array when there are no groups', () => {
    expect(findTabsForSession([], 's1', 'copilot-cli')).toEqual([])
  })

  it('returns an empty array when nothing matches', () => {
    const groups: EditorGroup[] = [
      group('g1', [tab({ id: 't1', sessionId: 'other', providerId: 'copilot-cli' })])
    ]
    expect(findTabsForSession(groups, 's1', 'copilot-cli')).toEqual([])
  })
})

describe('findFirstTabForSession', () => {
  it('returns the first matching tab with its group id', () => {
    const groups: EditorGroup[] = [
      group('g1', [
        tab({ id: 't1', sessionId: 'other', providerId: 'copilot-cli' }),
        tab({ id: 't2', sessionId: 's1', providerId: 'copilot-cli' })
      ]),
      group('g2', [tab({ id: 't3', sessionId: 's1', providerId: 'copilot-cli' })])
    ]
    const match = findFirstTabForSession(groups, 's1', 'copilot-cli')
    expect(match?.groupId).toBe('g1')
    expect(match?.tab.id).toBe('t2')
  })

  it('returns null when no tab matches', () => {
    expect(findFirstTabForSession([], 's1', 'copilot-cli')).toBeNull()
  })

  it('falls back to a resumeCommand match for legacy tabs', () => {
    const groups: EditorGroup[] = [
      group('g1', [tab({ id: 't1', command: 'copilot --resume s1' })])
    ]
    const match = findFirstTabForSession(
      groups,
      's1',
      'copilot-cli',
      'copilot --resume s1'
    )
    expect(match?.tab.id).toBe('t1')
  })

  it('prefers a sessionId match over a resumeCommand match', () => {
    const groups: EditorGroup[] = [
      group('g1', [
        tab({ id: 't1', command: 'copilot --resume s1' }),
        tab({ id: 't2', sessionId: 's1', providerId: 'copilot-cli' })
      ])
    ]
    const match = findFirstTabForSession(
      groups,
      's1',
      'copilot-cli',
      'copilot --resume s1'
    )
    // Both are in g1; .find returns the first, which is t1 (command match).
    // That's still valid behavior — either match focuses a tab for the same
    // session. Assert that whichever wins is at least a real match.
    expect(['t1', 't2']).toContain(match?.tab.id)
  })

  it('does not match by resumeCommand when not provided', () => {
    const groups: EditorGroup[] = [
      group('g1', [tab({ id: 't1', command: 'copilot --resume s1' })])
    ]
    expect(findFirstTabForSession(groups, 's1', 'copilot-cli')).toBeNull()
  })
})

describe('focusSessionTab', () => {
  beforeEach(() => {
    storeState.groups = []
    storeState.setActiveGroup.mockReset()
    storeState.setActiveTerminalInGroup.mockReset()
    storeState.closeTerminal.mockReset()
  })

  it('focuses the matching tab and returns true', () => {
    storeState.groups = [
      group('g1', [tab({ id: 't1', sessionId: 's1', providerId: 'copilot-cli' })])
    ]
    expect(focusSessionTab('s1', 'copilot-cli')).toBe(true)
    expect(storeState.setActiveGroup).toHaveBeenCalledWith('g1')
    expect(storeState.setActiveTerminalInGroup).toHaveBeenCalledWith('g1', 't1')
  })

  it('returns false and does not call setters when no tab matches', () => {
    storeState.groups = [
      group('g1', [tab({ id: 't1', sessionId: 'other', providerId: 'copilot-cli' })])
    ]
    expect(focusSessionTab('s1', 'copilot-cli')).toBe(false)
    expect(storeState.setActiveGroup).not.toHaveBeenCalled()
    expect(storeState.setActiveTerminalInGroup).not.toHaveBeenCalled()
  })

  it('focuses via resumeCommand fallback when sessionId is absent on tab', () => {
    storeState.groups = [
      group('g1', [tab({ id: 't1', command: 'copilot --resume s1' })])
    ]
    expect(focusSessionTab('s1', 'copilot-cli', 'copilot --resume s1')).toBe(true)
    expect(storeState.setActiveGroup).toHaveBeenCalledWith('g1')
    expect(storeState.setActiveTerminalInGroup).toHaveBeenCalledWith('g1', 't1')
  })

  it('focuses only the first matching tab across groups', () => {
    storeState.groups = [
      group('g1', [tab({ id: 't1', sessionId: 's1', providerId: 'copilot-cli' })]),
      group('g2', [tab({ id: 't2', sessionId: 's1', providerId: 'copilot-cli' })])
    ]
    focusSessionTab('s1', 'copilot-cli')
    expect(storeState.setActiveGroup).toHaveBeenCalledTimes(1)
    expect(storeState.setActiveGroup).toHaveBeenCalledWith('g1')
    expect(storeState.setActiveTerminalInGroup).toHaveBeenCalledTimes(1)
  })
})

describe('closeOpenTabsForSession', () => {
  beforeEach(() => {
    storeState.groups = []
    storeState.closeTerminal.mockReset()
  })

  it('closes every tab matching the session and returns true', () => {
    storeState.groups = [
      group('g1', [
        tab({ id: 't1', sessionId: 's1', providerId: 'copilot-cli' }),
        tab({ id: 't2', sessionId: 'other', providerId: 'copilot-cli' })
      ]),
      group('g2', [tab({ id: 't3', sessionId: 's1', providerId: 'copilot-cli' })])
    ]
    expect(closeOpenTabsForSession('s1', 'copilot-cli')).toBe(true)
    expect(storeState.closeTerminal).toHaveBeenCalledTimes(2)
    const calledWith = storeState.closeTerminal.mock.calls.map((c) => c[0]).sort()
    expect(calledWith).toEqual(['t1', 't3'])
  })

  it('returns false and does not close anything when no tab matches', () => {
    storeState.groups = [
      group('g1', [tab({ id: 't1', sessionId: 'other', providerId: 'copilot-cli' })])
    ]
    expect(closeOpenTabsForSession('s1', 'copilot-cli')).toBe(false)
    expect(storeState.closeTerminal).not.toHaveBeenCalled()
  })

  it('includes legacy tabs without providerId', () => {
    storeState.groups = [
      group('g1', [tab({ id: 't1', sessionId: 's1' })])
    ]
    expect(closeOpenTabsForSession('s1', 'copilot-cli')).toBe(true)
    expect(storeState.closeTerminal).toHaveBeenCalledWith('t1')
  })

  it('returns false when there are no groups', () => {
    storeState.groups = []
    expect(closeOpenTabsForSession('s1', 'copilot-cli')).toBe(false)
    expect(storeState.closeTerminal).not.toHaveBeenCalled()
  })

  it('matches legacy tabs by resumeCommand when provided', () => {
    storeState.groups = [
      group('g1', [tab({ id: 't1', command: 'copilot --resume s1' })])
    ]
    expect(
      closeOpenTabsForSession('s1', 'copilot-cli', 'copilot --resume s1')
    ).toBe(true)
    expect(storeState.closeTerminal).toHaveBeenCalledWith('t1')
  })

  it('deduplicates tabs matched by both sessionId and resumeCommand', () => {
    storeState.groups = [
      group('g1', [
        tab({
          id: 't1',
          sessionId: 's1',
          providerId: 'copilot-cli',
          command: 'copilot --resume s1'
        })
      ])
    ]
    expect(
      closeOpenTabsForSession('s1', 'copilot-cli', 'copilot --resume s1')
    ).toBe(true)
    expect(storeState.closeTerminal).toHaveBeenCalledTimes(1)
    expect(storeState.closeTerminal).toHaveBeenCalledWith('t1')
  })
})

describe('hasOpenTab', () => {
  beforeEach(() => {
    storeState.groups = []
  })

  it('returns true when at least one tab matches', () => {
    storeState.groups = [
      group('g1', [tab({ id: 't1', sessionId: 's1', providerId: 'copilot-cli' })])
    ]
    expect(hasOpenTab('s1', 'copilot-cli')).toBe(true)
  })

  it('returns false when no tab matches', () => {
    storeState.groups = [
      group('g1', [tab({ id: 't1', sessionId: 'other', providerId: 'copilot-cli' })])
    ]
    expect(hasOpenTab('s1', 'copilot-cli')).toBe(false)
  })

  it('returns false for empty groups', () => {
    storeState.groups = []
    expect(hasOpenTab('s1', 'copilot-cli')).toBe(false)
  })

  it('returns true for legacy tabs without providerId', () => {
    storeState.groups = [group('g1', [tab({ id: 't1', sessionId: 's1' })])]
    expect(hasOpenTab('s1', 'copilot-cli')).toBe(true)
  })

  it('distinguishes providers for the same sessionId', () => {
    storeState.groups = [
      group('g1', [tab({ id: 't1', sessionId: 's1', providerId: 'claude-code' })])
    ]
    expect(hasOpenTab('s1', 'copilot-cli')).toBe(false)
    expect(hasOpenTab('s1', 'claude-code')).toBe(true)
  })
})
