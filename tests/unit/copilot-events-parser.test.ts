import * as os from 'os'
import * as path from 'path'
import * as fsp from 'fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearCopilotParseCache,
  extractCopilotPrompts,
  parseCopilotEvents
} from '../../src/main/services/providers/copilotEventsParser'

describe('copilotEventsParser', () => {
  let tmpDir: string
  let eventsFile: string

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dplex-events-'))
    eventsFile = path.join(tmpDir, 'events.jsonl')
    clearCopilotParseCache(eventsFile)
  })

  afterEach(async () => {
    clearCopilotParseCache(eventsFile)
    await fsp.rm(tmpDir, { recursive: true, force: true })
  })

  it('parses events incrementally and ignores incomplete trailing lines', async () => {
    const firstBatch = [
      { type: 'session.start', timestamp: '2024-01-01T00:00:00.000Z' },
      {
        type: 'user.message',
        data: { content: 'hello' },
        timestamp: '2024-01-01T00:00:01.000Z'
      },
      {
        type: 'tool.execution_start',
        data: { toolName: 'shell' },
        timestamp: '2024-01-01T00:00:02.000Z'
      },
      { type: 'tool.execution_complete', timestamp: '2024-01-01T00:00:03.000Z' },
      { type: 'assistant.turn_end', timestamp: '2024-01-01T00:00:04.000Z' }
    ]
      .map((event) => `${JSON.stringify(event)}\n`)
      .join('')

    await fsp.writeFile(eventsFile, firstBatch, 'utf-8')

    const initial = await parseCopilotEvents(eventsFile)
    expect(initial.messageCount).toBe(1)
    expect(initial.toolCallCount).toBe(1)
    expect(initial.detailedStatus).toBe('idle')
    expect(initial.lastActivityTime).toBe(new Date('2024-01-01T00:00:04.000Z').getTime())

    await fsp.appendFile(
      eventsFile,
      '{"type":"user.message","data":{"content":"incomplete"},"timestamp":"2024-01-01T00:00:05.000Z"}',
      'utf-8'
    )

    const partial = await parseCopilotEvents(eventsFile)
    expect(partial.messageCount).toBe(1)
    expect(partial.lastActivityTime).toBe(new Date('2024-01-01T00:00:04.000Z').getTime())

    await fsp.appendFile(eventsFile, '\n', 'utf-8')

    const completed = await parseCopilotEvents(eventsFile)
    expect(completed.messageCount).toBe(2)
    expect(completed.detailedStatus).toBe('thinking')
    expect(completed.lastActivityTime).toBe(new Date('2024-01-01T00:00:05.000Z').getTime())
  })

  it('extracts and truncates prompts with limit applied to the latest prompts', async () => {
    const longPrompt = 'x'.repeat(320)
    const contents = [
      {
        type: 'user.message',
        data: { content: longPrompt },
        timestamp: '2024-01-01T00:00:00.000Z'
      },
      { type: 'assistant.turn_start', timestamp: '2024-01-01T00:00:01.000Z' },
      {
        type: 'user.message',
        data: { content: 'second prompt' },
        timestamp: '2024-01-01T00:00:02.000Z'
      },
      'not-json'
    ]
      .map((event) => (typeof event === 'string' ? `${event}\n` : `${JSON.stringify(event)}\n`))
      .join('')

    await fsp.writeFile(eventsFile, contents, 'utf-8')

    const allPrompts = await extractCopilotPrompts(tmpDir, 10)
    expect(allPrompts).toHaveLength(2)
    expect(allPrompts[0].text.length).toBe(300)
    expect(allPrompts[0].text.endsWith('...')).toBe(true)
    expect(allPrompts[1].text).toBe('second prompt')

    const latestOnly = await extractCopilotPrompts(tmpDir, 1)
    expect(latestOnly).toHaveLength(1)
    expect(latestOnly[0].text).toBe('second prompt')
    expect(latestOnly[0].index).toBe(1)
  })

  it('handles missing files and malformed jsonl lines without throwing', async () => {
    const missing = await parseCopilotEvents(eventsFile)
    expect(missing).toEqual({
      detailedStatus: 'idle',
      messageCount: 0,
      toolCallCount: 0,
      lastActivityTime: 0
    })

    await fsp.writeFile(
      eventsFile,
      [
        'not-json',
        JSON.stringify({ type: 'tool.execution_start', data: { toolName: 'shell' } }),
        '{"type":"tool.execution_complete"',
        JSON.stringify({ type: 'session.task_complete', timestamp: 'bad-timestamp' })
      ].join('\n') + '\n',
      'utf-8'
    )

    const parsed = await parseCopilotEvents(eventsFile)
    expect(parsed.toolCallCount).toBe(1)
    expect(parsed.detailedStatus).toBe('idle')
    expect(parsed.lastActivityTime).toBe(0)
  })

  it('sets awaitingApproval on permission.requested and resumes on permission.completed', async () => {
    const events = [
      { type: 'session.start', timestamp: '2024-01-01T00:00:00.000Z' },
      {
        type: 'user.message',
        data: { content: 'do something' },
        timestamp: '2024-01-01T00:00:01.000Z'
      },
      {
        type: 'permission.requested',
        data: { requestId: 'req-1', permissionRequest: { kind: 'shell' } },
        timestamp: '2024-01-01T00:00:02.000Z'
      }
    ]
      .map((event) => `${JSON.stringify(event)}\n`)
      .join('')

    await fsp.writeFile(eventsFile, events, 'utf-8')

    const pending = await parseCopilotEvents(eventsFile)
    expect(pending.detailedStatus).toBe('awaitingApproval')

    // User approves — no tools are running so agent should resume thinking
    await fsp.appendFile(
      eventsFile,
      JSON.stringify({
        type: 'permission.completed',
        data: { requestId: 'req-1', result: { kind: 'approved' } },
        timestamp: '2024-01-01T00:00:03.000Z'
      }) + '\n',
      'utf-8'
    )

    const approved = await parseCopilotEvents(eventsFile)
    expect(approved.detailedStatus).toBe('thinking')
  })

  it('keeps executingTool status when permission.completed fires with pending tools', async () => {
    const events = [
      { type: 'session.start', timestamp: '2024-01-01T00:00:00.000Z' },
      {
        type: 'user.message',
        data: { content: 'do something' },
        timestamp: '2024-01-01T00:00:01.000Z'
      },
      {
        type: 'tool.execution_start',
        data: { toolName: 'bash' },
        timestamp: '2024-01-01T00:00:02.000Z'
      },
      {
        type: 'permission.requested',
        data: { requestId: 'req-1', permissionRequest: { kind: 'shell' } },
        timestamp: '2024-01-01T00:00:03.000Z'
      }
    ]
      .map((event) => `${JSON.stringify(event)}\n`)
      .join('')

    await fsp.writeFile(eventsFile, events, 'utf-8')

    // Permission completed while tool still running — should stay awaitingApproval
    // (not flip to thinking since pendingToolCalls > 0)
    await fsp.appendFile(
      eventsFile,
      JSON.stringify({
        type: 'permission.completed',
        data: { requestId: 'req-1', result: { kind: 'approved' } },
        timestamp: '2024-01-01T00:00:04.000Z'
      }) + '\n',
      'utf-8'
    )

    const result = await parseCopilotEvents(eventsFile)
    expect(result.detailedStatus).toBe('awaitingApproval')
  })
})
