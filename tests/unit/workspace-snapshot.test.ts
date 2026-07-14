import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  EMPTY_WORKSPACE,
  injectTabIntoSnapshot,
  reconstructWorkspace,
  serializeWorkspaceSnapshot
} from '../../src/renderer/src/utils/workspaceSnapshot'
import type {
  EditorGroup,
  FileEditorTab,
  TerminalTab,
  WorkspaceSnapshot
} from '../../src/renderer/src/types'

function aiTab(
  id: string,
  sessionId: string,
  cwd: string,
  providerId = 'copilot-cli'
): TerminalTab {
  return { id, title: id, cwd, command: 'copilot', sessionId, providerId }
}

function shellTab(id: string): TerminalTab {
  return { id, title: id, cwd: '/r' } // no command → plain shell, not persisted
}

function fileEditorTab(id: string, preview: boolean): FileEditorTab {
  return {
    id,
    title: id,
    kind: 'fileEditor',
    rootFs: '/r',
    rootLabel: 'r',
    relPath: 'src/x.ts',
    preview
  }
}

function group(id: string, tabs: EditorGroup['tabs']): EditorGroup {
  return { id, tabs, activeTabId: tabs[0]?.id ?? '' }
}

function installWindow(resumeCommand: string | null): void {
  ;(globalThis as { window?: unknown }).window = {
    dplex: {
      sessions: {
        getResumeCommand: vi.fn().mockResolvedValue(resumeCommand)
      }
    }
  }
}

beforeEach(() => installWindow(null))
afterEach(() => vi.restoreAllMocks())

describe('serializeWorkspaceSnapshot', () => {
  it('keeps AI session terminals + permanent file tabs, drops plain shells and previews', () => {
    const snap: WorkspaceSnapshot = {
      layout: { type: 'group', groupId: 'g1' },
      groups: [
        group('g1', [
          aiTab('t1', 's1', '/repo-a'),
          shellTab('t2'),
          fileEditorTab('fe-keep', false),
          fileEditorTab('fe-preview', true)
        ])
      ],
      activeGroupId: 'g1'
    }
    const persisted = serializeWorkspaceSnapshot(snap)
    const ids = persisted.groups[0].tabs.map((t) => (t as { id?: string }).id)
    expect(ids).toContain('t1')
    expect(ids).toContain('fe-keep')
    expect(ids).not.toContain('t2') // plain shell dropped
    expect(ids).not.toContain('fe-preview') // preview dropped
    expect(persisted.savedAt).toBeTruthy()
  })
})

