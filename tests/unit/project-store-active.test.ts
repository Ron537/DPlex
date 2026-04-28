import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useProjectStore } from '../../src/renderer/src/stores/projectStore'
import type { Project } from '../../src/renderer/src/types'

interface SettingsMock {
  getAll: ReturnType<typeof vi.fn>
  merge: ReturnType<typeof vi.fn>
}

let settingsMock: SettingsMock

function installWindow(initial: Record<string, unknown>): void {
  settingsMock = {
    getAll: vi.fn().mockResolvedValue(initial),
    merge: vi.fn().mockResolvedValue(undefined)
  }
  ;(globalThis as { window?: unknown }).window = {
    dplex: { settings: settingsMock }
  }
}

function makeProject(id: string, root: string, parentProjectId?: string): Project {
  return {
    id,
    name: id,
    path: root,
    addedAt: new Date().toISOString(),
    ...(parentProjectId ? { parentProjectId } : {})
  } as Project
}

beforeEach(() => {
  useProjectStore.setState({ projects: [], activeProjectId: null, loaded: false } as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('projectStore active project persistence', () => {
  it('restores activeProjectId on loadProjects when the id matches a saved project', async () => {
    const projects = [makeProject('p1', '/r1'), makeProject('p2', '/r2')]
    installWindow({ projects, activeProjectId: 'p2' })

    await useProjectStore.getState().loadProjects()

    const state = useProjectStore.getState()
    expect(state.activeProjectId).toBe('p2')
    expect(state.lastExpandedProjectId).toBe('p2')
    expect(state.expandedProjectIds.has('p2')).toBe(true)
    expect(state.loaded).toBe(true)
  })

  it('drops a stale activeProjectId that no longer maps to any project', async () => {
    const projects = [makeProject('p1', '/r1')]
    installWindow({ projects, activeProjectId: 'p-deleted' })

    await useProjectStore.getState().loadProjects()

    expect(useProjectStore.getState().activeProjectId).toBeNull()
  })

  it('handles missing activeProjectId gracefully', async () => {
    installWindow({ projects: [makeProject('p1', '/r1')] })

    await useProjectStore.getState().loadProjects()

    expect(useProjectStore.getState().activeProjectId).toBeNull()
  })

  it('persists activeProjectId via settings.merge on setActiveProject', () => {
    installWindow({})
    useProjectStore.setState({ projects: [makeProject('p1', '/r1')] } as never)

    useProjectStore.getState().setActiveProject('p1')

    expect(settingsMock.merge).toHaveBeenCalledWith({ activeProjectId: 'p1' })
  })

  it('persists null when removeProject removes the active project', () => {
    installWindow({})
    useProjectStore.setState({
      projects: [makeProject('p1', '/r1')],
      activeProjectId: 'p1'
    } as never)

    useProjectStore.getState().removeProject('p1')

    expect(settingsMock.merge).toHaveBeenCalledWith({ activeProjectId: null })
    expect(useProjectStore.getState().activeProjectId).toBeNull()
  })

  it('expands the parent chain when the active project is a nested worktree', async () => {
    const projects = [
      makeProject('parent', '/r'),
      makeProject('mid', '/r/wt1', 'parent'),
      makeProject('leaf', '/r/wt1/wt2', 'mid')
    ]
    installWindow({ projects, activeProjectId: 'leaf' })

    await useProjectStore.getState().loadProjects()

    const state = useProjectStore.getState()
    expect(state.activeProjectId).toBe('leaf')
    expect(state.lastExpandedProjectId).toBe('leaf')
    expect(state.expandedProjectIds.has('leaf')).toBe(true)
    expect(state.expandedProjectIds.has('mid')).toBe(true)
    expect(state.expandedProjectIds.has('parent')).toBe(true)
  })

  it('handles a parent-chain cycle without infinite-looping', async () => {
    // Defensive — should never happen in practice, but guard against bad data.
    const projects = [
      makeProject('a', '/a', 'b'),
      makeProject('b', '/b', 'a')
    ]
    installWindow({ projects, activeProjectId: 'a' })

    await useProjectStore.getState().loadProjects()

    const state = useProjectStore.getState()
    expect(state.expandedProjectIds.has('a')).toBe(true)
    expect(state.expandedProjectIds.has('b')).toBe(true)
  })

  it('strips legacy gitPanelState.activeWorktreeRoot on load and re-persists', async () => {
    const projects = [
      {
        ...makeProject('parent', '/repo'),
        gitPanelState: {
          activeWorktreeRoot: '/repo',
          selectedGitPath: 'a.ts'
        }
      } as unknown as Project,
      {
        ...makeProject('child', '/repo-wt', 'parent'),
        gitPanelState: {
          activeWorktreeRoot: '/repo' // legacy stale value pointing at parent
        }
      } as unknown as Project
    ]
    installWindow({ projects })

    await useProjectStore.getState().loadProjects()

    const loaded = useProjectStore.getState().projects
    const parent = loaded.find((p) => p.id === 'parent')!
    const child = loaded.find((p) => p.id === 'child')!
    // Parent had a selectedGitPath alongside the stale field — keep selection,
    // drop the legacy field.
    expect(parent.gitPanelState).toEqual({ selectedGitPath: 'a.ts' })
    expect(
      (parent.gitPanelState as Record<string, unknown> | undefined)?.activeWorktreeRoot
    ).toBeUndefined()
    // Child only had the stale field — gitPanelState should be undefined now.
    expect(child.gitPanelState).toBeUndefined()
    // Mutated → re-persisted via settings.merge.
    expect(settingsMock.merge).toHaveBeenCalledWith(
      expect.objectContaining({ projects: expect.any(Array) })
    )
  })

  it('clears activeProjectId when collapsing the active project', () => {
    const projects = [makeProject('p1', '/r1'), makeProject('p2', '/r2')]
    installWindow({})
    useProjectStore.setState({
      projects,
      activeProjectId: 'p1',
      expandedProjectIds: new Set(['p1']),
      lastExpandedProjectId: 'p1'
    } as never)

    useProjectStore.getState().toggleExpanded('p1')

    expect(useProjectStore.getState().activeProjectId).toBeNull()
    expect(useProjectStore.getState().expandedProjectIds.has('p1')).toBe(false)
    expect(settingsMock.merge).toHaveBeenCalledWith({ activeProjectId: null })
  })

  it('clears activeProjectId when collapsing an ancestor of the active worktree', () => {
    const projects = [
      makeProject('parent', '/repo'),
      makeProject('child', '/repo-wt', 'parent')
    ]
    installWindow({})
    useProjectStore.setState({
      projects,
      activeProjectId: 'child',
      expandedProjectIds: new Set(['parent', 'child']),
      lastExpandedProjectId: 'child'
    } as never)

    useProjectStore.getState().toggleExpanded('parent')

    expect(useProjectStore.getState().activeProjectId).toBeNull()
    expect(settingsMock.merge).toHaveBeenCalledWith({ activeProjectId: null })
  })

  it('does not clear activeProjectId when collapsing an unrelated project', () => {
    const projects = [makeProject('p1', '/r1'), makeProject('p2', '/r2')]
    installWindow({})
    useProjectStore.setState({
      projects,
      activeProjectId: 'p1',
      expandedProjectIds: new Set(['p1', 'p2']),
      lastExpandedProjectId: 'p2'
    } as never)

    useProjectStore.getState().toggleExpanded('p2')

    expect(useProjectStore.getState().activeProjectId).toBe('p1')
    expect(settingsMock.merge).not.toHaveBeenCalledWith({ activeProjectId: null })
  })
})
