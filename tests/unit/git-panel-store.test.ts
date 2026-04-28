/**
 * Unit tests for `gitPanelStore` watcher refcounting, grace teardown, stale-
 * response protection, and active-project selection invariants.
 *
 * The store reaches into `window.dplex.diff` so we install a programmable
 * fake before each test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useGitPanelStore } from '../../src/renderer/src/stores/gitPanelStore'
import { useProjectStore } from '../../src/renderer/src/stores/projectStore'
import { useSettingsStore } from '../../src/renderer/src/stores/settingsStore'
import type { Project } from '../../src/renderer/src/types'

interface DiffMock {
  subscribe: ReturnType<typeof vi.fn>
  unsubscribe: ReturnType<typeof vi.fn>
  listChanges: ReturnType<typeof vi.fn>
  getRepoStatus: ReturnType<typeof vi.fn>
  onChangesChanged: ReturnType<typeof vi.fn>
}

let diffMock: DiffMock

function setupWindow(): void {
  diffMock = {
    subscribe: vi.fn(async (root: string) => ({
      token: `tok-${root}-${Math.random()}`,
      repoRootFs: root
    })),
    unsubscribe: vi.fn(),
    listChanges: vi.fn(async () => ({ files: [], truncated: false, totalCount: 0 })),
    getRepoStatus: vi.fn(async () => ({ kind: 'ok' as const, headRef: 'main' })),
    onChangesChanged: vi.fn(() => () => undefined)
  }
  ;(globalThis as { window?: unknown }).window = {
    dplex: {
      diff: diffMock,
      sessions: {
        saveWorkspace: vi.fn().mockResolvedValue(undefined),
        saveWorkspaceSync: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined)
      },
      pty: { destroy: vi.fn() },
      settings: {
        getAll: vi.fn().mockResolvedValue({}),
        merge: vi.fn().mockResolvedValue(undefined)
      }
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }
}

function makeProject(id: string, root: string): Project {
  return { id, name: id, path: root, addedAt: new Date().toISOString() } as Project
}

beforeEach(() => {
  setupWindow()
  vi.useFakeTimers()
  // Reset store first (this may call unsubscribe on leftover watchers from
  // the previous test, which would inflate the new mock's call count).
  useGitPanelStore.getState().reset()
  useProjectStore.setState({ projects: [], activeProjectId: null } as never)
  // Now clear the spies so each test starts with a clean slate.
  diffMock.subscribe.mockClear()
  diffMock.unsubscribe.mockClear()
  diffMock.listChanges.mockClear()
  diffMock.getRepoStatus.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('gitPanelStore.acquireWatcher / releaseWatcher', () => {
  it('subscribes once per repo and refcounts further acquires', async () => {
    const s = useGitPanelStore.getState()
    s.acquireWatcher('/a')
    s.acquireWatcher('/a')
    await vi.runAllTimersAsync()
    expect(diffMock.subscribe).toHaveBeenCalledTimes(1)
    s.releaseWatcher('/a')
    await vi.advanceTimersByTimeAsync(100)
    // Still ref-counted at 1 — no unsubscribe yet.
    expect(diffMock.unsubscribe).not.toHaveBeenCalled()
  })

  it('schedules grace teardown on last release and tears down after delay', async () => {
    const s = useGitPanelStore.getState()
    s.acquireWatcher('/a')
    await vi.runAllTimersAsync()
    s.releaseWatcher('/a')
    // Just under the grace window — not yet torn down.
    await vi.advanceTimersByTimeAsync(4_000)
    expect(diffMock.unsubscribe).not.toHaveBeenCalled()
    // Past the grace window — torn down.
    await vi.advanceTimersByTimeAsync(2_000)
    expect(diffMock.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('cancels pending teardown when re-acquired during the grace window (A→B→A)', async () => {
    const s = useGitPanelStore.getState()
    s.acquireWatcher('/a')
    await vi.runAllTimersAsync()
    s.releaseWatcher('/a')
    // Re-acquire mid-grace — no teardown should fire.
    await vi.advanceTimersByTimeAsync(2_000)
    s.acquireWatcher('/a')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(diffMock.unsubscribe).not.toHaveBeenCalled()
  })

  it('handles A→B→C — independent watchers per repo, only the abandoned one tears down', async () => {
    const s = useGitPanelStore.getState()
    s.acquireWatcher('/a')
    await vi.runAllTimersAsync()
    s.releaseWatcher('/a')
    s.acquireWatcher('/b')
    await vi.runAllTimersAsync()
    s.releaseWatcher('/b')
    s.acquireWatcher('/c')
    await vi.runAllTimersAsync()
    // /a is past its 5s grace by now.
    await vi.advanceTimersByTimeAsync(15_000)
    // /c still alive — only /a and /b are torn down.
    expect(diffMock.unsubscribe).toHaveBeenCalledTimes(2)
  })
})

describe('gitPanelStore.bindToProject — stale-response protection', () => {
  it('drops responses from a superseded request', async () => {
    const proj = makeProject('p1', '/repo')
    useProjectStore.setState({ projects: [proj], activeProjectId: 'p1' } as never)

    let resolveFirst: ((v: unknown) => void) | null = null
    diffMock.listChanges.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveFirst = res
        })
    )
    const s = useGitPanelStore.getState()
    s.bindToProject('p1') // request 1 — pending

    // Force a second request which bumps generation.
    diffMock.listChanges.mockResolvedValueOnce({
      files: [
        { gitPath: 'fresh.ts', oldGitPath: null, headStatus: 'M', wtStatus: '.', isConflict: false }
      ],
      truncated: false,
      totalCount: 1
    })
    s.bindToProject('p1', { force: true })
    await vi.runAllTimersAsync()
    // Now resolve the FIRST request with stale data — should be dropped.
    resolveFirst?.({
      files: [
        { gitPath: 'stale.ts', oldGitPath: null, headStatus: 'M', wtStatus: '.', isConflict: false }
      ],
      truncated: false,
      totalCount: 1
    })
    await vi.runAllTimersAsync()

    const entry = useGitPanelStore.getState().byRepo['/repo']
    expect(entry).toBeDefined()
    expect(entry.files.map((f) => f.gitPath)).toEqual(['fresh.ts'])
  })

  it('clears persisted selectedGitPath when the file disappears from the new list', async () => {
    const proj: Project = {
      ...makeProject('p1', '/repo'),
      gitPanelState: { selectedGitPath: 'gone.ts' }
    }
    useProjectStore.setState({ projects: [proj], activeProjectId: 'p1' } as never)

    diffMock.listChanges.mockResolvedValueOnce({ files: [], truncated: false, totalCount: 0 })
    useGitPanelStore.getState().bindToProject('p1', { force: true })
    await vi.runAllTimersAsync()

    const updated = useProjectStore.getState().projects.find((p) => p.id === 'p1')
    expect(updated?.gitPanelState?.selectedGitPath).toBeUndefined()
  })
})

describe('gitPanelStore.resolveActiveRoot', () => {
  it('returns the project root when no override is persisted', () => {
    const p = makeProject('p1', '/repo')
    useProjectStore.setState({ projects: [p], activeProjectId: 'p1' } as never)
    expect(useGitPanelStore.getState().resolveActiveRoot(p)).toBe('/repo')
  })

  it('returns the persisted worktree root only when it is still registered', () => {
    const parent = makeProject('p1', '/repo')
    const wt: Project = {
      ...makeProject('wt1', '/repo-wt'),
      parentProjectId: 'p1'
    }
    const projWithOverride: Project = {
      ...parent,
      gitPanelState: { activeWorktreeRoot: '/repo-wt' }
    }
    useProjectStore.setState({ projects: [projWithOverride, wt] } as never)
    expect(useGitPanelStore.getState().resolveActiveRoot(projWithOverride)).toBe('/repo-wt')
  })

  it('falls back to project root when persisted worktree is no longer registered', () => {
    const parent: Project = {
      ...makeProject('p1', '/repo'),
      gitPanelState: { activeWorktreeRoot: '/dead-wt' }
    }
    useProjectStore.setState({ projects: [parent] } as never)
    expect(useGitPanelStore.getState().resolveActiveRoot(parent)).toBe('/repo')
  })
})

describe('gitPanelStore.bindToProject — does NOT acquire watchers', () => {
  it('refresh paths and force-rebinds do not increment refcount', async () => {
    const proj = makeProject('p1', '/repo')
    useProjectStore.setState({ projects: [proj], activeProjectId: 'p1' } as never)
    const s = useGitPanelStore.getState()
    s.bindToProject('p1')
    s.bindToProject('p1', { force: true })
    s.refresh('p1')
    await vi.runAllTimersAsync()
    // bindToProject must not subscribe — only acquireWatcher does.
    expect(diffMock.subscribe).not.toHaveBeenCalled()
    expect(useGitPanelStore.getState().liveWatchers['/repo']).toBeUndefined()
  })
})

describe('wireGitPanelGlobals', () => {
  it('cleans up listeners and the active-project watcher on tear-down, then re-wires on next call (StrictMode safety)', async () => {
    // Pre-populate so wire-time initial bind kicks in.
    const proj = makeProject('p1', '/repo')
    useProjectStore.setState({ projects: [proj], activeProjectId: 'p1' } as never)
    const offChanges = vi.fn()
    diffMock.onChangesChanged.mockReturnValueOnce(offChanges)

    const { wireGitPanelGlobals } = await import(
      '../../src/renderer/src/stores/gitPanelStore'
    )
    const cleanup = wireGitPanelGlobals()
    await vi.runAllTimersAsync()
    expect(diffMock.subscribe).toHaveBeenCalledTimes(1)

    cleanup()
    // Active-project watcher released — past grace window it tears down.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(diffMock.unsubscribe).toHaveBeenCalledTimes(1)
    expect(offChanges).toHaveBeenCalledTimes(1)

    // Re-wire (simulating React StrictMode's mount → cleanup → mount cycle):
    // the second call must NOT be a no-op.
    diffMock.subscribe.mockClear()
    diffMock.onChangesChanged.mockReturnValueOnce(vi.fn())
    const cleanup2 = wireGitPanelGlobals()
    await vi.runAllTimersAsync()
    expect(diffMock.subscribe).toHaveBeenCalledTimes(1)
    cleanup2()
  })
})

describe('settings migration', () => {
  it('preserves legacy settings without gitPanel and applies defaults', async () => {
    ;(window.dplex.settings.getAll as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      defaultShell: 'zsh',
      theme: 'dplex'
      // no gitPanel field
    })
    await useSettingsStore.getState().loadSettings()
    const s = useSettingsStore.getState().settings
    expect(s.gitPanel).toBeDefined()
    expect(s.gitPanel.open).toBe(false)
    expect(s.gitPanel.width).toBeGreaterThanOrEqual(220)
    expect(s.gitPanel.sectionCollapse.changes).toBe(false)
  })
})