describe('reconstructWorkspace', () => {
  it('round-trips AI session tabs and refreshes their resume command', async () => {
    installWindow('copilot --resume=s1')
    const snap: WorkspaceSnapshot = {
      layout: { type: 'group', groupId: 'g1' },
      groups: [group('g1', [aiTab('t1', 's1', '/repo-a')])],
      activeGroupId: 'g1'
    }
    const persisted = serializeWorkspaceSnapshot(snap)
    const restored = await reconstructWorkspace(persisted)
    expect(restored).not.toBeNull()
    const tab = restored!.groups[0].tabs[0] as TerminalTab
    expect(tab.id).toBe('t1')
    expect(tab.sessionId).toBe('s1')
    expect(tab.command).toBe('copilot --resume=s1')
  })

  it('appends a resume flag for a legacy tab (no providerId) with a safe id', async () => {
    // No providerId → the renderer-side fallback builds the resume command.
    const legacy: TerminalTab = {
      id: 't1',
      title: 't1',
      cwd: '/r',
      command: 'copilot',
      sessionId: 'safe-123'
    }
    const snap: WorkspaceSnapshot = {
      layout: { type: 'group', groupId: 'g1' },
      groups: [group('g1', [legacy])],
      activeGroupId: 'g1'
    }
    const restored = await reconstructWorkspace(serializeWorkspaceSnapshot(snap))
    const tab = restored!.groups[0].tabs[0] as TerminalTab
    expect(tab.command).toBe('copilot --resume=safe-123')
  })

  it('does NOT interpolate an unsafe session id into a legacy tab resume command', async () => {
    const evil: TerminalTab = {
      id: 't1',
      title: 't1',
      cwd: '/r',
      command: 'copilot',
      sessionId: 's1; rm -rf /'
    }
    const snap: WorkspaceSnapshot = {
      layout: { type: 'group', groupId: 'g1' },
      groups: [group('g1', [evil])],
      activeGroupId: 'g1'
    }
    const restored = await reconstructWorkspace(serializeWorkspaceSnapshot(snap))
    const tab = restored!.groups[0].tabs[0] as TerminalTab
    // Command left untouched — no shell metacharacters interpolated.
    expect(tab.command).toBe('copilot')
    expect(tab.command).not.toContain('rm -rf')
  })

  it('retains tabs from MULTIPLE projects across a serialize→reconstruct round-trip', async () => {
    const snap: WorkspaceSnapshot = {
      layout: {
        type: 'split',
        direction: 'horizontal',
        children: [
          { type: 'group', groupId: 'gA' },
          { type: 'group', groupId: 'gB' }
        ]
      },
      groups: [
        group('gA', [aiTab('a1', 'sa1', '/repo-a'), aiTab('a2', 'sa2', '/repo-a')]),
        group('gB', [aiTab('b1', 'sb1', '/repo-b')])
      ],
      activeGroupId: 'gA'
    }
    const restored = await reconstructWorkspace(serializeWorkspaceSnapshot(snap))
    expect(restored).not.toBeNull()
    const cwds = restored!.groups.flatMap((g) => g.tabs.map((t) => (t as TerminalTab).cwd))
    expect(cwds.sort()).toEqual(['/repo-a', '/repo-a', '/repo-b'])
    expect(restored!.groups.map((g) => g.id).sort()).toEqual(['gA', 'gB'])
  })

  it('returns null when nothing restorable remains (all plain shells)', async () => {
    const snap: WorkspaceSnapshot = {
      layout: { type: 'group', groupId: 'g1' },
      groups: [group('g1', [shellTab('t1'), shellTab('t2')])],
      activeGroupId: 'g1'
    }
    const restored = await reconstructWorkspace(serializeWorkspaceSnapshot(snap))
    expect(restored).toBeNull()
  })

  it('isolates a malformed group — good groups survive instead of nulling all', async () => {
    const good = serializeWorkspaceSnapshot({
      layout: { type: 'group', groupId: 'gGood' },
      groups: [group('gGood', [aiTab('a1', 'sa1', '/repo-a')])],
      activeGroupId: 'gGood'
    })
    const data = {
      layout: {
        type: 'split',
        direction: 'horizontal',
        children: [
          { type: 'group', groupId: 'gGood' },
          { type: 'group', groupId: 'gBad' }
        ]
      },
      groups: [
        good.groups[0],
        // A null group and a group with a non-array `tabs` — either would throw
        // in the old single try/catch and null the ENTIRE workspace.
        null,
        { id: 'gBad', tabs: null, activeTabId: '' }
      ],
      activeGroupId: 'gGood'
    } as unknown as Parameters<typeof reconstructWorkspace>[0]
    const restored = await reconstructWorkspace(data)
    expect(restored).not.toBeNull()
    expect(restored!.groups.map((g) => g.id)).toEqual(['gGood'])
    expect(restored!.groups[0].tabs.map((t) => t.id)).toEqual(['a1'])
  })

  it('isolates a malformed tab — good tabs in the same group survive', async () => {
    const good = serializeWorkspaceSnapshot({
      layout: { type: 'group', groupId: 'gGood' },
      groups: [group('gGood', [aiTab('a1', 'sa1', '/repo-a')])],
      activeGroupId: 'gGood'
    })
    const goodTab = good.groups[0].tabs[0]
    // A tab whose property access throws while being prepared (passes the keeper
    // filter via its command, then throws on sessionId read).
    const throwingTab: Record<string, unknown> = { id: 'bad', title: 'bad', command: 'copilot' }
    Object.defineProperty(throwingTab, 'sessionId', {
      enumerable: true,
      get() {
        throw new Error('boom')
      }
    })
    const data = {
      layout: { type: 'group', groupId: 'gGood' },
      groups: [
        {
          id: 'gGood',
          // null / undefined tabs and a throwing tab alongside a valid one.
          tabs: [null, throwingTab, goodTab, undefined],
          activeTabId: goodTab.id
        }
      ],
      activeGroupId: 'gGood'
    } as unknown as Parameters<typeof reconstructWorkspace>[0]
    const restored = await reconstructWorkspace(data)
    expect(restored).not.toBeNull()
    expect(restored!.groups[0].tabs.map((t) => t.id)).toEqual(['a1'])
  })

  it('returns null when EVERY group is malformed (nothing salvageable)', async () => {
    const data = {
      layout: { type: 'group', groupId: 'g1' },
      groups: [null, { id: 'g2', tabs: null, activeTabId: '' }, undefined],
      activeGroupId: 'g1'
    } as unknown as Parameters<typeof reconstructWorkspace>[0]
    const restored = await reconstructWorkspace(data)
    expect(restored).toBeNull()
  })

  it('EMPTY_WORKSPACE has no groups', () => {
    expect(EMPTY_WORKSPACE.groups).toHaveLength(0)
    expect(EMPTY_WORKSPACE.activeGroupId).toBeNull()
  })
})

