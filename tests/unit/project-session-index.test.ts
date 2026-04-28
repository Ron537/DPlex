import { describe, it, expect } from 'vitest'
import { buildProjectSessionIndex } from '../../src/renderer/src/hooks/useProjectSessions'
import type { AISession, TerminalTab } from '../../src/renderer/src/types'

function makeSession(id: string, cwd: string, status: AISession['status'] = 'idle'): AISession {
  return {
    id,
    aiTool: 'copilot-cli',
    cwd,
    title: id,
    status,
    updatedAt: new Date(),
    lastActivityTime: undefined
  } as AISession
}

function makeTab(id: string, cwd: string): TerminalTab {
  return {
    id,
    title: id,
    cwd,
    shell: '/bin/zsh'
  } as TerminalTab
}

describe('buildProjectSessionIndex', () => {
  it('attributes a session to the registered project that is its longest path prefix', () => {
    const parent = '/repo'
    const worktree = '/repo-wt/feat'
    const projects = [parent, worktree]

    const sessions: AISession[] = [
      makeSession('s1', '/repo/src'),
      makeSession('s2', '/repo-wt/feat/pkg'),
      makeSession('s3', '/repo-wt/feat')
    ]

    const idx = buildProjectSessionIndex(sessions, [], projects)

    expect(idx.get(parent)!.sessions.map((s) => s.id)).toEqual(['s1'])
    expect(
      idx
        .get(worktree)!
        .sessions.map((s) => s.id)
        .sort()
    ).toEqual(['s2', 's3'])
  })

  it('does not let a shorter project path steal sessions from a deeper registered project', () => {
    const outer = '/workspace'
    const inner = '/workspace/dplex'
    const projects = [outer, inner]

    const sessions = [makeSession('s1', '/workspace/dplex/src/main')]

    const idx = buildProjectSessionIndex(sessions, [], projects)

    expect(idx.get(outer)!.sessions).toEqual([])
    expect(idx.get(inner)!.sessions.map((s) => s.id)).toEqual(['s1'])
  })

  it('attributes plain terminals (no command) to the matching project', () => {
    const projects = ['/repo', '/repo-wt/feat']
    const groups = [
      {
        id: 'g1',
        tabs: [makeTab('t1', '/repo-wt/feat'), makeTab('t2', '/repo/sub')]
      }
    ]

    const idx = buildProjectSessionIndex([], groups, projects)

    expect(idx.get('/repo')!.openTabs.map((t) => t.id)).toEqual(['t2'])
    expect(idx.get('/repo-wt/feat')!.openTabs.map((t) => t.id)).toEqual(['t1'])
  })

  it('hasActive + activeCount reflect active sessions only', () => {
    const projects = ['/p1', '/p2']
    const sessions = [
      makeSession('a', '/p1', 'active'),
      makeSession('b', '/p1', 'idle'),
      makeSession('c', '/p2', 'idle')
    ]
    const idx = buildProjectSessionIndex(sessions, [], projects)
    expect(idx.get('/p1')!.activeCount).toBe(1)
    expect(idx.get('/p1')!.hasActive).toBe(true)
    expect(idx.get('/p2')!.activeCount).toBe(0)
    expect(idx.get('/p2')!.hasActive).toBe(false)
  })

  it('ignores sessions whose cwd is outside every registered project', () => {
    const idx = buildProjectSessionIndex([makeSession('orphan', '/tmp/elsewhere')], [], ['/repo'])
    expect(idx.get('/repo')!.sessions).toEqual([])
  })

  it('normalizes trailing slashes and backslashes consistently', () => {
    const projects = ['/repo/']
    const sessions = [makeSession('s1', '\\repo\\src')]
    const idx = buildProjectSessionIndex(sessions, [], projects)
    // Exact key is preserved in the map; the value should still include the session.
    expect(idx.get('/repo/')!.sessions.map((s) => s.id)).toEqual(['s1'])
  })
})
