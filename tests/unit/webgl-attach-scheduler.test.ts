import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import {
  WebglAttachScheduler,
  WEBGL_ATTACH_IDLE_TIMEOUT_MS,
  WEBGL_ATTACH_MIN_GAP_MS
} from '../../src/renderer/src/services/webglAttachScheduler'

describe('WebglAttachScheduler', () => {
  let now = 0
  let attached: string[]
  /** Stands in for "alive, on screen and without a context yet". */
  let eligible: Set<string>

  const makeScheduler = (): WebglAttachScheduler =>
    new WebglAttachScheduler({
      attach: (id) => attached.push(id),
      canAttach: (id) => eligible.has(id),
      now: () => now
    })

  beforeEach(() => {
    vi.useFakeTimers()
    now = 0
    attached = []
    eligible = new Set(['a', 'b'])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('never attaches synchronously', () => {
    const scheduler = makeScheduler()
    scheduler.schedule('a')
    // The whole point: ~300ms of native context creation must not run inline.
    expect(attached).toEqual([])
    vi.advanceTimersByTime(1)
    expect(attached).toEqual(['a'])
  })

  it('does not queue an attach for an ineligible terminal', () => {
    const scheduler = makeScheduler()
    eligible.clear()
    scheduler.schedule('a')
    expect(scheduler.isPending('a')).toBe(false)
    vi.advanceTimersByTime(5000)
    expect(attached).toEqual([])
  })

  it('re-checks eligibility when the deferred callback runs', () => {
    const scheduler = makeScheduler()
    scheduler.schedule('a')
    eligible.delete('a')
    vi.advanceTimersByTime(5000)
    expect(attached).toEqual([])
  })

  it('drops a queued attach on cancel', () => {
    const scheduler = makeScheduler()
    scheduler.schedule('a')
    expect(scheduler.isPending('a')).toBe(true)
    scheduler.cancel('a')
    expect(scheduler.isPending('a')).toBe(false)
    vi.advanceTimersByTime(5000)
    expect(attached).toEqual([])
  })

  it('does not queue an attach for every tab flicked past', () => {
    const scheduler = makeScheduler()
    // Two busy sessions switched between rapidly: each is scheduled as it comes
    // on screen, then cancelled as it's hidden before the idle slot arrives.
    for (let i = 0; i < 5; i++) {
      scheduler.schedule('a')
      scheduler.cancel('a')
      scheduler.schedule('b')
      scheduler.cancel('b')
    }
    vi.advanceTimersByTime(5000)
    expect(attached).toEqual([])
  })

  it('spaces simultaneous promotions apart instead of stacking them', () => {
    const scheduler = makeScheduler()
    scheduler.schedule('a')
    scheduler.schedule('b')

    vi.advanceTimersByTime(1)
    expect(attached).toEqual(['a'])

    now += WEBGL_ATTACH_MIN_GAP_MS - 1
    vi.advanceTimersByTime(WEBGL_ATTACH_MIN_GAP_MS - 1)
    expect(attached).toEqual(['a'])

    now += 2
    vi.advanceTimersByTime(2)
    expect(attached).toEqual(['a', 'b'])
  })

  it('is idempotent while an attach is already pending', () => {
    const scheduler = makeScheduler()
    scheduler.schedule('a')
    scheduler.schedule('a')
    scheduler.schedule('a')
    vi.advanceTimersByTime(5000)
    expect(attached).toEqual(['a'])
  })

  it('cancels a gap-delayed retry', () => {
    const scheduler = makeScheduler()
    scheduler.schedule('a')
    scheduler.schedule('b')
    vi.advanceTimersByTime(1)
    expect(attached).toEqual(['a'])

    // 'b' is now waiting out the gap rather than sitting in an idle callback.
    expect(scheduler.isPending('b')).toBe(true)
    scheduler.cancel('b')
    now += WEBGL_ATTACH_MIN_GAP_MS * 2
    vi.advanceTimersByTime(WEBGL_ATTACH_MIN_GAP_MS * 2)
    expect(attached).toEqual(['a'])
  })

  it('can be scheduled again after a cancelled attach', () => {
    const scheduler = makeScheduler()
    scheduler.schedule('a')
    scheduler.cancel('a')
    vi.advanceTimersByTime(5000)
    expect(attached).toEqual([])

    scheduler.schedule('a')
    vi.advanceTimersByTime(1)
    expect(attached).toEqual(['a'])
  })
})

// jsdom has no requestIdleCallback, so the suite above exercises the setTimeout
// fallback. Production Electron always takes the idle path, and the two branches
// hand back different cancel closures — so it gets its own tests.
describe('WebglAttachScheduler on the requestIdleCallback path', () => {
  let queued: { id: number; run: () => void; timeout?: number }[]
  let cancelled: number[]
  let nextHandle: number

  beforeEach(() => {
    queued = []
    cancelled = []
    nextHandle = 1
    vi.stubGlobal('requestIdleCallback', (run: () => void, options?: { timeout?: number }) => {
      const id = nextHandle++
      queued.push({ id, run, timeout: options?.timeout })
      return id
    })
    vi.stubGlobal('cancelIdleCallback', (handle: number) => {
      cancelled.push(handle)
      queued = queued.filter((q) => q.id !== handle)
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defers through requestIdleCallback with a bounded timeout', () => {
    const attached: string[] = []
    const scheduler = new WebglAttachScheduler({
      attach: (id) => attached.push(id),
      canAttach: () => true
    })

    scheduler.schedule('a')
    expect(queued).toHaveLength(1)
    expect(queued[0].timeout).toBe(WEBGL_ATTACH_IDLE_TIMEOUT_MS)
    expect(attached).toEqual([])

    queued[0].run()
    expect(attached).toEqual(['a'])
  })

  it('cancels through cancelIdleCallback, not clearTimeout', () => {
    const attached: string[] = []
    const scheduler = new WebglAttachScheduler({
      attach: (id) => attached.push(id),
      canAttach: () => true
    })

    scheduler.schedule('a')
    const handle = queued[0].id
    scheduler.cancel('a')

    expect(cancelled).toEqual([handle])
    expect(queued).toHaveLength(0)
    expect(scheduler.isPending('a')).toBe(false)
    expect(attached).toEqual([])
  })
})
