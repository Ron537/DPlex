import { describe, expect, it } from 'vitest'
import {
  BaseSessionProvider,
  type SessionEntry
} from '../../src/main/services/providers/baseProvider'
import type {
  DiscoveredSession,
  ParsedSessionData,
  SessionPrompt
} from '../../src/main/services/providers/types'

class TestProvider extends BaseSessionProvider {
  readonly id = 'test'
  readonly name = 'Test'
  readonly command = 'test'
  readonly icon = 'Bot'

  protected getSessionDir(): string {
    return '/tmp/test-provider'
  }

  protected async parseSession(): Promise<DiscoveredSession | null> {
    return null
  }

  protected parseEventsIncremental(): Promise<ParsedSessionData> {
    return Promise.resolve({
      detailedStatus: 'idle',
      messageCount: 0,
      toolCallCount: 0,
      lastActivityTime: 0
    })
  }

  protected extractPromptsFromEvents(): Promise<SessionPrompt[]> {
    return Promise.resolve([])
  }

  getResumeCommand(id: string): string {
    return `test --resume ${id}`
  }

  getNewSessionCommand(): string {
    return 'test'
  }

  // Expose protected method for testing.
  publicValidate(id: string): boolean {
    return this.validateSessionId(id)
  }
}

describe('BaseSessionProvider.validateSessionId', () => {
  const p = new TestProvider()

  it('accepts UUID/hex shaped ids', () => {
    expect(p.publicValidate('abc123')).toBe(true)
    expect(p.publicValidate('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    expect(p.publicValidate('foo_bar-BAZ')).toBe(true)
  })

  it('rejects empty and overlong ids', () => {
    expect(p.publicValidate('')).toBe(false)
    expect(p.publicValidate('a'.repeat(129))).toBe(false)
  })

  it('rejects path traversal characters', () => {
    expect(p.publicValidate('../etc/passwd')).toBe(false)
    expect(p.publicValidate('foo/bar')).toBe(false)
    expect(p.publicValidate('foo\\bar')).toBe(false)
  })

  it('rejects shell metacharacters that could break out of the resume command', () => {
    expect(p.publicValidate('a;rm -rf /')).toBe(false)
    expect(p.publicValidate('a$(whoami)')).toBe(false)
    expect(p.publicValidate('a`whoami`')).toBe(false)
    expect(p.publicValidate('a&&b')).toBe(false)
    expect(p.publicValidate('a|b')).toBe(false)
    expect(p.publicValidate('a b')).toBe(false)
    expect(p.publicValidate('a\nb')).toBe(false)
    expect(p.publicValidate("a'b")).toBe(false)
    expect(p.publicValidate('a"b')).toBe(false)
  })
})

describe('SessionEntry shape', () => {
  it('includes the four required fields', () => {
    const e: SessionEntry = { id: 'x', path: '/tmp/x', mtimeMs: 0, birthtimeMs: 0 }
    expect(e).toBeDefined()
  })
})
