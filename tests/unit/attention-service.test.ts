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

function session(
  status: SessionStatus,
  terminalReason?: DiscoveredSession['terminalReason']
): DiscoveredSession {
  return {
    id: 'session-1',
    aiTool: 'copilot-cli',
    status: status === 'idle' ? 'idle' : 'active',
    detailedStatus: status,
    displayName: 'Session 1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    terminalReason
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

  it('emits finished events after the settle window and acknowledgeAll clears them', () => {
    attentionService.ingestSessionUpdate(session('idle'))
    attentionService.ingestSessionUpdate(session('thinking'))
    attentionService.ingestSessionUpdate(session('idle'))

    // Finished is deferred by the settle window — nothing yet.
    let snapshot = attentionService.currentSnapshot()
    expect(snapshot.active).toHaveLength(0)

    vi.advanceTimersByTime(4000)

    snapshot = attentionService.currentSnapshot()
    expect(snapshot.active).toHaveLength(1)
    expect(snapshot.active[0].kind).toBe('finished')

    attentionService.acknowledgeAll()

    snapshot = attentionService.currentSnapshot()
    expect(snapshot.active).toHaveLength(0)
    expect(snapshot.unreadCount).toBe(0)
  })

  it('cancels a pending finished event when the session resumes work', () => {
    attentionService.ingestSessionUpdate(session('idle'))
    attentionService.ingestSessionUpdate(session('thinking'))
    attentionService.ingestSessionUpdate(session('idle'))

    // Resume work before the settle window elapses.
    attentionService.ingestSessionUpdate(session('thinking'))
    vi.advanceTimersByTime(4000)

    const snapshot = attentionService.currentSnapshot()
    expect(snapshot.active).toHaveLength(0)
    expect(snapshot.unreadCount).toBe(0)
  })

  it('suppresses finished when the turn ended via a user abort', () => {
    attentionService.ingestSessionUpdate(session('idle'))
    attentionService.ingestSessionUpdate(session('thinking'))
    attentionService.ingestSessionUpdate(session('idle', 'aborted'))

    vi.advanceTimersByTime(4000)

    const snapshot = attentionService.currentSnapshot()
    expect(snapshot.active).toHaveLength(0)
    expect(snapshot.unreadCount).toBe(0)
  })

  it('emits an error event after the settle window when the turn ended with an error', () => {
    attentionService.ingestSessionUpdate(session('idle'))
    attentionService.ingestSessionUpdate(session('thinking'))
    attentionService.ingestSessionUpdate(session('idle', 'error'))

    // Deferred like "finished" — nothing until the settle window elapses.
    let snapshot = attentionService.currentSnapshot()
    expect(snapshot.active).toHaveLength(0)

    vi.advanceTimersByTime(4000)

    snapshot = attentionService.currentSnapshot()
    expect(snapshot.active).toHaveLength(1)
    expect(snapshot.active[0].kind).toBe('error')
    expect(snapshot.unreadCount).toBe(1)
  })

  it('cancels a pending error when the session recovers and keeps working', () => {
    attentionService.ingestSessionUpdate(session('idle'))
    attentionService.ingestSessionUpdate(session('thinking'))
    attentionService.ingestSessionUpdate(session('idle', 'error'))
    // CLI recovers and resumes work before the settle window elapses.
    attentionService.ingestSessionUpdate(session('executingTool'))

    vi.advanceTimersByTime(4000)

    const snapshot = attentionService.currentSnapshot()
    expect(snapshot.active).toHaveLength(0)
    expect(snapshot.unreadCount).toBe(0)
  })

  it('cancels a pending finished when a late abort arrives while already idle', () => {
    attentionService.ingestSessionUpdate(session('idle'))
    attentionService.ingestSessionUpdate(session('thinking'))
    // Working → idle(completed) schedules a finished event.
    attentionService.ingestSessionUpdate(session('idle', 'completed'))
    // A late abort arrives while still idle — must cancel the pending finished.
    attentionService.ingestSessionUpdate(session('idle', 'aborted'))

    vi.advanceTimersByTime(4000)

    const snapshot = attentionService.currentSnapshot()
    expect(snapshot.active).toHaveLength(0)
    expect(snapshot.unreadCount).toBe(0)
  })

  it('emits an error event when a late error arrives while already idle', () => {
    attentionService.ingestSessionUpdate(session('idle'))
    attentionService.ingestSessionUpdate(session('thinking'))
    attentionService.ingestSessionUpdate(session('idle', 'completed'))
    attentionService.ingestSessionUpdate(session('idle', 'error'))

    vi.advanceTimersByTime(4000)

    const snapshot = attentionService.currentSnapshot()
    expect(snapshot.active).toHaveLength(1)
    expect(snapshot.active[0].kind).toBe('error')
  })

  it('surfaces an error and clears a stale waiting event on waiting → idle+error', () => {
    attentionService.ingestSessionUpdate(session('idle'))
    attentionService.ingestSessionUpdate(session('waitingForUser'))

    let snapshot = attentionService.currentSnapshot()
    expect(snapshot.active[0].kind).toBe('waitingForInput')

    // Session errors out while still showing a waiting event.
    attentionService.ingestSessionUpdate(session('idle', 'error'))

    // The stale waiting event must be gone immediately (not left on the bell).
    snapshot = attentionService.currentSnapshot()
    expect(snapshot.active).toHaveLength(0)

    // And the error must still surface after the settle window.
    vi.advanceTimersByTime(4000)
    snapshot = attentionService.currentSnapshot()
    expect(snapshot.active).toHaveLength(1)
    expect(snapshot.active[0].kind).toBe('error')
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
