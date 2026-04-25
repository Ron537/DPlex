import { describe, expect, it } from 'vitest'
import {
  decodeCwdFromSlug,
  mapPidfileStatus
} from '../../src/main/services/providers/claudeCodeProvider'

describe('decodeCwdFromSlug', () => {
  it('decodes a posix slug back to its absolute path', () => {
    expect(decodeCwdFromSlug('-Users-me-repo')).toBe('/Users/me/repo')
  })

  it('returns undefined for non-leading-dash slugs', () => {
    expect(decodeCwdFromSlug('Users-me-repo')).toBeUndefined()
    expect(decodeCwdFromSlug('')).toBeUndefined()
  })

  it('is naive about hyphenated path segments (collision documented)', () => {
    // /Users/me/my-repo and /Users/me/my/repo both encode to the same slug.
    // The provider should prefer the JSONL `cwd` field; this test pins the
    // documented naive behavior.
    expect(decodeCwdFromSlug('-Users-me-my-repo')).toBe('/Users/me/my/repo')
  })
})

describe('mapPidfileStatus', () => {
  const base = { pid: 1, sessionId: 's', cwd: '/x' } as const

  it('maps waiting + approve as awaitingApproval for side-effecting tools', () => {
    expect(
      mapPidfileStatus({ ...base, status: 'waiting', waitingFor: 'approve Bash' })
    ).toBe('awaitingApproval')
    expect(
      mapPidfileStatus({ ...base, status: 'waiting', waitingFor: 'approve Edit' })
    ).toBe('awaitingApproval')
  })

  it('maps approve AskUserQuestion as waitingForUser (interactive question, not permission)', () => {
    expect(
      mapPidfileStatus({
        ...base,
        status: 'waiting',
        waitingFor: 'approve AskUserQuestion'
      })
    ).toBe('waitingForUser')
  })

  it('maps waiting + other reasons as waitingForUser', () => {
    expect(mapPidfileStatus({ ...base, status: 'waiting', waitingFor: 'input needed' })).toBe(
      'waitingForUser'
    )
    expect(mapPidfileStatus({ ...base, status: 'waiting' })).toBe('waitingForUser')
  })

  it('maps busy with tool detail as executingTool, otherwise thinking', () => {
    expect(mapPidfileStatus({ ...base, status: 'busy', detail: 'Bash · ls -la' })).toBe(
      'executingTool'
    )
    expect(mapPidfileStatus({ ...base, status: 'busy', detail: 'finalizing' })).toBe('thinking')
    expect(mapPidfileStatus({ ...base, status: 'busy' })).toBe('thinking')
  })

  it('maps idle as idle', () => {
    expect(mapPidfileStatus({ ...base, status: 'idle' })).toBe('idle')
  })

  it('tempo:blocked overrides everything to waitingForUser', () => {
    expect(
      mapPidfileStatus({
        ...base,
        status: 'busy',
        detail: 'Bash · ls',
        tempo: 'blocked'
      })
    ).toBe('waitingForUser')
  })
})
