import { describe, expect, it } from 'vitest'

import { tabMatchesFocus, pruneLayoutToGroups } from '../../src/renderer/src/utils/tabFocus'
import type { LayoutNode, Project, TerminalTab } from '../../src/renderer/src/types'

function project(id: string, path: string, parentProjectId?: string): Project {
  return {
    id,
    name: id,
    path,
    addedAt: new Date().toISOString(),
    ...(parentProjectId ? { parentProjectId } : {})
  } as Project
}

function term(id: string, cwd?: string, extra?: Partial<TerminalTab>): TerminalTab {
  return { id, title: id, kind: 'terminal', cwd, ...extra }
}

const projects: Project[] = [
  project('alpha', '/repos/alpha'),
  project('beta', '/repos/beta'),
  project('alpha-wt', '/repos/alpha-wt', 'alpha')
]

describe('tabMatchesFocus', () => {
  it('matches every tab when no target is set', () => {
    expect(tabMatchesFocus(term('t', '/somewhere/else'), projects, null)).toBe(true)
  })

  it('matches a terminal whose cwd lives under the project path', () => {
    expect(tabMatchesFocus(term('t', '/repos/alpha/src'), projects, 'alpha')).toBe(true)
    expect(tabMatchesFocus(term('t', '/repos/beta'), projects, 'alpha')).toBe(false)
  })

  it('matches a worktree tab against its parent (color) project', () => {
    const wtTab = term('t', '/repos/alpha-wt', { worktreePath: '/repos/alpha-wt' })
    expect(tabMatchesFocus(wtTab, projects, 'alpha')).toBe(true)
    // and against the worktree project itself
    expect(tabMatchesFocus(wtTab, projects, 'alpha-wt')).toBe(true)
  })

  it('never matches a tab with no project identity', () => {
    expect(tabMatchesFocus(term('t', '/tmp/scratch'), projects, 'alpha')).toBe(false)
    expect(tabMatchesFocus(term('t', undefined), projects, 'alpha')).toBe(false)
  })
})

describe('pruneLayoutToGroups', () => {
  it('collapses a split down to the single surviving group', () => {
    const layout: LayoutNode = {
      type: 'split',
      direction: 'horizontal',
      children: [
        { type: 'group', groupId: 'g1' },
        { type: 'group', groupId: 'g2' }
      ]
    }
    expect(pruneLayoutToGroups(layout, new Set(['g1']))).toEqual({ type: 'group', groupId: 'g1' })
  })

  it('returns null when no group survives', () => {
    const layout: LayoutNode = { type: 'group', groupId: 'g1' }
    expect(pruneLayoutToGroups(layout, new Set())).toBeNull()
  })

  it('keeps a nested split with multiple survivors intact', () => {
    const layout: LayoutNode = {
      type: 'split',
      direction: 'horizontal',
      children: [
        { type: 'group', groupId: 'g1' },
        { type: 'group', groupId: 'g2' },
        { type: 'group', groupId: 'g3' }
      ]
    }
    const pruned = pruneLayoutToGroups(layout, new Set(['g1', 'g3']))
    expect(pruned).toEqual({
      type: 'split',
      direction: 'horizontal',
      children: [
        { type: 'group', groupId: 'g1' },
        { type: 'group', groupId: 'g3' }
      ]
    })
  })
})
