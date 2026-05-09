import { describe, expect, it } from 'vitest'
import { effectiveSessionVisual, pairTabsToSessions } from '../../src/renderer/src/utils/sessionPairing'
import type { AISession, SessionStatus, TerminalTab } from '../../src/renderer/src/types'

const cwd = '/Users/me/repo'

function s(id: string, aiTool = 'copilot-cli'): AISession {
  return {
    id,
    aiTool,
    cwd,
    title: id,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  } as unknown as AISession
}
function term(id: string, opts: Partial<TerminalTab> = {}): TerminalTab & { groupId: string } {
  return {
    id,
    title: opts.title ?? `Terminal ${id}`,
    cwd: opts.cwd ?? cwd,
    command: opts.command,
    providerId: opts.providerId,
    sessionId: opts.sessionId,
    groupId: 'g0'
  } as unknown as TerminalTab & { groupId: string }
}

describe('pairTabsToSessions', () => {
  it('pairs by composite providerId+sessionId when present', () => {
    const sessions = [s('a')]
    const tabs = [term('t1', { providerId: 'copilot-cli', sessionId: 'a' })]
    const r = pairTabsToSessions(sessions, tabs)
    expect(r.pairs[0].match?.id).toBe('a')
    expect(r.unpaired).toHaveLength(0)
    expect(r.visibleCount).toBe(1)
  })

  it('cwd-fallback only triggers when tab has provider hint or command', () => {
    const sessions = [s('a'), s('b')]
    const tabs = [
      term('t1', { command: 'copilot-cli' }), // matches via command
      term('t2', { providerId: 'copilot-cli' }) // matches via providerId
    ]
    const r = pairTabsToSessions(sessions, tabs)
    expect(r.pairs.map((p) => p.match?.id)).toEqual(['a', 'b'])
    expect(r.unpaired).toHaveLength(0)
  })

  it('plain terminal (no providerId, no command) does NOT claim an AI session at the same cwd', () => {
    const sessions = [s('a')]
    const tabs = [term('plainTerm')]
    const r = pairTabsToSessions(sessions, tabs)
    expect(r.pairs[0].match).toBeUndefined()
    expect(r.unpaired.map((u) => u.id)).toEqual(['a'])
    expect(r.visibleCount).toBe(2)
  })

  it('mixed: 2 AI sessions + 1 plain terminal at same cwd → 3 visible rows, plain terminal not eaten', () => {
    const sessions = [s('a'), s('b')]
    const tabs = [
      term('t1', { providerId: 'copilot-cli', sessionId: 'a' }),
      term('plainTerm')
    ]
    const r = pairTabsToSessions(sessions, tabs)
    expect(r.pairs[0].match?.id).toBe('a')
    expect(r.pairs[1].match).toBeUndefined() // plainTerm not paired
    expect(r.unpaired.map((u) => u.id)).toEqual(['b'])
    expect(r.visibleCount).toBe(3)
  })

  it('regression: opening N AI sessions then 1 plain terminal — terminal still surfaces', () => {
    const sessions = [s('a'), s('b'), s('c'), s('d')]
    const tabs = [
      term('t-a', { providerId: 'copilot-cli', sessionId: 'a' }),
      term('t-b', { providerId: 'copilot-cli', sessionId: 'b' }),
      term('t-c', { providerId: 'copilot-cli', sessionId: 'c' }),
      term('t-d', { providerId: 'copilot-cli', sessionId: 'd' }),
      term('plainTerm')
    ]
    const r = pairTabsToSessions(sessions, tabs)
    expect(r.pairs.map((p) => p.match?.id)).toEqual(['a', 'b', 'c', 'd', undefined])
    expect(r.unpaired).toHaveLength(0)
    expect(r.visibleCount).toBe(5)
  })

  it('pending tab (providerId set, sessionId missing) claims a same-provider session even when cwd is missing on the tab', () => {
    const sessions = [s('a', 'claude-code')]
    const tabs = [term('t1', { providerId: 'claude-code', cwd: undefined })]
    const r = pairTabsToSessions(sessions, tabs)
    expect(r.pairs[0].match?.id).toBe('a')
    expect(r.unpaired).toHaveLength(0)
  })

  it('pending tab does not claim a session whose cwd disagrees with the tab cwd', () => {
    const sessions = [s('a', 'claude-code')]
    const tabs = [term('t1', { providerId: 'claude-code', cwd: '/Users/me/other' })]
    const r = pairTabsToSessions(sessions, tabs)
    expect(r.pairs[0].match).toBeUndefined()
    expect(r.unpaired.map((u) => u.id)).toEqual(['a'])
  })

  it('pending tab does not claim a session of a different provider', () => {
    const sessions = [s('a', 'copilot-cli')]
    const tabs = [term('t1', { providerId: 'claude-code' })]
    const r = pairTabsToSessions(sessions, tabs)
    expect(r.pairs[0].match).toBeUndefined()
    expect(r.unpaired.map((u) => u.id)).toEqual(['a'])
  })
})

describe('effectiveSessionVisual', () => {
  function mkSession(
    status: 'active' | 'idle',
    detailedStatus?: SessionStatus
  ): AISession {
    return {
      id: 'x',
      aiTool: 'copilot-cli',
      status,
      detailedStatus,
      title: 'x',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    } as unknown as AISession
  }

  it('uses detailedStatus when present', () => {
    expect(effectiveSessionVisual(mkSession('active', 'thinking'))).toBe('thinking')
    expect(effectiveSessionVisual(mkSession('active', 'executingTool'))).toBe('running')
    expect(effectiveSessionVisual(mkSession('active', 'awaitingApproval'))).toBe('attn')
    expect(effectiveSessionVisual(mkSession('active', 'waitingForUser'))).toBe('waiting')
  })

  it('falls back to "thinking" for active sessions without detailedStatus', () => {
    expect(effectiveSessionVisual(mkSession('active', undefined))).toBe('thinking')
  })

  it('falls back to "idle" for non-active sessions without detailedStatus', () => {
    expect(effectiveSessionVisual(mkSession('idle', undefined))).toBe('idle')
  })
})
