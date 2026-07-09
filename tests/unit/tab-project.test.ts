import { describe, expect, it } from 'vitest'

import {
  colorSourceProject,
  findProjectForTab,
  getTabIdentity,
  getTabProjectPath
} from '../../src/renderer/src/utils/tabProject'
import type { FileDiffTab, Project, TerminalTab } from '../../src/renderer/src/types'
import { deriveAvatarColor } from '../../src/renderer/src/utils/projectStatus'

function makeProject(partial: Partial<Project> & Pick<Project, 'id' | 'name' | 'path'>): Project {
  return {
    addedAt: '2026-01-01T00:00:00.000Z',
    ...partial
  }
}

function makeTerminalTab(partial: Partial<TerminalTab> & { id: string }): TerminalTab {
  return {
    title: partial.title ?? partial.id,
    ...partial
  }
}

function makeFileDiffTab(
  partial: Partial<FileDiffTab> & Pick<FileDiffTab, 'id' | 'repoRootFs'>
): FileDiffTab {
  return {
    title: partial.title ?? partial.id,
    kind: 'fileDiff',
    repoLabel: partial.repoLabel ?? 'repo',
    scope: partial.scope ?? { kind: 'workingTree' },
    file: partial.file ?? {
      gitPath: 'a.txt',
      headStatus: '.',
      wtStatus: 'M'
    },
    ...partial
  } as FileDiffTab
}

const PROJECTS: Project[] = [
  makeProject({ id: 'p-app', name: 'DPlex', path: '/code/dplex' }),
  makeProject({ id: 'p-wt', name: 'feature-x', path: '/code/dplex-wt', parentProjectId: 'p-app' }),
  makeProject({ id: 'p-api', name: 'api-gateway', path: '/code/api-gateway' })
]

describe('getTabProjectPath', () => {
  it('prefers worktreePath over cwd for terminal tabs', () => {
    const tab = makeTerminalTab({ id: 't1', worktreePath: '/code/dplex-wt', cwd: '/tmp' })
    expect(getTabProjectPath(tab)).toBe('/code/dplex-wt')
  })

  it('falls back to cwd when no worktreePath', () => {
    const tab = makeTerminalTab({ id: 't2', cwd: '/code/dplex' })
    expect(getTabProjectPath(tab)).toBe('/code/dplex')
  })

  it('uses repoRootFs for file-diff tabs', () => {
    const tab = makeFileDiffTab({ id: 'd1', repoRootFs: '/code/api-gateway' })
    expect(getTabProjectPath(tab)).toBe('/code/api-gateway')
  })

  it('returns undefined when nothing is set', () => {
    expect(getTabProjectPath(makeTerminalTab({ id: 't3' }))).toBeUndefined()
  })
})

describe('findProjectForTab', () => {
  it('matches by longest path prefix', () => {
    const tab = makeTerminalTab({ id: 't', cwd: '/code/dplex-wt/src/main' })
    expect(findProjectForTab(tab, PROJECTS)?.id).toBe('p-wt')
  })

  it('uses exact match when available', () => {
    const tab = makeTerminalTab({ id: 't', cwd: '/code/dplex' })
    expect(findProjectForTab(tab, PROJECTS)?.id).toBe('p-app')
  })

  it('returns undefined when no project owns the path', () => {
    const tab = makeTerminalTab({ id: 't', cwd: '/elsewhere' })
    expect(findProjectForTab(tab, PROJECTS)).toBeUndefined()
  })

  it('returns undefined when tab has no path', () => {
    expect(findProjectForTab(makeTerminalTab({ id: 't' }), PROJECTS)).toBeUndefined()
  })
})

describe('getTabIdentity', () => {
  it('uses parent project color when matched is a worktree', () => {
    const tab = makeTerminalTab({ id: 't', worktreePath: '/code/dplex-wt' })
    const identity = getTabIdentity(tab, PROJECTS)
    expect(identity).toBeDefined()
    expect(identity!.matched.id).toBe('p-wt')
    expect(identity!.colorProject.id).toBe('p-app')
    expect(identity!.color).toEqual(deriveAvatarColor(undefined))
  })

  it('uses matched project color when not a worktree', () => {
    const tab = makeTerminalTab({ id: 't', cwd: '/code/api-gateway' })
    const identity = getTabIdentity(tab, PROJECTS)
    expect(identity?.colorProject.id).toBe('p-api')
  })

  it('returns undefined for unmatched tabs', () => {
    expect(getTabIdentity(makeTerminalTab({ id: 't', cwd: '/x' }), PROJECTS)).toBeUndefined()
  })
})

describe('colorSourceProject', () => {
  it('returns the parent origin for a worktree', () => {
    const wt = PROJECTS.find((p) => p.id === 'p-wt')!
    expect(colorSourceProject(wt, PROJECTS).id).toBe('p-app')
  })

  it('returns the project itself when it is an origin', () => {
    const app = PROJECTS.find((p) => p.id === 'p-app')!
    expect(colorSourceProject(app, PROJECTS).id).toBe('p-app')
  })

  it('falls back to the project itself for an orphan worktree (parent missing)', () => {
    const orphan = makeProject({ id: 'o', name: 'orphan', path: '/o', parentProjectId: 'missing' })
    expect(colorSourceProject(orphan, PROJECTS).id).toBe('o')
  })

  it('worktree tabs inherit the origin tab color', () => {
    const colored: Project[] = [
      makeProject({ id: 'p-app', name: 'DPlex', path: '/code/dplex', tabColor: '#34D399' }),
      makeProject({
        id: 'p-wt',
        name: 'feature-x',
        path: '/code/dplex-wt',
        parentProjectId: 'p-app'
      })
    ]
    const tab = makeTerminalTab({ id: 't', worktreePath: '/code/dplex-wt' })
    const identity = getTabIdentity(tab, colored)
    expect(identity!.colorProject.tabColor).toBe('#34D399')
    expect(identity!.color).toEqual(deriveAvatarColor('#34D399'))
  })
})
