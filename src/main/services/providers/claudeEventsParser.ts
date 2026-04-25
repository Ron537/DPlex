import * as fsp from 'fs/promises'
import type { ParsedSessionData, SessionPrompt, SessionStatus } from './types'

/**
 * Incremental JSONL parser for Claude Code session transcripts
 * (`~/.claude/projects/<slug>/<sessionId>.jsonl`).
 *
 * Parallel to `copilotEventsParser` — uses a byte-offset cache to avoid
 * re-reading the entire file on each refresh.
 *
 * Note: Claude's true live status comes from the pidfile registry
 * (`~/.claude/sessions/<pid>.json`). This parser is only consulted as a
 * fallback for archived/idle sessions and to extract the prompt history.
 * The status fields it produces are derived from envelope sequencing
 * heuristics, not from authoritative status flags.
 */

interface ParserCache {
  byteOffset: number
  data: ParsedSessionData
  /** tool_use ids whose matching tool_result hasn't been seen. */
  pendingToolUseIds: Set<string>
  /** True if the trailing envelope is an `assistant` (no following user msg). */
  trailingAssistant: boolean
  /** True if the trailing envelope is an `api_error` mid back-off retry. */
  trailingApiError: boolean
  /** Cached gitBranch from the most recent envelope that included one. */
  gitBranch?: string
  /** Cached cwd field from the most recent envelope that included one. */
  cwd?: string
  /** First user prompt text (used for displayName fallback). */
  firstUserPrompt?: string
}

const cacheStore = new Map<string, ParserCache>()

interface ContentBlock {
  type?: string
  text?: string
  id?: string
  tool_use_id?: string
  name?: string
  input?: Record<string, unknown>
}

interface ClaudeEnvelope {
  type?: string
  subtype?: string
  timestamp?: string
  message?: {
    role?: string
    content?: string | ContentBlock[]
  }
  cwd?: string
  gitBranch?: string
  retryInMs?: number
}

/**
 * Incrementally parse a Claude `<sessionId>.jsonl` transcript.
 * Returns ParsedSessionData plus extra fields needed by the provider
 * (gitBranch, cwd, firstUserPrompt) via {@link getCachedExtras}.
 */
export async function parseClaudeEvents(filePath: string): Promise<ParsedSessionData> {
  const cached = cacheStore.get(filePath)
  let cache: ParserCache = cached ?? {
    byteOffset: 0,
    data: {
      detailedStatus: 'idle',
      messageCount: 0,
      toolCallCount: 0,
      lastActivityTime: 0
    },
    pendingToolUseIds: new Set<string>(),
    trailingAssistant: false,
    trailingApiError: false
  }

  let stat: { size: number }
  try {
    stat = await fsp.stat(filePath)
  } catch {
    return cache.data
  }

  if (stat.size <= cache.byteOffset) {
    cache.data.detailedStatus = deriveDetailedStatus(cache)
    return cache.data
  }

  const fd = await fsp.open(filePath, 'r')
  try {
    const newSize = stat.size - cache.byteOffset
    const buffer = Buffer.alloc(newSize)
    const { bytesRead } = await fd.read(buffer, 0, newSize, cache.byteOffset)
    const content = buffer.toString('utf-8', 0, bytesRead)

    // Clone the data so callers see a stable object even if we mutate later.
    const data = { ...cache.data }
    const pending = new Set(cache.pendingToolUseIds)
    let { trailingAssistant, trailingApiError, gitBranch, cwd, firstUserPrompt } = cache

    // Only advance offset through the last complete newline.
    const endsWithNewline = content.endsWith('\n')
    const lines = content.split('\n')
    const lastIncompleteLen = endsWithNewline
      ? 0
      : Buffer.byteLength(lines[lines.length - 1], 'utf-8')
    const parsedByteCount = bytesRead - lastIncompleteLen

    const lastIdx = lines.length - (endsWithNewline ? 0 : 1)
    for (let i = 0; i < lastIdx; i++) {
      const trimmed = lines[i].trim()
      if (!trimmed) continue
      let event: ClaudeEnvelope
      try {
        event = JSON.parse(trimmed) as ClaudeEnvelope
      } catch {
        continue
      }

      if (event.gitBranch && typeof event.gitBranch === 'string') gitBranch = event.gitBranch
      if (event.cwd && typeof event.cwd === 'string') cwd = event.cwd
      if (event.timestamp) {
        const ts = new Date(event.timestamp).getTime()
        if (!Number.isNaN(ts) && ts > data.lastActivityTime) data.lastActivityTime = ts
      }

      switch (event.type) {
        case 'user': {
          // A `user` envelope can be either a real prompt (string content)
          // or a tool_result delivery (array content with tool_result blocks).
          const content = event.message?.content
          if (typeof content === 'string') {
            data.messageCount++
            if (!firstUserPrompt) {
              const t = content.trim()
              firstUserPrompt = t.length > 80 ? t.slice(0, 77) + '...' : t
            }
            trailingAssistant = false
            trailingApiError = false
          } else if (Array.isArray(content)) {
            // Process tool_results to clear pending tool_use ids.
            for (const block of content) {
              if (block?.type === 'tool_result' && typeof block.tool_use_id === 'string') {
                pending.delete(block.tool_use_id)
              }
            }
            trailingAssistant = false
          }
          break
        }
        case 'assistant': {
          const content = event.message?.content
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block?.type === 'tool_use') {
                data.toolCallCount++
                if (typeof block.id === 'string') pending.add(block.id)
              }
            }
          }
          trailingAssistant = true
          trailingApiError = false
          break
        }
        case 'system': {
          if (event.subtype === 'api_error' && typeof event.retryInMs === 'number') {
            trailingApiError = true
          }
          break
        }
        // Other envelope types (`permission-mode`, `file-history-snapshot`,
        // `attachment`, `custom-title`, `agent-name`, ...) don't influence
        // status or counts.
        default:
          break
      }
    }

    cache = {
      byteOffset: cache.byteOffset + parsedByteCount,
      data,
      pendingToolUseIds: pending,
      trailingAssistant,
      trailingApiError,
      gitBranch,
      cwd,
      firstUserPrompt
    }
    cache.data.detailedStatus = deriveDetailedStatus(cache)
    cacheStore.set(filePath, cache)
    return cache.data
  } finally {
    await fd.close()
  }
}

