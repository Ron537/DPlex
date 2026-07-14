import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Spy on terminal teardown so we can assert switching NEVER destroys a
// terminal (the whole point: backgrounded sessions keep running).
const destroyTerminal = vi.fn()
const cancelExitHandler = vi.fn()
vi.mock('../../src/renderer/src/services/terminalRegistry', () => ({
  destroyTerminal: (...args: unknown[]) => destroyTerminal(...args),
  cancelExitHandler: (...args: unknown[]) => cancelExitHandler(...args)
}))

import { useSpaceStore } from '../../src/renderer/src/stores/spaceStore'
import {
  patchBackgroundTab,
  findBackgroundSessionTab,
  closeBackgroundSessionTabs,
  syncBackgroundEditorTabsOnRename,
  spaceHasUnsavedEditors
} from '../../src/renderer/src/stores/spaceStore'
import { useTerminalStore } from '../../src/renderer/src/stores/terminalStore'
import { useProjectStore, type ResolvedAISession } from '../../src/renderer/src/stores/projectStore'
import { startProjectSession, openProjectTerminal } from '../../src/renderer/src/utils/spaceStart'
import {
  stashParkedEditorBuffer,
  clearParkedEditorBuffer,
  hasParkedEditorBuffer
} from '../../src/renderer/src/services/parkedEditorBuffers'
import { registerFileEditor } from '../../src/renderer/src/services/fileEditorRegistry'
import type {
  EditorGroup,
  FileEditorTab,
  Space,
  TerminalTab,
  WorkspaceSnapshot
} from '../../src/renderer/src/types'

const saveSpaces = vi.fn().mockResolvedValue(undefined)
const saveSpacesSync = vi.fn()
const closeSession = vi.fn().mockResolvedValue(undefined)
const mergeSettings = vi.fn().mockResolvedValue(undefined)
let loadSpacesResult: unknown = null

