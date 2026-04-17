import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiscoveredSession, SessionStatus } from '../../src/main/services/providers/types'
import { makeCompositeId } from '../../src/preload/attentionTypes'

const { setBadgeCount } = vi.hoisted(() => ({
  setBadgeCount: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    setBadgeCount
  }
}))

import * as attentionService from '../../src/main/services/attentionService'

function session(status: SessionStatus): DiscoveredSession {
  return {
    id: 'session-1',
    aiTool: 'copilot-cli',
    status: status === 'idle' ? 'idle' : 'active',
    detailedStatus: status,
    displayName: 'Session 1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z'
  }
}

describe('attentionService', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    setBadgeCount.mockReset()
    attentionService.__resetForTests()
  })

  afterEach(() => {
    attentionService.stopIdleSweeper()
    attentionService.__resetForTests()
    vi.useRealTimers()
  })

  it('tracks waiting events, dismisses them, and clears suppression after transition', () => {
    const compositeId = makeCompositeId('copilot-cli', 'session-1')

    attentionService.ingestSessionUpdate(session('idle'))
    attentionService.ingestSessionUpdate(session('awaitingApproval'))

    let snapshot = attentionService.currentSnapshot()
    expect(snapshot.unreadCount).toBe(1)
    expect(snapshot.active).toHaveLength(1)
    expect(snapshot.active[0].kind).toBe('waitingForApproval')

    attentionService.dismiss(compositeId)

    snapshot = attentionService.currentSnapshot()
    expect(snapshot.unreadCount).toBe(0)
    expect(snapshot.active[0].suppressed).toBe(true)

    attentionService.ingestSessionUpdate(session('waitingForUser'))

    snapshot = attentionService.currentSnapshot()
    expect(snapshot.unreadCount).toBe(1)
    expect(snapshot.active[0].kind).toBe('waitingForInput')
    expect(snapshot.active[0].suppressed).toBe(false)
  })

  it('emits finished events and acknowledgeAll clears them', () => {
    attentionService.ingestSessionUpdate(session('idle'))
    attentionService.ingestSessionUpdate(session('thinking'))
    attentionService.ingestSessionUpdate(session('idle'))

    let snapshot = attentionService.currentSnapshot()
    expect(snapshot.active).toHaveLength(1)
    expect(snapshot.active[0].kind).toBe('finished')

    attentionService.acknowledgeAll()

    snapshot = attentionService.currentSnapshot()
    expect(snapshot.active).toHaveLength(0)
    expect(snapshot.unreadCount).toBe(0)
  })

  it('escalates stale waiting events when idle sweeper runs past threshold', () => {
    const escalations: string[] = []
    const unsubscribe = attentionService.onEscalation((event) => {
      escalations.push(event.kind)
    })

    attentionService.setIdleThresholdMinutes(1)
    attentionService.addDiscoveredSession(session('waitingForUser'))
    attentionService.startIdleSweeper()

    vi.advanceTimersByTime(120_000)

    const snapshot = attentionService.currentSnapshot()
    expect(escalations).toEqual(['waitingForInput'])
    expect(snapshot.active[0].escalated).toBe(true)

    unsubscribe()
  })
})