/**
 * Derive detailedStatus from the parser cache. Only used as a fallback when
 * no live pidfile is available — Claude's pidfile registry is the
 * authoritative source for live sessions.
 */
function deriveDetailedStatus(cache: ParserCache): SessionStatus {
  if (cache.trailingApiError) return 'thinking'
  if (cache.pendingToolUseIds.size > 0) return 'executingTool'
  if (cache.trailingAssistant) return 'thinking'
  return 'idle'
}

/** Extra fields the parser caches but that don't fit in `ParsedSessionData`. */
export interface ClaudeEventsExtras {
  gitBranch?: string
  cwd?: string
  firstUserPrompt?: string
}

export function getCachedExtras(filePath: string): ClaudeEventsExtras {
  const c = cacheStore.get(filePath)
  if (!c) return {}
  return {
    gitBranch: c.gitBranch,
    cwd: c.cwd,
    firstUserPrompt: c.firstUserPrompt
  }
}

/**
 * Extract user prompts from a Claude session transcript.
 * Skips tool_result deliveries (which also use the `user` envelope type).
 * Returns at most `limit` prompts, most recent last; each truncated to 300
 * characters.
 */
export async function extractClaudePrompts(
  jsonlPath: string,
  limit: number
): Promise<SessionPrompt[]> {
  const prompts: SessionPrompt[] = []

  let content: string
  try {
    content = await fsp.readFile(jsonlPath, 'utf-8')
  } catch {
    return prompts
  }

  const lines = content.split('\n')
  let index = 0
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let event: ClaudeEnvelope
    try {
      event = JSON.parse(trimmed) as ClaudeEnvelope
    } catch {
      continue
    }
    if (event.type !== 'user') continue
    const c = event.message?.content
    if (typeof c !== 'string') continue
    const text = c.trim()
    if (!text) continue
    prompts.push({
      text: text.length > 300 ? text.slice(0, 297) + '...' : text,
      timestamp: event.timestamp ? new Date(event.timestamp).getTime() : undefined,
      index: index++
    })
  }

  return prompts.slice(-limit)
}

/** Clear cached parse state for a file (use after deletion). */
export function clearClaudeParseCache(filePath: string): void {
  cacheStore.delete(filePath)
}
