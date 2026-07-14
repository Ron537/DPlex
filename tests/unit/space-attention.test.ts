import { describe, expect, it } from 'vitest'

import {
  aggregateActiveAwareAttention,
  aggregateAttention,
  aggregateSpaceAttention,
  attentionKindLabel,
  collectSessionCompositeIds,
  EMPTY_SPACE_ATTENTION,
  pickTopKind
} from '../../src/renderer/src/utils/spaceAttention'
import { makeCompositeId, type AttentionEvent } from '../../src/preload/attentionTypes'
import type {
  EditorGroup,
  Space,
  TerminalTab,
  WorkspaceSnapshot
} from '../../src/renderer/src/types'

function aiTab(id: string, sessionId: string, providerId = 'copilot-cli'): TerminalTab {
  return { id, title: id, cwd: '/r', command: 'copilot', sessionId, providerId }
}

function group(id: string, tabs: TerminalTab[]): EditorGroup {
  return { id, tabs, activeTabId: tabs[0]?.id ?? '' }
}

function snapshot(groups: EditorGroup[]): WorkspaceSnapshot {
  return {
    layout: { type: 'group', groupId: groups[0]?.id ?? 'g' },
    groups,
    activeGroupId: groups[0]?.id ?? null
  }
}

function space(id: string, groups: EditorGroup[]): Space {
  const now = Date.now()
  return {
    id,
    name: id,
    color: '#fff',
    projectIds: [],
    workspace: snapshot(groups),
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now
  }
}

function event(
  providerId: string,
  sessionId: string,
  kind: AttentionEvent['kind'],
  overrides: Partial<AttentionEvent> = {}
): AttentionEvent {
  return {
    compositeId: makeCompositeId(providerId, sessionId),
    providerId,
    sessionId,
    displayName: sessionId,
    kind,
    createdAt: Date.now(),
    escalated: false,
    suppressed: false,
    seeded: false,
    ...overrides
  }
}

describe('collectSessionCompositeIds', () => {
  it('collects composite ids for every AI session tab, skipping non-session tabs', () => {
    const snap = snapshot([
      group('g1', [aiTab('t1', 's1'), aiTab('t2', 's2', 'claude-code')]),
      group('g2', [
        aiTab('t3', 's3'),
        { id: 't4', title: 'plain shell', cwd: '/r' } as TerminalTab // no session/provider
      ])
    ])
    const ids = collectSessionCompositeIds(snap)
    expect(ids).toEqual(new Set(['copilot-cli:s1', 'claude-code:s2', 'copilot-cli:s3']))
  })

  it('accepts a bare { groups } object (live terminal-store groups)', () => {
    const ids = collectSessionCompositeIds({ groups: [group('g1', [aiTab('t1', 's1')])] })
    expect(ids).toEqual(new Set(['copilot-cli:s1']))
  })
})

describe('aggregateAttention', () => {
  it('returns EMPTY for an empty id set', () => {
    expect(aggregateAttention([event('copilot-cli', 's1', 'finished')], new Set())).toBe(
      EMPTY_SPACE_ATTENTION
    )
  })

  it('counts only events whose composite id is in the set', () => {
    const events = [
      event('copilot-cli', 's1', 'waitingForApproval'),
      event('copilot-cli', 's2', 'waitingForInput'),
      event('copilot-cli', 'other', 'finished') // not in set
    ]
    const ids = new Set(['copilot-cli:s1', 'copilot-cli:s2'])
    const a = aggregateAttention(events, ids)
    expect(a.waitingForApproval).toBe(1)
    expect(a.waitingForInput).toBe(1)
    expect(a.finished).toBe(0)
    expect(a.total).toBe(2)
  })

  it('ignores suppressed (dismissed) events', () => {
    const events = [event('copilot-cli', 's1', 'waitingForApproval', { suppressed: true })]
    const a = aggregateAttention(events, new Set(['copilot-cli:s1']))
    expect(a.total).toBe(0)
    expect(a.topKind).toBeNull()
  })

  it('prioritizes topKind approval > input > finished', () => {
    const ids = new Set(['copilot-cli:s1', 'copilot-cli:s2', 'copilot-cli:s3'])
    const all = aggregateAttention(
      [
        event('copilot-cli', 's1', 'finished'),
        event('copilot-cli', 's2', 'waitingForInput'),
        event('copilot-cli', 's3', 'waitingForApproval')
      ],
      ids
    )
    expect(all.topKind).toBe('waitingForApproval')

    const noApproval = aggregateAttention(
      [event('copilot-cli', 's1', 'finished'), event('copilot-cli', 's2', 'waitingForInput')],
      ids
    )
    expect(noApproval.topKind).toBe('waitingForInput')

    const onlyFinished = aggregateAttention([event('copilot-cli', 's1', 'finished')], ids)
    expect(onlyFinished.topKind).toBe('finished')
  })
})