describe('injectTabIntoSnapshot', () => {
  it('creates a fresh focused group when the target snapshot is empty', () => {
    const tab = aiTab('t1', 's1', '/repo-a')
    const out = injectTabIntoSnapshot(EMPTY_WORKSPACE, tab)
    expect(out.groups).toHaveLength(1)
    expect(out.groups[0].tabs.map((t) => t.id)).toEqual(['t1'])
    expect(out.groups[0].activeTabId).toBe('t1')
    expect(out.activeGroupId).toBe(out.groups[0].id)
    // The layout points at the new group, whose id is non-numeric so it can
    // never collide with the `group-<n>` ids syncGroupCounter tracks.
    expect(out.layout).toEqual({ type: 'group', groupId: out.groups[0].id })
    expect(out.groups[0].id.startsWith('group-moved-')).toBe(true)
    // Pure: the shared EMPTY_WORKSPACE constant is never mutated.
    expect(EMPTY_WORKSPACE.groups).toHaveLength(0)
  })

  it('generates a unique group id for each empty-target injection', () => {
    const a = injectTabIntoSnapshot(EMPTY_WORKSPACE, aiTab('t1', 's1', '/r'))
    const b = injectTabIntoSnapshot(EMPTY_WORKSPACE, aiTab('t2', 's2', '/r'))
    expect(a.groups[0].id).not.toBe(b.groups[0].id)
  })

  it('appends the tab to the active group and focuses it when the target is non-empty', () => {
    const snap: WorkspaceSnapshot = {
      layout: {
        type: 'split',
        direction: 'horizontal',
        children: [
          { type: 'group', groupId: 'g1' },
          { type: 'group', groupId: 'g2' }
        ]
      },
      groups: [group('g1', [aiTab('a', 'sa', '/r')]), group('g2', [aiTab('b', 'sb', '/r')])],
      activeGroupId: 'g2'
    }
    const out = injectTabIntoSnapshot(snap, aiTab('c', 'sc', '/r'))
    // Landed in the active group g2, focused there; g1 untouched; layout intact.
    expect(out.groups.find((g) => g.id === 'g2')!.tabs.map((t) => t.id)).toEqual(['b', 'c'])
    expect(out.groups.find((g) => g.id === 'g2')!.activeTabId).toBe('c')
    expect(out.groups.find((g) => g.id === 'g1')!.tabs.map((t) => t.id)).toEqual(['a'])
    expect(out.activeGroupId).toBe('g2')
    expect(out.layout).toEqual(snap.layout)
    // Pure: input untouched.
    expect(snap.groups.find((g) => g.id === 'g2')!.tabs).toHaveLength(1)
  })

  it('falls back to the first group when activeGroupId does not resolve', () => {
    const snap: WorkspaceSnapshot = {
      layout: { type: 'group', groupId: 'g1' },
      groups: [group('g1', [aiTab('a', 'sa', '/r')])],
      activeGroupId: null
    }
    const out = injectTabIntoSnapshot(snap, aiTab('c', 'sc', '/r'))
    expect(out.groups[0].tabs.map((t) => t.id)).toEqual(['a', 'c'])
    expect(out.activeGroupId).toBe('g1')
  })
})
