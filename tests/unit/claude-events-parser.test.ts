import * as os from 'os'
import * as path from 'path'
import * as fsp from 'fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  parseClaudeEvents,
  extractClaudePrompts,
  clearClaudeParseCache,
  getCachedExtras
} from '../../src/main/services/providers/claudeEventsParser'

const ts = (sec: number): string => new Date(2024, 0, 1, 0, 0, sec).toISOString()

function jsonl(events: object[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n'
}

describe('claudeEventsParser', () => {
  let tmpDir: string
  let file: string

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dplex-claude-events-'))
    file = path.join(tmpDir, 'session.jsonl')
    clearClaudeParseCache(file)
  })

  afterEach(async () => {
    clearClaudeParseCache(file)
    await fsp.rm(tmpDir, { recursive: true, force: true })
  })

  it('counts user prompts (string content) and tool_use blocks; ignores tool_result deliveries', async () => {
    await fsp.writeFile(
      file,
      jsonl([
        { type: 'user', message: { role: 'user', content: 'hello' }, timestamp: ts(0) },
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'thinking' },
              { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }
            ]
          },
          timestamp: ts(1)
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 't1' }]
          },
          timestamp: ts(2)
        },
        { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] }, timestamp: ts(3) }
      ]),
      'utf-8'
    )

    const result = await parseClaudeEvents(file)
    expect(result.messageCount).toBe(1)
    expect(result.toolCallCount).toBe(1)
    expect(result.detailedStatus).toBe('thinking') // trailing assistant
    expect(result.lastActivityTime).toBe(new Date(ts(3)).getTime())
  })

  it('reports executingTool while a tool_use is unmatched', async () => {
    await fsp.writeFile(
      file,
      jsonl([
        { type: 'user', message: { role: 'user', content: 'run ls' }, timestamp: ts(0) },
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'tool-A', name: 'Bash', input: {} }]
          },
          timestamp: ts(1)
        }
      ]),
      'utf-8'
    )

    const result = await parseClaudeEvents(file)
    expect(result.detailedStatus).toBe('executingTool')
  })

  it('parses incrementally and ignores incomplete trailing line', async () => {
    await fsp.writeFile(
      file,
      jsonl([
        { type: 'user', message: { role: 'user', content: 'first' }, timestamp: ts(0) }
      ]),
      'utf-8'
    )
    const a = await parseClaudeEvents(file)
    expect(a.messageCount).toBe(1)

    // Append an incomplete line (no trailing newline)
    await fsp.appendFile(
      file,
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'second' }, timestamp: ts(1) }),
      'utf-8'
    )
    const b = await parseClaudeEvents(file)
    expect(b.messageCount).toBe(1)

    await fsp.appendFile(file, '\n', 'utf-8')
    const c = await parseClaudeEvents(file)
    expect(c.messageCount).toBe(2)
  })

  it('caches gitBranch, cwd, and firstUserPrompt for provider use', async () => {
    await fsp.writeFile(
      file,
      jsonl([
        {
          type: 'user',
          message: { role: 'user', content: 'kick off' },
          cwd: '/Users/me/repo',
          gitBranch: 'main',
          timestamp: ts(0)
        }
      ]),
      'utf-8'
    )
    await parseClaudeEvents(file)
    const extras = getCachedExtras(file)
    expect(extras.cwd).toBe('/Users/me/repo')
    expect(extras.gitBranch).toBe('main')
    expect(extras.firstUserPrompt).toBe('kick off')
  })

  it('treats trailing api_error retry as thinking', async () => {
    await fsp.writeFile(
      file,
      jsonl([
        { type: 'user', message: { role: 'user', content: 'go' }, timestamp: ts(0) },
        { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'try' }] }, timestamp: ts(1) },
        // After trailingAssistant, a user (string) clears it; then api_error
        { type: 'user', message: { role: 'user', content: 'retry please' }, timestamp: ts(2) },
        { type: 'system', subtype: 'api_error', retryInMs: 5000, timestamp: ts(3) }
      ]),
      'utf-8'
    )
    const r = await parseClaudeEvents(file)
    expect(r.detailedStatus).toBe('thinking')
  })

  it('extractClaudePrompts skips tool_result envelopes and truncates', async () => {
    const long = 'x'.repeat(400)
    await fsp.writeFile(
      file,
      jsonl([
        { type: 'user', message: { role: 'user', content: long }, timestamp: ts(0) },
        {
          type: 'user',
          message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a' }] },
          timestamp: ts(1)
        },
        { type: 'user', message: { role: 'user', content: 'second' }, timestamp: ts(2) }
      ]),
      'utf-8'
    )
    const all = await extractClaudePrompts(file, 10)
    expect(all).toHaveLength(2)
    expect(all[0].text.length).toBe(300)
    expect(all[0].text.endsWith('...')).toBe(true)
    expect(all[1].text).toBe('second')

    const latest = await extractClaudePrompts(file, 1)
    expect(latest).toHaveLength(1)
    expect(latest[0].text).toBe('second')
  })

  it('returns idle defaults for missing files', async () => {
    const r = await parseClaudeEvents(path.join(tmpDir, 'nope.jsonl'))
    expect(r).toEqual({
      detailedStatus: 'idle',
      messageCount: 0,
      toolCallCount: 0,
      lastActivityTime: 0
    })
  })

  it('tolerates malformed json lines', async () => {
    await fsp.writeFile(
      file,
      [
        'not-json',
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'ok' }, timestamp: ts(0) }),
        '{"type":"user"',
        ''
      ].join('\n') + '\n',
      'utf-8'
    )
    const r = await parseClaudeEvents(file)
    expect(r.messageCount).toBe(1)
  })
})
