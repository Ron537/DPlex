import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchContext } from '../../src/renderer/src/services/search/types'
import type {
  EditorGroup,
  Project,
  Space,
  TerminalTab,
  WorkspaceSnapshot
} from '../../src/renderer/src/types'

// `run` reaches into these two stores; mock them so the source can be tested in
// isolation (no terminal store / window.dplex setup needed).
const { switchSpace, updateSettings } = vi.hoisted(() => ({
  switchSpace: vi.fn(),
  updateSettings: vi.fn()
}))
vi.mock('../../src/renderer/src/stores/spaceStore', () => ({
  useSpaceStore: { getState: () => ({ switchSpace }) }
}))
vi.mock('../../src/renderer/src/stores/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ updateSettings }) }
}))

import { spacesSource } from '../../src/renderer/src/services/search/spacesSource'

function tab(id: string): TerminalTab {
  return {
    id,
    title: id,
    cwd: '/x',
    command: 'copilot',
    sessionId: `s-${id}`,
    providerId: 'copilot-cli'
  }
}

function group(id: string, tabs: TerminalTab[]): EditorGroup {
  return { id, tabs, activeTabId: tabs[0]?.id ?? '' }
}

function workspace(tabCount: number): WorkspaceSnapshot {
  const tabs = Array.from({ length: tabCount }, (_, i) => tab(`t${i}`))
  return { layout: { type: 'group', groupId: 'g' }, groups: [group('g', tabs)], activeGroupId: 'g' }
}

function space(id: string, name: string, projectIds: string[], ws: WorkspaceSnapshot): Space {
  const now = Date.now()
  return {
    id,
    name,
    color: '#6E8BFF',
    projectIds,
    workspace: ws,
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now
  }
}

const PROJECTS: Project[] = [
  { id: 'p1', name: 'repo-a', path: '/repo-a', addedAt: '' },
  { id: 'p2', name: 'repo-b', path: '/repo-b', addedAt: '' }
]

function ctx(
  spaces: Space[],
  activeSpaceId: string | null,
  groups: EditorGroup[] = []
): SearchContext {
  return {
    projects: PROJECTS,
    spaces,
    activeSpaceId,
    sessions: [],
    groups,
    activeGroupId: groups[0]?.id ?? null
  }
}

beforeEach(() => {
  switchSpace.mockClear()
  updateSettings.mockClear()
})

describe('spacesSource.getItems', () => {
  it('labels a background space by name with its project and session counts', () => {
    const s = space('s1', 'Ship OAuth', ['p1', 'p2'], workspace(2))
    const [item] = spacesSource.getItems(ctx([s], null))
    expect(item.id).toBe('space:s1')
    expect(item.label).toBe('Ship OAuth')
    expect(item.description).toBe('2 projects · 2 sessions')
    expect(item.hint).toBeUndefined()
  })

  it('singularizes the counts for a one-project, one-session space', () => {
    const s = space('s1', 'Solo', ['p1'], workspace(1))
    const [item] = spacesSource.getItems(ctx([s], null))
    expect(item.description).toBe('1 project · 1 session')
  })

  it('omits the project count when a space has no bound projects', () => {
    const s = space('s1', 'Scratch', [], workspace(0))
    const [item] = spacesSource.getItems(ctx([s], null))
    expect(item.description).toBe('0 sessions')
  })

  it('counts the active space live sessions from the terminal groups, not its stale snapshot', () => {
    // Snapshot says 0, but three tabs are live in the terminal store.
    const active = space('s1', 'Focused', ['p1'], workspace(0))
    const live = [group('gA', [tab('a'), tab('b')]), group('gB', [tab('c')])]
    const [item] = spacesSource.getItems(ctx([active], 's1', live))
    expect(item.description).toBe('1 project · 3 sessions')
    expect(item.hint).toBe('In focus')
  })

  it('exposes bound project names as keywords so a space is findable by its repos', () => {
    const s = space('s1', 'Ship OAuth', ['p1', 'p2'], workspace(1))
    const [item] = spacesSource.getItems(ctx([s], null))
    expect(item.keywords).toEqual(expect.arrayContaining(['space', 'repo-a', 'repo-b']))
  })

  it('drops project ids that no longer resolve to a project', () => {
    const s = space('s1', 'Stale', ['p1', 'ghost'], workspace(0))
    const [item] = spacesSource.getItems(ctx([s], null))
    // Only the one resolvable project is counted / used as a keyword.
    expect(item.description).toBe('1 project · 0 sessions')
    expect(item.keywords).not.toContain('ghost')
  })

  it('run() reveals the Spaces panel and switches into the space (never restarts sessions)', () => {
    const s = space('s1', 'Ship OAuth', ['p1'], workspace(1))
    const [item] = spacesSource.getItems(ctx([s], null))
    item.run()
    expect(updateSettings).toHaveBeenCalledWith({
      sidebarActiveTab: 'spaces',
      sidebarPanelCollapsed: false,
      sidebarVisible: true
    })
    expect(switchSpace).toHaveBeenCalledWith('s1')
  })
})