function installWindow(): void {
  ;(globalThis as { window?: unknown }).window = {
    dplex: {
      spaces: {
        load: vi.fn().mockImplementation(() => Promise.resolve(loadSpacesResult)),
        save: (...a: unknown[]) => saveSpaces(...a),
        saveSync: (...a: unknown[]) => saveSpacesSync(...a)
      },
      sessions: {
        close: (...a: unknown[]) => closeSession(...a),
        getResumeCommand: vi.fn().mockResolvedValue('copilot --resume')
      },
      settings: {
        getAll: vi.fn().mockResolvedValue({}),
        merge: (...a: unknown[]) => mergeSettings(...a)
      }
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }
  // projectStore schedules a DOM scroll-into-view via rAF on active-project
  // changes; a no-op stub keeps that off the node test path.
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0
}

function aiTab(id: string, sessionId: string, cwd: string): TerminalTab {
  return { id, title: id, cwd, command: 'copilot', sessionId, providerId: 'copilot-cli' }
}

function group(id: string, tabs: TerminalTab[]): EditorGroup {
  return { id, tabs, activeTabId: tabs[0]?.id ?? '' }
}

function fileTab(
  id: string,
  rootFs: string,
  relPath: string,
  opts: { dirty?: boolean } = {}
): FileEditorTab {
  return {
    id,
    title: relPath.split('/').pop() ?? relPath,
    kind: 'fileEditor',
    rootFs,
    rootLabel: 'proj',
    relPath,
    dirty: opts.dirty
  }
}

/** A group holding arbitrary editor tabs (terminal and/or fileEditor). */
function mixedGroup(id: string, tabs: (TerminalTab | FileEditorTab)[]): EditorGroup {
  return { id, tabs, activeTabId: tabs[0]?.id ?? '' }
}

function snapshot(groups: EditorGroup[]): WorkspaceSnapshot {
  return {
    layout: { type: 'group', groupId: groups[0]?.id ?? 'g' },
    groups,
    activeGroupId: groups[0]?.id ?? null
  }
}

/** A standalone Space fixture (for tests that set store state directly rather
 *  than through `seed`, e.g. Overview → background-space transitions). */
function bgSpace(id: string, workspace: WorkspaceSnapshot, projectIds: string[] = []): Space {
  const now = Date.now()
  return {
    id,
    name: id,
    color: '#6E8BFF',
    projectIds,
    workspace,
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now
  }
}

function resetTerminal(groups: EditorGroup[] = []): void {
  useTerminalStore.setState({
    groups,
    layout: { type: 'group', groupId: groups[0]?.id ?? '' },
    activeGroupId: groups[0]?.id ?? null,
    restored: false
  } as never)
}

beforeEach(() => {
  installWindow()
  loadSpacesResult = null
  destroyTerminal.mockReset()
  cancelExitHandler.mockReset()
  saveSpaces.mockClear()
  saveSpacesSync.mockClear()
  closeSession.mockClear()
  mergeSettings.mockClear()
  resetTerminal([])
  useProjectStore.setState({ projects: [], activeProjectId: null } as never)
  useSpaceStore.setState({ spaces: [], activeSpaceId: null, loaded: false })
})

afterEach(() => vi.restoreAllMocks())

/** Seed an active space A (its tabs live in the terminal store) plus any
 *  background spaces. Sets space state BEFORE the terminal store so the
 *  orphan-adoption subscription (which only fires while activeSpaceId===null)
 *  never misfires during setup. */
function seed(
  active: { id: string; groups: EditorGroup[]; projectIds?: string[] },
  background: {
    id: string
    workspace: WorkspaceSnapshot
    projectIds?: string[]
  }[]
): void {
  const now = Date.now()
  const mk = (
    id: string,
    workspace: WorkspaceSnapshot,
    projectIds: string[] = []
  ): import('../../src/renderer/src/types').Space => ({
    id,
    name: id,
    color: '#6E8BFF',
    projectIds,
    workspace,
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now
  })
  useSpaceStore.setState({
    spaces: [
      mk(active.id, snapshot(active.groups), active.projectIds),
      ...background.map((b) => mk(b.id, b.workspace, b.projectIds))
    ],
    activeSpaceId: active.id,
    loaded: true
  })
  resetTerminal(active.groups)
}

describe('spaceStore.hydrate', () => {
  it('seeds a single active "My Work" space on a fresh install', async () => {
    loadSpacesResult = null
    await useSpaceStore.getState().hydrate()
    const st = useSpaceStore.getState()
    expect(st.spaces).toHaveLength(1)
    expect(st.spaces[0].name).toBe('My Work')
    expect(st.activeSpaceId).toBe(st.spaces[0].id)
    expect(st.loaded).toBe(true)
  })

  it('restores the active space workspace into the terminal store', async () => {
    loadSpacesResult = {
      version: 1,
      activeSpaceId: 's1',
      spaces: [
        {
          id: 's1',
          name: 'Ship OAuth',
          color: '#6E8BFF',
          projectIds: ['p1'],
          workspace: {
            layout: { type: 'group', groupId: 'g1' },
            groups: [{ id: 'g1', tabs: [aiTab('t1', 'sess1', '/repo-a')], activeTabId: 't1' }],
            activeGroupId: 'g1',
            savedAt: new Date().toISOString()
          },
          createdAt: 1,
          updatedAt: 1,
          lastActiveAt: 1
        }
      ]
    }
    await useSpaceStore.getState().hydrate()
    expect(useSpaceStore.getState().activeSpaceId).toBe('s1')
    const groups = useTerminalStore.getState().groups
    expect(groups).toHaveLength(1)
    expect(groups[0].tabs[0].id).toBe('t1')
  })

  it('preserves work started during the async boot window instead of clobbering it', async () => {
    // A valid on-disk file exists…
    loadSpacesResult = {
      version: 1,
      activeSpaceId: 's1',
      spaces: [
        {
          id: 's1',
          name: 'Ship OAuth',
          color: '#6E8BFF',
          projectIds: [],
          workspace: {
            layout: { type: 'group', groupId: 'g1' },
            groups: [{ id: 'g1', tabs: [aiTab('t1', 'sess1', '/repo-a')], activeTabId: 't1' }],
            activeGroupId: 'g1'
          },
          createdAt: 1,
          updatedAt: 1,
          lastActiveAt: 1
        }
      ]
    }
    // …but the user already started a session before load resolved (loaded is
    // still false, so the orphan-adoption net stays dormant during setup).
    resetTerminal([group('gEarly', [aiTab('early1', 'sessEarly', '/repo-x')])])

    await useSpaceStore.getState().hydrate()

    const st = useSpaceStore.getState()
    // The early work became the active space — not discarded by the loaded file.
    const active = st.spaces.find((s) => s.id === st.activeSpaceId)!
    expect(active.workspace.groups[0].tabs[0].id).toBe('early1')
    expect(st.activeSpaceId).not.toBe('s1')
    // The loaded space is kept alive in the background.
    expect(st.spaces.some((s) => s.id === 's1')).toBe(true)
    // The live workspace was never swapped away (early PTYs stay mounted).
    expect(useTerminalStore.getState().groups[0].tabs[0].id).toBe('early1')
    expect(destroyTerminal).not.toHaveBeenCalled()
  })

  it('lands on the Overview for a valid but empty spaces file (no reseed)', async () => {
    // The user deleted all their spaces last session — a valid, empty file must
    // be honoured as the Overview, not mistaken for a fresh install.
    loadSpacesResult = { version: 1, activeSpaceId: null, spaces: [] }
    await useSpaceStore.getState().hydrate()
    const st = useSpaceStore.getState()
    expect(st.spaces).toHaveLength(0)
    expect(st.activeSpaceId).toBeNull()
    expect(st.loaded).toBe(true)
  })

  it('ignores a non-string persisted glyph without crashing', async () => {
    loadSpacesResult = {
      version: 1,
      activeSpaceId: 's1',
      spaces: [
        {
          id: 's1',
          name: 'Weird',
          color: '#6E8BFF',
          glyph: 42,
          projectIds: [],
          workspace: { layout: { type: 'group', groupId: 'g1' }, groups: [], activeGroupId: null },
          createdAt: 1,
          updatedAt: 1,
          lastActiveAt: 1
        }
      ]
    }
    await useSpaceStore.getState().hydrate()
    const s = useSpaceStore.getState().spaces.find((x) => x.id === 's1')!
    expect(s.glyph).toBeUndefined()
  })

  it('preserves a space created during the async load window', async () => {
    loadSpacesResult = {
      version: 1,
      activeSpaceId: 's1',
      spaces: [
        {
          id: 's1',
          name: 'Ship OAuth',
          color: '#6E8BFF',
          projectIds: [],
          workspace: {
            layout: { type: 'group', groupId: 'g1' },
            groups: [{ id: 'g1', tabs: [aiTab('t1', 'sess1', '/repo-a')], activeTabId: 't1' }],
            activeGroupId: 'g1'
          },
          createdAt: 1,
          updatedAt: 1,
          lastActiveAt: 1
        }
      ]
    }
    // Kick off hydrate but don't await; create a space while it is still loading
    // (the sidebar stays interactive during boot). createSpace runs
    // synchronously before the pending load() resolves.
    const pending = useSpaceStore.getState().hydrate()
    const newId = useSpaceStore.getState().createSpace({ name: 'Hotfix' })
    await pending

    const st = useSpaceStore.getState()
    // Both the loaded space and the one created mid-load survive the final set.
    expect(st.spaces.some((s) => s.id === 's1')).toBe(true)
    expect(st.spaces.some((s) => s.id === newId)).toBe(true)
    // The user's in-window creation wins as the active space over the stale
    // persisted pointer.
    expect(st.activeSpaceId).toBe(newId)
  })

  it('drops a malformed array entry instead of resurrecting it as a bogus space', async () => {
    loadSpacesResult = {
      version: 1,
      activeSpaceId: 's1',
      spaces: [
        [],
        {
          id: 's1',
          name: 'Real',
          color: '#6E8BFF',
          projectIds: [],
          workspace: { layout: { type: 'group', groupId: 'g1' }, groups: [], activeGroupId: null },
          createdAt: 1,
          updatedAt: 1,
          lastActiveAt: 1
        }
      ]
    }
    await useSpaceStore.getState().hydrate()
    const st = useSpaceStore.getState()
    // The `[]` element (typeof 'object') is dropped; only the real space remains.
    expect(st.spaces).toHaveLength(1)
    expect(st.spaces[0].id).toBe('s1')
  })

  it('keeps a space created during the load window on a fresh install (no My Work clobber)', async () => {
    loadSpacesResult = null // fresh install: no file and no legacy workspace
    const pending = useSpaceStore.getState().hydrate()
    const newId = useSpaceStore.getState().createSpace({ name: 'Hotfix' })
    await pending

    const st = useSpaceStore.getState()
    // The created space survives; we did NOT seed "My Work" over it.
    expect(st.spaces.some((s) => s.id === newId)).toBe(true)
    expect(st.spaces.every((s) => s.name !== 'My Work')).toBe(true)
    expect(st.activeSpaceId).toBe(newId)
    expect(st.loaded).toBe(true)
  })

  it('attaches mid-boot early work to the space the user created for it (no throwaway space)', async () => {
    // A valid on-disk file with one space…
    loadSpacesResult = {
      version: 1,
      activeSpaceId: 's1',
      spaces: [
        {
          id: 's1',
          name: 'Ship OAuth',
          color: '#6E8BFF',
          projectIds: [],
          workspace: {
            layout: { type: 'group', groupId: 'g1' },
            groups: [{ id: 'g1', tabs: [aiTab('t1', 'sess1', '/repo-a')], activeTabId: 't1' }],
            activeGroupId: 'g1'
          },
          createdAt: 1,
          updatedAt: 1,
          lastActiveAt: 1
        }
      ]
    }
    // Mid-boot the user creates a space (activating it) AND starts terminal work
    // in it — the created space is now in the store while early work sits live
    // in the terminal store when the load resolves.
    const pending = useSpaceStore.getState().hydrate()
    const hotfixId = useSpaceStore.getState().createSpace({ name: 'Hotfix' })
    resetTerminal([group('gEarly', [aiTab('early1', 'sessEarly', '/repo-x')])])
    await pending

    const st = useSpaceStore.getState()
    // Both survive — the loaded space stays in the background, the created one
    // is active. No throwaway third space is spun up.
    expect(st.spaces.some((s) => s.id === 's1')).toBe(true)
    expect(st.spaces.some((s) => s.id === hotfixId)).toBe(true)
    expect(st.spaces).toHaveLength(2)
    // The user's live work attaches to the space they created for it (Hotfix),
    // NOT an auto-named adopted space, and stays intact.
    expect(st.activeSpaceId).toBe(hotfixId)
    const active = st.spaces.find((s) => s.id === st.activeSpaceId)!
    expect(active.id).toBe(hotfixId)
    expect(active.workspace.groups[0].tabs[0].id).toBe('early1')
    expect(useTerminalStore.getState().groups[0].tabs[0].id).toBe('early1')
    expect(destroyTerminal).not.toHaveBeenCalled()
  })
})

describe('spaceStore.persist', () => {
  it('does not write during the async boot window (no clobber before hydrate commits)', () => {
    // Not loaded yet: a sync save must be suppressed so the on-disk file stays
    // the source of truth until reconstruction lands.
    useSpaceStore.setState({
      spaces: [bgSpace('s1', snapshot([]))],
      activeSpaceId: 's1',
      loaded: false
    })
    useSpaceStore.getState().persistNow()
    expect(saveSpacesSync).not.toHaveBeenCalled()
    // Once loaded, a sync save goes through.
    useSpaceStore.setState({ loaded: true })
    useSpaceStore.getState().persistNow()
    expect(saveSpacesSync).toHaveBeenCalledTimes(1)
  })
})

describe('spaceStore.switchSpace', () => {
  it('preserves running terminals (never destroys) and swaps in the target workspace', () => {
    const bgWorkspace = snapshot([group('gB', [aiTab('b1', 'sb1', '/repo-b')])])
    seed({ id: 'A', groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a')])] }, [
      { id: 'B', workspace: bgWorkspace }
    ])

    useSpaceStore.getState().switchSpace('B')

    // The linchpin: switching must not tear down any terminal.
    expect(destroyTerminal).not.toHaveBeenCalled()
    // Target workspace is now live.
    const groups = useTerminalStore.getState().groups
    expect(groups).toHaveLength(1)
    expect(groups[0].tabs[0].id).toBe('b1')
    expect(useSpaceStore.getState().activeSpaceId).toBe('B')
  })

  it('auto-backgrounds the previous space, stashing its live arrangement', () => {
    seed({ id: 'A', groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a')])] }, [
      { id: 'B', workspace: snapshot([group('gB', [aiTab('b1', 'sb1', '/repo-b')])]) }
    ])

    useSpaceStore.getState().switchSpace('B')

    const A = useSpaceStore.getState().spaces.find((s) => s.id === 'A')!
    expect(A.workspace.groups[0].tabs[0].id).toBe('a1') // stashed, still there
  })

  it('is a no-op when switching to the already-active space', () => {
    seed({ id: 'A', groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a')])] }, [])
    useSpaceStore.getState().switchSpace('A')
    expect(useSpaceStore.getState().activeSpaceId).toBe('A')
    expect(destroyTerminal).not.toHaveBeenCalled()
  })

  it('switching in from the Overview does not misfire orphan adoption', () => {
    // On the Overview (nothing in focus) with one background space that has tabs.
    const B = bgSpace('B', snapshot([group('gB', [aiTab('b1', 'sb1', '/repo-b')])]))
    useSpaceStore.setState({ spaces: [B], activeSpaceId: null, loaded: true })
    resetTerminal([]) // Overview: empty workspace
    mergeSettings.mockClear() // ignore any setup writes

    useSpaceStore.getState().switchSpace('B')

    // No spurious adopted space leaked from the 0→>0 swap.
    expect(useSpaceStore.getState().spaces).toHaveLength(1)
    expect(useSpaceStore.getState().activeSpaceId).toBe('B')
    // Active-project sync (which persists via settings.merge) runs exactly once,
    // from switchSpace — the orphan net didn't also fire during the swap.
    expect(mergeSettings).toHaveBeenCalledTimes(1)
    expect(destroyTerminal).not.toHaveBeenCalled()
  })

  it('adopts orphaned live work into a background space before swapping (boot-race guard)', () => {
    // Boot-window race: while hydrate ran (loaded=false) the orphan-adoption net
    // was dormant, so early terminal work that appeared went unclaimed. Now
    // loaded, with nothing in focus, switching to B must NOT swap that work away
    // — it adopts it into a background space first so its PTYs are preserved.
    const B = bgSpace('B', snapshot([group('gB', [aiTab('b1', 'sb1', '/repo-b')])]))
    useSpaceStore.setState({ spaces: [B], activeSpaceId: null, loaded: false })
    resetTerminal([group('gEarly', [aiTab('early1', 'sEarly', '/repo-early')])])
    // Hydrate finishes; the net never fired for the already-present early work.
    useSpaceStore.setState({ loaded: true })

    useSpaceStore.getState().switchSpace('B')

    const st = useSpaceStore.getState()
    // The early work was adopted into a NEW background space (not discarded).
    expect(st.spaces).toHaveLength(2)
    const adopted = st.spaces.find((s) => s.id !== 'B')!
    expect(adopted.workspace.groups[0].tabs[0].id).toBe('early1')
    // Target B is now live; the early work's terminal was never destroyed.
    expect(st.activeSpaceId).toBe('B')
    expect(useTerminalStore.getState().groups[0].tabs[0].id).toBe('b1')
    expect(destroyTerminal).not.toHaveBeenCalled()
  })
})

describe('spaceStore.sendToBackground', () => {
  it('clears focus to the Overview and empties the workspace, keeping the space alive', () => {
    seed({ id: 'A', groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a')])] }, [])

    useSpaceStore.getState().sendToBackground()

    expect(useSpaceStore.getState().activeSpaceId).toBeNull()
    expect(useTerminalStore.getState().groups).toHaveLength(0)
    // Its arrangement is stashed, so it can be resumed verbatim later.
    const A = useSpaceStore.getState().spaces.find((s) => s.id === 'A')!
    expect(A.workspace.groups[0].tabs[0].id).toBe('a1')
    expect(destroyTerminal).not.toHaveBeenCalled()
    // Active project is cleared on the Overview.
    expect(useProjectStore.getState().activeProjectId).toBeNull()
  })
})

describe('spaceStore.focusForDeferredWork', () => {
  it('is a no-op when the origin is null (deferred work started from the Overview)', () => {
    seed({ id: 'A', groups: [group('gA', [aiTab('a1', 'sa', '/a')])] }, [
      { id: 'B', workspace: snapshot([group('gB', [aiTab('b1', 'sb', '/b')])]) }
    ])
    useSpaceStore.getState().switchSpace('B')
    useSpaceStore.getState().focusForDeferredWork(null)
    // Focus is unchanged — no forced switch.
    expect(useSpaceStore.getState().activeSpaceId).toBe('B')
    expect(destroyTerminal).not.toHaveBeenCalled()
  })

  it('is a no-op when the origin space is already active', () => {
    seed({ id: 'A', groups: [group('gA', [aiTab('a1', 'sa', '/a')])] }, [])
    useSpaceStore.getState().focusForDeferredWork('A')
    expect(useSpaceStore.getState().activeSpaceId).toBe('A')
  })

  it('is a no-op when the origin space was deleted during the async gap', () => {
    seed({ id: 'A', groups: [group('gA', [aiTab('a1', 'sa', '/a')])] }, [
      { id: 'B', workspace: snapshot([group('gB', [aiTab('b1', 'sb', '/b')])]) }
    ])
    useSpaceStore.getState().switchSpace('B')
    useSpaceStore.getState().focusForDeferredWork('gone')
    expect(useSpaceStore.getState().activeSpaceId).toBe('B')
  })

  it('switches back to the origin space when focus moved away mid-resolve', () => {
    seed({ id: 'A', groups: [group('gA', [aiTab('a1', 'sa', '/a')])] }, [
      { id: 'B', workspace: snapshot([group('gB', [aiTab('b1', 'sb', '/b')])]) }
    ])
    // Deferred work launched from A; the user switched to B during the gap.
    useSpaceStore.getState().switchSpace('B')
    expect(useSpaceStore.getState().activeSpaceId).toBe('B')
    useSpaceStore.getState().focusForDeferredWork('A')
    // Focus returns to the originating space so the tab lands there.
    expect(useSpaceStore.getState().activeSpaceId).toBe('A')
    // Never tears down B's terminals (it keeps running in the background).
    expect(destroyTerminal).not.toHaveBeenCalled()
  })
})

describe('spaceStore.patchBackgroundTab', () => {
  it('updates a tab inside a background space snapshot and reports it found', () => {
    seed({ id: 'A', groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a')])] }, [
      { id: 'B', workspace: snapshot([group('gB', [aiTab('b1', 'sb1', '/repo-b')])]) }
    ])
    const before = useSpaceStore.getState().spaces
    expect(patchBackgroundTab('b1', { title: 'renamed' })).toBe(true)
    const after = useSpaceStore.getState().spaces
    expect(after).not.toBe(before) // a real change → new state reference
    expect(after.find((s) => s.id === 'B')!.workspace.groups[0].tabs[0].title).toBe('renamed')
  })

  it('is a no-op (no state churn, no disk write) when nothing actually changes', () => {
    seed({ id: 'A', groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a')])] }, [
      { id: 'B', workspace: snapshot([group('gB', [aiTab('b1', 'sb1', '/repo-b')])]) }
    ])
    const before = useSpaceStore.getState().spaces
    saveSpaces.mockClear()
    // aiTab titles default to the id, so patching with the same title is a no-op.
    expect(patchBackgroundTab('b1', { title: 'b1' })).toBe(true)
    expect(useSpaceStore.getState().spaces).toBe(before) // identical reference
    expect(saveSpaces).not.toHaveBeenCalled()
  })

  it('ignores tabs that live in the active space (owned by the terminal store)', () => {
    seed({ id: 'A', groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a')])] }, [])
    expect(patchBackgroundTab('a1', { title: 'renamed' })).toBe(false)
  })

  it('returns false for an unknown tab id', () => {
    seed({ id: 'A', groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a')])] }, [
      { id: 'B', workspace: snapshot([group('gB', [aiTab('b1', 'sb1', '/repo-b')])]) }
    ])
    expect(patchBackgroundTab('nope', { title: 'x' })).toBe(false)
  })
})

describe('spaceStore cross-space session lookup/close', () => {
  it('finds a session parked in a background space, skipping the active space', () => {
    seed({ id: 'A', groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a')])] }, [
      { id: 'B', workspace: snapshot([group('gB', [aiTab('b1', 'sb1', '/repo-b')])]) }
    ])
    expect(findBackgroundSessionTab('sb1', 'copilot-cli')).toEqual({
      spaceId: 'B',
      groupId: 'gB',
      tabId: 'b1'
    })
  })

  it('does not find a session that lives in the active space', () => {
    seed({ id: 'A', groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a')])] }, [])
    expect(findBackgroundSessionTab('sa1', 'copilot-cli')).toBeNull()
  })

  it('returns null when no background space holds the session', () => {
    seed({ id: 'A', groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a')])] }, [
      { id: 'B', workspace: snapshot([group('gB', [aiTab('b1', 'sb1', '/repo-b')])]) }
    ])
    expect(findBackgroundSessionTab('ghost', 'copilot-cli')).toBeNull()
  })

  it('closes a parked session: destroys its terminal, closes it, prunes the snapshot', () => {
    seed({ id: 'A', groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a')])] }, [
      {
        id: 'B',
        workspace: snapshot([
          group('gB', [aiTab('b1', 'sb1', '/repo-b'), aiTab('b2', 'sb2', '/repo-b')])
        ])
      }
    ])
    expect(closeBackgroundSessionTabs('sb1', 'copilot-cli')).toBe(true)
    expect(destroyTerminal).toHaveBeenCalledWith('b1')
    expect(closeSession).toHaveBeenCalledWith('sb1', 'copilot-cli')
    const B = useSpaceStore.getState().spaces.find((s) => s.id === 'B')!
    expect(B.workspace.groups[0].tabs.map((t) => t.id)).toEqual(['b2'])
  })

  it('empties a background space workspace when its last tab is closed', () => {
    seed({ id: 'A', groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a')])] }, [
      { id: 'B', workspace: snapshot([group('gB', [aiTab('b1', 'sb1', '/repo-b')])]) }
    ])
    expect(closeBackgroundSessionTabs('sb1', 'copilot-cli')).toBe(true)
    expect(
      useSpaceStore.getState().spaces.find((s) => s.id === 'B')!.workspace.groups
    ).toHaveLength(0)
  })

  it('never touches the active space and returns false when the session is only active', () => {
    seed({ id: 'A', groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a')])] }, [])
    expect(closeBackgroundSessionTabs('sa1', 'copilot-cli')).toBe(false)
    expect(destroyTerminal).not.toHaveBeenCalled()
    expect(closeSession).not.toHaveBeenCalled()
  })
})

describe('spaceStore.addProjectToSpace', () => {
  it('appends a project after the primary (never displaces projectIds[0])', () => {
    seed(
      { id: 'A', groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a')])], projectIds: ['p1'] },
      []
    )

    useSpaceStore.getState().addProjectToSpace('A', 'p2')

    const space = useSpaceStore.getState().spaces.find((s) => s.id === 'A')
    expect(space?.projectIds).toEqual(['p1', 'p2'])
  })

  it('is a no-op when the project is already bound (no duplicates)', () => {
    seed(
      { id: 'A', groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a')])], projectIds: ['p1', 'p2'] },
      []
    )
    const before = useSpaceStore.getState().spaces.find((s) => s.id === 'A')?.updatedAt

    useSpaceStore.getState().addProjectToSpace('A', 'p1')

    const space = useSpaceStore.getState().spaces.find((s) => s.id === 'A')
    expect(space?.projectIds).toEqual(['p1', 'p2'])
    // Untouched: same object, updatedAt not bumped.
    expect(space?.updatedAt).toBe(before)
  })

  it('is a no-op when the space no longer exists', () => {
    seed(
      { id: 'A', groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a')])], projectIds: ['p1'] },
      []
    )

    expect(() => useSpaceStore.getState().addProjectToSpace('gone', 'p2')).not.toThrow()
    expect(useSpaceStore.getState().spaces.find((s) => s.id === 'A')?.projectIds).toEqual(['p1'])
  })

  it('binds a project to a background space without touching the active one', () => {
    seed({ id: 'A', groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a')])], projectIds: ['p1'] }, [
      {
        id: 'B',
        workspace: snapshot([group('gB', [aiTab('b1', 'sb1', '/repo-b')])]),
        projectIds: []
      }
    ])

    useSpaceStore.getState().addProjectToSpace('B', 'p2')

    expect(useSpaceStore.getState().spaces.find((s) => s.id === 'B')?.projectIds).toEqual(['p2'])
    expect(useSpaceStore.getState().spaces.find((s) => s.id === 'A')?.projectIds).toEqual(['p1'])
  })
})

describe('spaceStore multi-project binding', () => {
  it('drives the active project from projectIds[0] and retains tabs from every project', () => {
    useProjectStore.setState({
      projects: [
        { id: 'p1', name: 'repo-a', path: '/repo-a', addedAt: '' },
        { id: 'p2', name: 'repo-b', path: '/repo-b', addedAt: '' }
      ],
      activeProjectId: null
    } as never)

    const multi = snapshot([
      group('gA', [aiTab('a1', 'sa1', '/repo-a')]),
      group('gB', [aiTab('b1', 'sb1', '/repo-b')])
    ])
    seed({ id: 'A', groups: [group('g0', [aiTab('x', 'sx', '/x')])] }, [
      { id: 'multi', workspace: multi, projectIds: ['p1', 'p2'] }
    ])

    useSpaceStore.getState().switchSpace('multi')

    expect(useProjectStore.getState().activeProjectId).toBe('p1') // primary = projectIds[0]
    const groups = useTerminalStore.getState().groups
    expect(groups).toHaveLength(2)
    const cwds = groups.flatMap((g) => g.tabs.map((t) => (t as TerminalTab).cwd)).sort()
    expect(cwds).toEqual(['/repo-a', '/repo-b'])
  })
})

describe('spaceStore.deleteSpace', () => {
  it('tears down a background space terminals (closes session + destroys pty)', () => {
    seed({ id: 'A', groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a')])] }, [
      { id: 'B', workspace: snapshot([group('gB', [aiTab('b1', 'sb1', '/repo-b')])]) }
    ])

    useSpaceStore.getState().deleteSpace('B')

    expect(useSpaceStore.getState().spaces.find((s) => s.id === 'B')).toBeUndefined()
    expect(destroyTerminal).toHaveBeenCalledWith('b1')
    expect(closeSession).toHaveBeenCalledWith('sb1', 'copilot-cli')
    // The active space is untouched.
    expect(useSpaceStore.getState().activeSpaceId).toBe('A')
    expect(destroyTerminal).not.toHaveBeenCalledWith('a1')
  })

  it('deleting the active space lands on the Overview and empties the workspace', () => {
    seed({ id: 'A', groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a')])] }, [])

    useSpaceStore.getState().deleteSpace('A')

    expect(useSpaceStore.getState().activeSpaceId).toBeNull()
    expect(useTerminalStore.getState().groups).toHaveLength(0)
    expect(destroyTerminal).toHaveBeenCalledWith('a1')
  })

  it('cancels each terminal pending exit handler before destroying it', () => {
    // Regression: destroyTerminal fires pending exit handlers. A worktree setup
    // script's handler re-focuses its origin Space and spawns its afterCreate
    // tab — which, mid-delete, would re-enter the Space being removed (dangling
    // activeSpaceId + orphan tab). deleteSpace must cancel handlers first.
    seed({ id: 'A', groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a')])] }, [
      { id: 'B', workspace: snapshot([group('gB', [aiTab('b1', 'sb1', '/repo-b')])]) }
    ])

    useSpaceStore.getState().deleteSpace('B')

    expect(cancelExitHandler).toHaveBeenCalledWith('b1')
    // Order matters: cancel must precede destroy (which fires exit handlers).
    expect(cancelExitHandler.mock.invocationCallOrder[0]).toBeLessThan(
      destroyTerminal.mock.invocationCallOrder[0]
    )
    // The active space is untouched — no re-entrant switch.
    expect(useSpaceStore.getState().activeSpaceId).toBe('A')
  })
})

describe('spaceStore orphan adoption (start work from the Overview)', () => {
  it('gives the adopted space a neutral name but binds the triggering tab’s project', () => {
    useProjectStore.setState({
      projects: [{ id: 'p1', name: 'DPlex', path: '/repo-a', addedAt: '' }],
      activeProjectId: null
    } as never)
    // On the Overview: nothing in focus, but spaces have loaded.
    useSpaceStore.setState({ spaces: [], activeSpaceId: null, loaded: true })
    resetTerminal([])

    // Work starts from the Overview: groups go 0 → >0 while activeSpaceId=null.
    resetTerminal([group('gA', [aiTab('a1', 'sa1', '/repo-a')])])

    const st = useSpaceStore.getState()
    expect(st.spaces).toHaveLength(1)
    expect(st.spaces[0].name).toBe('Untitled Space 1') // neutral, not the project name
    expect(st.spaces[0].projectIds).toEqual(['p1']) // …but still bound to the project
    expect(st.activeSpaceId).toBe(st.spaces[0].id)
    expect(destroyTerminal).not.toHaveBeenCalled()
  })

  it('gives a neutral name when no project matches (no binding)', () => {
    useProjectStore.setState({ projects: [], activeProjectId: null } as never)
    useSpaceStore.setState({ spaces: [], activeSpaceId: null, loaded: true })
    resetTerminal([])

    resetTerminal([group('gA', [aiTab('a1', 'sa1', '/Users/me/experiments/scratch')])])

    const st = useSpaceStore.getState()
    expect(st.spaces).toHaveLength(1)
    expect(st.spaces[0].name).toBe('Untitled Space 1')
    expect(st.spaces[0].projectIds).toEqual([])
  })

  it('increments the Untitled Space number past existing ones', () => {
    useProjectStore.setState({ projects: [], activeProjectId: null } as never)
    // An earlier auto-created space already holds the number 1.
    useSpaceStore.setState({
      spaces: [bgSpace('Untitled Space 1', snapshot([]))],
      activeSpaceId: null,
      loaded: true
    })
    resetTerminal([])

    resetTerminal([group('gA', [aiTab('a1', 'sa1', '/repo-a')])])

    const st = useSpaceStore.getState()
    expect(st.spaces).toHaveLength(2)
    const adopted = st.spaces.find((s) => s.id === st.activeSpaceId)
    expect(adopted?.name).toBe('Untitled Space 2')
  })

  it('does not adopt when a space is already in focus (populates it instead)', () => {
    useProjectStore.setState({ projects: [], activeProjectId: null } as never)
    // Focused space A with no tabs (the empty SpaceWelcome state).
    seed({ id: 'A', groups: [] }, [])
    expect(useTerminalStore.getState().groups).toHaveLength(0)

    // Start work — groups go 0 → >0 while A is in focus.
    resetTerminal([group('gA', [aiTab('a1', 'sa1', '/repo-a')])])

    // No new space is created; A stays in focus.
    expect(useSpaceStore.getState().spaces).toHaveLength(1)
    expect(useSpaceStore.getState().activeSpaceId).toBe('A')
  })

  it('does not adopt while spaces are still loading', () => {
    useProjectStore.setState({ projects: [], activeProjectId: null } as never)
    useSpaceStore.setState({ spaces: [], activeSpaceId: null, loaded: false })
    resetTerminal([])

    resetTerminal([group('gA', [aiTab('a1', 'sa1', '/repo-a')])])

    expect(useSpaceStore.getState().spaces).toHaveLength(0)
  })
})

describe('startProjectSession space targeting', () => {
  const project = { id: 'p', name: 'repo-a', path: '/repo-a', addedAt: '' }
  const resolved: ResolvedAISession = {
    command: 'copilot',
    title: 'Copilot · repo-a',
    providerId: 'copilot-cli',
    cwd: '/repo-a'
  }

  it('creates the session in the space it was launched from even if focus moves mid-resolve', async () => {
    seed({ id: 'A', groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a')])] }, [
      { id: 'B', workspace: snapshot([group('gB', [aiTab('b1', 'sb1', '/repo-b')])]) }
    ])

    // Hold provider resolution open so we can switch spaces before it settles.
    let settle!: (v: ResolvedAISession | null) => void
    const pending = new Promise<ResolvedAISession | null>((r) => {
      settle = r
    })
    const createTab = vi.fn().mockReturnValue('new-tab')
    useProjectStore.setState({
      resolveAISession: vi.fn().mockReturnValue(pending),
      createAISessionTab: createTab
    } as never)

    // Launch from A, then the user jumps to B while resolution is in-flight.
    startProjectSession(project, 'copilot-cli')
    useSpaceStore.getState().switchSpace('B')
    expect(useSpaceStore.getState().activeSpaceId).toBe('B')

    // Provider resolves — the session must land back in its origin space A.
    settle(resolved)
    await pending
    await Promise.resolve()

    expect(useSpaceStore.getState().activeSpaceId).toBe('A')
    expect(createTab).toHaveBeenCalledTimes(1)
    // Re-focusing to honor the origin space must never tear a terminal down.
    expect(destroyTerminal).not.toHaveBeenCalled()
  })

  it('does not force focus when launched from the Overview (lands where work now goes)', async () => {
    // Overview → user opens space B during resolution; the session should not
    // yank them back to the Overview.
    const B = bgSpace('B', snapshot([group('gB', [aiTab('b1', 'sb1', '/repo-b')])]))
    useSpaceStore.setState({ spaces: [B], activeSpaceId: null, loaded: true })
    resetTerminal([])

    let settle!: (v: ResolvedAISession | null) => void
    const pending = new Promise<ResolvedAISession | null>((r) => {
      settle = r
    })
    const createTab = vi.fn().mockReturnValue('new-tab')
    useProjectStore.setState({
      resolveAISession: vi.fn().mockReturnValue(pending),
      createAISessionTab: createTab
    } as never)

    startProjectSession(project, 'copilot-cli')
    useSpaceStore.getState().switchSpace('B')

    settle(resolved)
    await pending
    await Promise.resolve()

    // Origin was the Overview (no space), so focus stays on B.
    expect(useSpaceStore.getState().activeSpaceId).toBe('B')
    expect(createTab).toHaveBeenCalledTimes(1)
  })

  it('binds the project to the origin space when it was not already a member', async () => {
    seed(
      { id: 'A', groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a')])], projectIds: ['other'] },
      []
    )

    const settled = Promise.resolve<ResolvedAISession | null>(resolved)
    useProjectStore.setState({
      resolveAISession: vi.fn().mockReturnValue(settled),
      createAISessionTab: vi.fn().mockReturnValue('new-tab')
    } as never)

    startProjectSession(project, 'copilot-cli')
    await settled
    await Promise.resolve()

    // Appended after the existing primary, which is left in place.
    expect(useSpaceStore.getState().spaces.find((s) => s.id === 'A')?.projectIds).toEqual([
      'other',
      'p'
    ])
  })

  it('does not bind the project when launched from the Overview (orphan adoption handles it)', async () => {
    const B = bgSpace('B', snapshot([group('gB', [aiTab('b1', 'sb1', '/repo-b')])]))
    useSpaceStore.setState({ spaces: [B], activeSpaceId: null, loaded: true })
    resetTerminal([])

    const settled = Promise.resolve<ResolvedAISession | null>(resolved)
    useProjectStore.setState({
      resolveAISession: vi.fn().mockReturnValue(settled),
      createAISessionTab: vi.fn().mockReturnValue('new-tab')
    } as never)

    startProjectSession(project, 'copilot-cli')
    await settled
    await Promise.resolve()

    // No origin space → the background space B is left untouched.
    expect(useSpaceStore.getState().spaces.find((s) => s.id === 'B')?.projectIds).toEqual([])
  })
})

describe('openProjectTerminal space binding', () => {
  it('binds the project to the active space when opening its terminal', () => {
    seed({ id: 'A', groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a')])], projectIds: [] }, [])

    openProjectTerminal({ id: 'p', name: 'repo-a', path: '/repo-a', addedAt: '' })

    expect(useSpaceStore.getState().spaces.find((s) => s.id === 'A')?.projectIds).toEqual(['p'])
  })

  it('leaves binding to orphan adoption when opened from the Overview (no double bind)', () => {
    useProjectStore.setState({
      projects: [{ id: 'p', name: 'repo-a', path: '/repo-a', addedAt: '' }],
      activeProjectId: null
    } as never)
    useSpaceStore.setState({ spaces: [], activeSpaceId: null, loaded: true })
    resetTerminal([])

    openProjectTerminal({ id: 'p', name: 'repo-a', path: '/repo-a', addedAt: '' })

    // Orphan adoption creates one space bound to the project; the active-space
    // guard must not add a second (duplicate) binding on top of it.
    const spaces = useSpaceStore.getState().spaces
    expect(spaces).toHaveLength(1)
    expect(spaces[0].projectIds).toEqual(['p'])
  })
})

describe('spaceStore.pruneProject (project-removal cleanup)', () => {
  it('removes a project id from every space and reselects the active primary', () => {
    seed({ id: 'A', groups: [], projectIds: ['p1', 'p2'] }, [
      { id: 'B', workspace: snapshot([]), projectIds: ['p2', 'p3'] }
    ])

    useSpaceStore.getState().pruneProject('p1')

    const st = useSpaceStore.getState()
    expect(st.spaces.find((s) => s.id === 'A')!.projectIds).toEqual(['p2'])
    expect(st.spaces.find((s) => s.id === 'B')!.projectIds).toEqual(['p2', 'p3'])
    // A is active and its primary changed p1→p2, so the Projects panel retargets.
    expect(useProjectStore.getState().activeProjectId).toBe('p2')
  })

  it('leaves spaces untouched when none reference the removed project', () => {
    seed({ id: 'A', groups: [], projectIds: ['p1'] }, [])
    useSpaceStore.getState().pruneProject('pX')
    expect(useSpaceStore.getState().spaces[0].projectIds).toEqual(['p1'])
  })

  it('does not retarget the active project when the pruned project is not the active primary', () => {
    // Active space A's primary is p1; a background space B holds p2.
    seed({ id: 'A', groups: [], projectIds: ['p1'] }, [
      { id: 'B', workspace: snapshot([]), projectIds: ['p2'] }
    ])
    // The Projects panel is focused on a specific project.
    useProjectStore.setState({ activeProjectId: 'pFocused' } as never)

    // Remove p2 — bound only to the background space B.
    useSpaceStore.getState().pruneProject('p2')

    const st = useSpaceStore.getState()
    expect(st.spaces.find((s) => s.id === 'B')!.projectIds).toEqual([])
    // A's primary is unchanged, so the active-project focus must NOT be yanked.
    expect(useProjectStore.getState().activeProjectId).toBe('pFocused')
  })

  it('does not retarget when a non-primary member of the active space is pruned', () => {
    seed({ id: 'A', groups: [], projectIds: ['p1', 'p2'] }, [])
    useProjectStore.setState({ activeProjectId: 'pFocused' } as never)

    // Remove p2 — present in the active space but NOT its primary (p1).
    useSpaceStore.getState().pruneProject('p2')

    const st = useSpaceStore.getState()
    expect(st.spaces.find((s) => s.id === 'A')!.projectIds).toEqual(['p1'])
    expect(useProjectStore.getState().activeProjectId).toBe('pFocused')
  })

  it('prunes automatically when a project is removed from projectStore', () => {
    useProjectStore.setState({
      projects: [
        { id: 'p1', name: 'a', path: '/a', addedAt: '' },
        { id: 'p2', name: 'b', path: '/b', addedAt: '' }
      ]
    } as never)
    seed({ id: 'A', groups: [], projectIds: ['p1', 'p2'] }, [])

    // Genuine removal (p1 present before, gone now) → the subscription prunes it.
    useProjectStore.setState({
      projects: [{ id: 'p2', name: 'b', path: '/b', addedAt: '' }]
    } as never)

    expect(useSpaceStore.getState().spaces[0].projectIds).toEqual(['p2'])
  })

  it('does not prune on a project add (only genuine removals)', () => {
    seed({ id: 'A', groups: [], projectIds: ['p1'] }, [])
    useProjectStore.setState({
      projects: [
        { id: 'p1', name: 'a', path: '/a', addedAt: '' },
        { id: 'p2', name: 'b', path: '/b', addedAt: '' }
      ]
    } as never)
    expect(useSpaceStore.getState().spaces[0].projectIds).toEqual(['p1'])
  })
})

describe('spaceStore.syncBackgroundEditorTabsOnRename', () => {
  it('rewrites a renamed file in a background space, leaving the active space to the terminal store', () => {
    const activeGroups = [mixedGroup('gA', [fileTab('fa', '/repo', 'src/old.ts')])]
    const bgWs = snapshot([mixedGroup('gB', [fileTab('fb', '/repo', 'src/old.ts')])])
    useSpaceStore.setState({
      spaces: [bgSpace('A', snapshot(activeGroups)), bgSpace('B', bgWs)],
      activeSpaceId: 'A',
      loaded: true
    })
    resetTerminal(activeGroups)

    syncBackgroundEditorTabsOnRename('/repo', 'src/old.ts', 'src/new.ts')

    const st = useSpaceStore.getState()
    const bTab = st.spaces.find((s) => s.id === 'B')!.workspace.groups[0].tabs[0] as FileEditorTab
    expect(bTab.relPath).toBe('src/new.ts')
    expect(bTab.title).toBe('new.ts')
    // The ACTIVE space snapshot is deliberately not touched (the terminal store
    // owns it; fileExplorerStore.syncTabsOnRename updates the live tab).
    const aTab = st.spaces.find((s) => s.id === 'A')!.workspace.groups[0].tabs[0] as FileEditorTab
    expect(aTab.relPath).toBe('src/old.ts')
  })

  it('rewrites descendants on a folder rename', () => {
    const bgWs = snapshot([
      mixedGroup('gB', [
        fileTab('fb', '/repo', 'src/util/a.ts'),
        fileTab('fc', '/repo', 'src/util/b.ts')
      ])
    ])
    useSpaceStore.setState({
      spaces: [bgSpace('A', snapshot([])), bgSpace('B', bgWs)],
      activeSpaceId: 'A',
      loaded: true
    })
    resetTerminal([])

    syncBackgroundEditorTabsOnRename('/repo', 'src/util', 'src/helpers')

    const tabs = useSpaceStore.getState().spaces.find((s) => s.id === 'B')!.workspace.groups[0]
      .tabs as FileEditorTab[]
    expect(tabs.map((t) => t.relPath)).toEqual(['src/helpers/a.ts', 'src/helpers/b.ts'])
  })

  it('ignores editor tabs bound to a different project root', () => {
    const bgWs = snapshot([mixedGroup('gB', [fileTab('fb', '/other', 'src/old.ts')])])
    useSpaceStore.setState({
      spaces: [bgSpace('A', snapshot([])), bgSpace('B', bgWs)],
      activeSpaceId: 'A',
      loaded: true
    })
    resetTerminal([])

    syncBackgroundEditorTabsOnRename('/repo', 'src/old.ts', 'src/new.ts')

    const bTab = useSpaceStore.getState().spaces.find((s) => s.id === 'B')!.workspace.groups[0]
      .tabs[0] as FileEditorTab
    expect(bTab.relPath).toBe('src/old.ts')
  })
})

describe('spaceStore.spaceHasUnsavedEditors', () => {
  afterEach(() => {
    clearParkedEditorBuffer('fb')
    clearParkedEditorBuffer('fa')
  })

  it('is true for a background space holding a stashed unsaved (parked) buffer', () => {
    const bgWs = snapshot([mixedGroup('gB', [fileTab('fb', '/repo', 'src/x.ts')])])
    useSpaceStore.setState({
      spaces: [bgSpace('A', snapshot([])), bgSpace('B', bgWs)],
      activeSpaceId: 'A',
      loaded: true
    })
    stashParkedEditorBuffer('fb', {
      content: 'edited',
      eol: '\n',
      baseContent: 'orig',
      baseMtimeMs: 0
    })

    expect(spaceHasUnsavedEditors('B')).toBe(true)
  })

  it('is false for a background space whose editor tabs are all clean', () => {
    const bgWs = snapshot([mixedGroup('gB', [fileTab('fb', '/repo', 'src/x.ts')])])
    useSpaceStore.setState({
      spaces: [bgSpace('A', snapshot([])), bgSpace('B', bgWs)],
      activeSpaceId: 'A',
      loaded: true
    })
    expect(spaceHasUnsavedEditors('B')).toBe(false)
  })

  it('is true for the active space with a mounted dirty editor', () => {
    const activeGroups = [mixedGroup('gA', [fileTab('fa', '/repo', 'src/y.ts')])]
    useSpaceStore.setState({
      spaces: [bgSpace('A', snapshot(activeGroups))],
      activeSpaceId: 'A',
      loaded: true
    })
    resetTerminal(activeGroups)
    const unregister = registerFileEditor('fa', {
      save: async () => {},
      isDirty: () => true,
      getDirtyBuffer: () => null,
      flushIfAutoSave: () => {}
    })

    expect(spaceHasUnsavedEditors('A')).toBe(true)
    unregister()
  })
})

describe('spaceStore.moveTabToSpace', () => {
  it('moves a live tab into a background space, keeping the session running', () => {
    useProjectStore.setState({
      projects: [{ id: 'p1', name: 'repo-a', path: '/repo-a', addedAt: '' }],
      activeProjectId: null
    } as never)
    seed(
      {
        id: 'A',
        groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a'), aiTab('a2', 'sa2', '/repo-a')])]
      },
      [{ id: 'B', workspace: snapshot([group('gB', [aiTab('b1', 'sb1', '/repo-b')])]) }]
    )

    useSpaceStore.getState().moveTabToSpace('a2', 'B')

    // a2 left the live (active) workspace; a1 stays.
    const live = useTerminalStore.getState().groups.flatMap((g) => g.tabs.map((t) => t.id))
    expect(live).toEqual(['a1'])
    // a2 landed in B's stored snapshot, focused, alongside b1.
    const B = useSpaceStore.getState().spaces.find((s) => s.id === 'B')!
    const bTabs = B.workspace.groups.flatMap((g) => g.tabs.map((t) => t.id))
    expect(bTabs).toEqual(['b1', 'a2'])
    const bGroup = B.workspace.groups.find((g) => g.tabs.some((t) => t.id === 'a2'))!
    expect(bGroup.activeTabId).toBe('a2')
    // Project of the moved tab (cwd /repo-a → p1) is bound to the target.
    expect(B.projectIds).toContain('p1')
    // The whole point: the terminal is NEVER destroyed and the session NEVER closed.
    expect(destroyTerminal).not.toHaveBeenCalled()
    expect(closeSession).not.toHaveBeenCalled()
  })

  it('injects into an empty background space as a new group and can empty the source', () => {
    seed({ id: 'A', groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a')])] }, [
      { id: 'B', workspace: snapshot([]) }
    ])

    useSpaceStore.getState().moveTabToSpace('a1', 'B')

    const B = useSpaceStore.getState().spaces.find((s) => s.id === 'B')!
    expect(B.workspace.groups).toHaveLength(1)
    expect(B.workspace.groups[0].tabs.map((t) => t.id)).toEqual(['a1'])
    expect(B.workspace.activeGroupId).toBe(B.workspace.groups[0].id)
    // The active space is now empty (like closing its last tab) but still active.
    expect(useTerminalStore.getState().groups).toHaveLength(0)
    expect(useSpaceStore.getState().activeSpaceId).toBe('A')
    expect(destroyTerminal).not.toHaveBeenCalled()
  })

  it('serializes without duplicating the moved tab (active from live, target from snapshot)', () => {
    seed(
      {
        id: 'A',
        groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a'), aiTab('a2', 'sa2', '/repo-a')])]
      },
      [{ id: 'B', workspace: snapshot([group('gB', [aiTab('b1', 'sb1', '/repo-b')])]) }]
    )
    useSpaceStore.getState().moveTabToSpace('a2', 'B')

    saveSpacesSync.mockClear()
    useSpaceStore.getState().persistNow()
    const file = saveSpacesSync.mock.calls[0][0] as {
      spaces: { id: string; workspace: { groups: { tabs: { id: string }[] }[] } }[]
    }
    const ids = (id: string): string[] =>
      file.spaces.find((s) => s.id === id)!.workspace.groups.flatMap((g) => g.tabs.map((t) => t.id))
    expect(ids('A')).toEqual(['a1']) // moved tab gone from the active space
    expect(ids('B')).toContain('a2') // present in the target exactly once
    expect(ids('B').filter((x) => x === 'a2')).toHaveLength(1)
  })

  it('is a no-op when the target is the active space, missing, or the tab is not live', () => {
    seed({ id: 'A', groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a')])] }, [
      { id: 'B', workspace: snapshot([group('gB', [aiTab('b1', 'sb1', '/repo-b')])]) }
    ])
    const before = useSpaceStore.getState().spaces

    useSpaceStore.getState().moveTabToSpace('a1', 'A') // target === active
    useSpaceStore.getState().moveTabToSpace('a1', 'nope') // missing target
    useSpaceStore.getState().moveTabToSpace('ghost', 'B') // tab not in live workspace

    expect(useTerminalStore.getState().groups.flatMap((g) => g.tabs.map((t) => t.id))).toEqual([
      'a1'
    ])
    expect(useSpaceStore.getState().spaces).toBe(before) // no state churn
    expect(destroyTerminal).not.toHaveBeenCalled()
  })

  it('preserves a moved file editor unsaved buffer via the parked stash', () => {
    const fe = fileTab('fe1', '/repo-a', 'src/x.ts', { dirty: true })
    seed({ id: 'A', groups: [mixedGroup('gA', [fe])] }, [{ id: 'B', workspace: snapshot([]) }])
    // Register a mounted editor with a dirty buffer so the move stashes it.
    const handle = {
      isDirty: () => true,
      getDirtyBuffer: () => ({ content: 'edited', baseline: 'orig', savedViewState: null }),
      flushIfAutoSave: vi.fn()
    }
    const unregister = registerFileEditor('fe1', handle as never)

    useSpaceStore.getState().moveTabToSpace('fe1', 'B')

    // The editor's unsaved buffer was stashed (survives unmount→remount in B).
    expect(hasParkedEditorBuffer('fe1')).toBe(true)
    clearParkedEditorBuffer('fe1')
    unregister()
  })
})

describe('spaceStore.moveTabToNewSpace', () => {
  it('creates a background untitled space and moves the tab into it', () => {
    seed(
      {
        id: 'A',
        groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a'), aiTab('a2', 'sa2', '/repo-a')])]
      },
      []
    )

    useSpaceStore.getState().moveTabToNewSpace('a2')

    const st = useSpaceStore.getState()
    expect(st.spaces).toHaveLength(2)
    const created = st.spaces.find((s) => s.id !== 'A')!
    expect(created.name).toMatch(/^Untitled Space \d+$/)
    // The new space stays in the background; A remains active.
    expect(st.activeSpaceId).toBe('A')
    expect(created.workspace.groups.flatMap((g) => g.tabs.map((t) => t.id))).toEqual(['a2'])
    // a2 left the live workspace; a1 stays.
    expect(useTerminalStore.getState().groups.flatMap((g) => g.tabs.map((t) => t.id))).toEqual([
      'a1'
    ])
    expect(destroyTerminal).not.toHaveBeenCalled()
  })

  it('is a no-op (creates no space) when the tab is not live', () => {
    seed({ id: 'A', groups: [group('gA', [aiTab('a1', 'sa1', '/repo-a')])] }, [])
    useSpaceStore.getState().moveTabToNewSpace('ghost')
    expect(useSpaceStore.getState().spaces).toHaveLength(1)
  })
})
