import { describe, expect, it } from 'vitest'

import {
  BUSY_BYTES_THRESHOLD,
  BUSY_WINDOW_MS,
  RenderLoadTracker
} from '../../src/renderer/src/services/terminalRenderLoad'

// Creating a WebGL context costs a few hundred milliseconds of synchronous
// native work, so only terminals that genuinely flood output should get one.
// These cover the promotion policy that keeps quiet terminals on xterm's DOM
// renderer — which is what stops app startup and tab switches from stalling.
function makeTracker(): { tracker: RenderLoadTracker; advance: (ms: number) => void } {
  let clock = 0
  const tracker = new RenderLoadTracker(() => clock)
  return { tracker, advance: (ms: number) => (clock += ms) }
}

describe('RenderLoadTracker', () => {
  it('leaves a quiet terminal on the DOM renderer', () => {
    const { tracker, advance } = makeTracker()
    for (let i = 0; i < 50; i++) {
      expect(tracker.record('t1', 200)).toBe(false)
      advance(100)
    }
    expect(tracker.isBusy('t1')).toBe(false)
  })

  it('promotes a terminal that crosses the threshold within one window', () => {
    const { tracker, advance } = makeTracker()
    const chunk = BUSY_BYTES_THRESHOLD / 4

    expect(tracker.record('t1', chunk)).toBe(false)
    advance(100)
    expect(tracker.record('t1', chunk)).toBe(false)
    advance(100)
    expect(tracker.record('t1', chunk)).toBe(false)
    advance(100)
    // Crossing the threshold reports the transition exactly once.
    expect(tracker.record('t1', chunk)).toBe(true)
    expect(tracker.isBusy('t1')).toBe(true)
  })

  it('reports the busy transition only once, so the GPU attach is scheduled once', () => {
    const { tracker } = makeTracker()
    expect(tracker.record('t1', BUSY_BYTES_THRESHOLD)).toBe(true)
    expect(tracker.record('t1', BUSY_BYTES_THRESHOLD)).toBe(false)
    expect(tracker.record('t1', BUSY_BYTES_THRESHOLD)).toBe(false)
  })

  it('promotes on a single oversized chunk (a flow-control burst flush)', () => {
    const { tracker } = makeTracker()
    expect(tracker.record('t1', BUSY_BYTES_THRESHOLD + 1)).toBe(true)
  })

  it('does not accumulate across windows — steady low traffic never promotes', () => {
    const { tracker, advance } = makeTracker()
    // Just under the threshold every window: heavy in total, light at any instant.
    for (let i = 0; i < 20; i++) {
      expect(tracker.record('t1', BUSY_BYTES_THRESHOLD - 1)).toBe(false)
      advance(BUSY_WINDOW_MS)
    }
    expect(tracker.isBusy('t1')).toBe(false)
  })

  it('tracks terminals independently', () => {
    const { tracker } = makeTracker()
    tracker.record('busy', BUSY_BYTES_THRESHOLD)
    tracker.record('quiet', 128)
    expect(tracker.isBusy('busy')).toBe(true)
    expect(tracker.isBusy('quiet')).toBe(false)
  })

  it('latches busy so a hidden-then-shown terminal keeps its GPU claim', () => {
    const { tracker, advance } = makeTracker()
    tracker.record('t1', BUSY_BYTES_THRESHOLD)
    advance(BUSY_WINDOW_MS * 100)
    expect(tracker.isBusy('t1')).toBe(true)
  })

  it('supports explicit promotion without waiting for the threshold', () => {
    const { tracker } = makeTracker()
    expect(tracker.isBusy('t1')).toBe(false)
    tracker.markBusy('t1')
    expect(tracker.isBusy('t1')).toBe(true)
    // Already busy, so no further transition is reported.
    expect(tracker.record('t1', BUSY_BYTES_THRESHOLD)).toBe(false)
  })

  it('forgets a destroyed terminal so a recycled id starts fresh', () => {
    const { tracker } = makeTracker()
    tracker.record('t1', BUSY_BYTES_THRESHOLD)
    expect(tracker.isBusy('t1')).toBe(true)
    tracker.forget('t1')
    expect(tracker.isBusy('t1')).toBe(false)
    expect(tracker.record('t1', 128)).toBe(false)
  })

  it('starts a fresh window after a quiet gap rather than counting stale bytes', () => {
    const { tracker, advance } = makeTracker()
    tracker.record('t1', BUSY_BYTES_THRESHOLD - 1)
    advance(BUSY_WINDOW_MS + 1)
    // The stale window must be discarded, not topped up into a promotion.
    expect(tracker.record('t1', 128)).toBe(false)
    expect(tracker.isBusy('t1')).toBe(false)
  })
})