describe('aggregateSpaceAttention', () => {
  it('rolls up attention over a space own sessions only — including a backgrounded space', () => {
    const bg = space('bg', [group('g1', [aiTab('t1', 's1'), aiTab('t2', 's2')])])
    const events = [
      event('copilot-cli', 's1', 'waitingForApproval'),
      event('copilot-cli', 's2', 'finished'),
      event('copilot-cli', 'foreign', 'waitingForApproval') // belongs to another space
    ]
    const a = aggregateSpaceAttention(bg, events)
    expect(a.waitingForApproval).toBe(1)
    expect(a.finished).toBe(1)
    expect(a.total).toBe(2)
    expect(a.topKind).toBe('waitingForApproval')
  })

  it('returns EMPTY when a space has no sessions', () => {
    const empty = space('empty', [])
    expect(aggregateSpaceAttention(empty, [event('copilot-cli', 's1', 'finished')])).toBe(
      EMPTY_SPACE_ATTENTION
    )
  })
})

describe('aggregateActiveAwareAttention', () => {
  it('uses live groups (not the stale snapshot) for the active space', () => {
    // The stashed snapshot is empty/stale, but a session is live in the terminal
    // store — the active space must count it immediately.
    const s = space('active', [])
    const events = [event('copilot-cli', 'live1', 'waitingForApproval')]
    const liveGroups = { groups: [group('g1', [aiTab('t1', 'live1')])] }
    const a = aggregateActiveAwareAttention(s, events, liveGroups)
    expect(a.waitingForApproval).toBe(1)
    expect(a.total).toBe(1)
  })

  it('falls back to the stashed snapshot for a background space (null live groups)', () => {
    const s = space('bg', [group('g1', [aiTab('t1', 's1')])])
    const events = [
      event('copilot-cli', 's1', 'finished'),
      event('copilot-cli', 'live1', 'waitingForApproval') // live only, not in the snapshot
    ]
    const a = aggregateActiveAwareAttention(s, events, null)
    expect(a.finished).toBe(1)
    expect(a.waitingForApproval).toBe(0)
    expect(a.total).toBe(1)
  })
})

describe('pickTopKind', () => {
  it('orders approval > input > finished, null when nothing pending', () => {
    expect(pickTopKind(1, 1, 1)).toBe('waitingForApproval')
    expect(pickTopKind(0, 2, 3)).toBe('waitingForInput')
    expect(pickTopKind(0, 0, 5)).toBe('finished')
    expect(pickTopKind(0, 0, 0)).toBeNull()
  })
})

describe('attentionKindLabel', () => {
  it('returns Title-case labels by default and lower-case on request', () => {
    expect(attentionKindLabel('waitingForApproval')).toBe('Needs approval')
    expect(attentionKindLabel('waitingForInput')).toBe('Waiting for you')
    expect(attentionKindLabel('finished')).toBe('Finished')
    expect(attentionKindLabel('waitingForApproval', true)).toBe('needs approval')
    expect(attentionKindLabel('finished', true)).toBe('finished')
  })
})
