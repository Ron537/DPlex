import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataBatcher, BATCH_DURATION_MS, BATCH_MAX_SIZE } from '../../src/main/services/dataBatcher'

describe('DataBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('batches multiple writes into a single flush', () => {
    const onFlush = vi.fn()
    const batcher = new DataBatcher(onFlush)

    batcher.write('hello ')
    batcher.write('world')

    // Not flushed yet
    expect(onFlush).not.toHaveBeenCalled()

    // Advance past the batch duration
    vi.advanceTimersByTime(BATCH_DURATION_MS)

    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledWith('hello world')

    batcher.dispose()
  })

  it('does not flush when there is no data', () => {
    const onFlush = vi.fn()
    const batcher = new DataBatcher(onFlush)

    vi.advanceTimersByTime(BATCH_DURATION_MS * 5)

    expect(onFlush).not.toHaveBeenCalled()

    batcher.dispose()
  })

  it('flushes immediately when buffer exceeds max size', () => {
    const onFlush = vi.fn()
    const batcher = new DataBatcher(onFlush)

    // Write a chunk that exceeds the max size
    const largeChunk = 'x'.repeat(BATCH_MAX_SIZE + 1)
    batcher.write(largeChunk)

    // Should flush immediately without waiting for timer
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledWith(largeChunk)

    batcher.dispose()
  })

  it('flushes immediately when accumulated writes exceed max size', () => {
    const onFlush = vi.fn()
    const batcher = new DataBatcher(onFlush)

    // Write two chunks that together exceed the max size
    const halfSize = Math.floor(BATCH_MAX_SIZE / 2) + 1
    batcher.write('x'.repeat(halfSize))
    expect(onFlush).not.toHaveBeenCalled()

    batcher.write('y'.repeat(halfSize))
    // Second write pushes past the threshold — immediate flush
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush.mock.calls[0][0].length).toBe(halfSize * 2)

    batcher.dispose()
  })

  it('resets buffer after flush and can accumulate new data', () => {
    const onFlush = vi.fn()
    const batcher = new DataBatcher(onFlush)

    batcher.write('first')
    vi.advanceTimersByTime(BATCH_DURATION_MS)
    expect(onFlush).toHaveBeenCalledWith('first')

    batcher.write('second')
    vi.advanceTimersByTime(BATCH_DURATION_MS)
    expect(onFlush).toHaveBeenCalledTimes(2)
    expect(onFlush).toHaveBeenLastCalledWith('second')

    batcher.dispose()
  })

  it('does not set multiple timers for consecutive writes', () => {
    const onFlush = vi.fn()
    const batcher = new DataBatcher(onFlush)

    batcher.write('a')
    batcher.write('b')
    batcher.write('c')

    // Only one flush after timer
    vi.advanceTimersByTime(BATCH_DURATION_MS)
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledWith('abc')

    batcher.dispose()
  })

  it('clears pending timer on dispose but flushes remaining data', () => {
    const onFlush = vi.fn()
    const batcher = new DataBatcher(onFlush)

    batcher.write('data')
    batcher.dispose()

    // Timer was cleared, but buffered data was flushed
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledWith('data')

    // No further flush after timer would have fired
    vi.advanceTimersByTime(BATCH_DURATION_MS * 2)
    expect(onFlush).toHaveBeenCalledTimes(1)
  })

  it('dispose is safe when buffer is empty', () => {
    const onFlush = vi.fn()
    const batcher = new DataBatcher(onFlush)

    batcher.dispose()
    expect(onFlush).not.toHaveBeenCalled()
  })

  it('handles rapid small writes efficiently', () => {
    const onFlush = vi.fn()
    const batcher = new DataBatcher(onFlush)

    // Simulate 100 rapid small writes (typical PTY output pattern)
    for (let i = 0; i < 100; i++) {
      batcher.write(`line ${i}\n`)
    }

    // All 100 writes should be coalesced into 1 flush
    expect(onFlush).not.toHaveBeenCalled()
    vi.advanceTimersByTime(BATCH_DURATION_MS)
    expect(onFlush).toHaveBeenCalledTimes(1)

    const flushed = onFlush.mock.calls[0][0]
    expect(flushed).toContain('line 0\n')
    expect(flushed).toContain('line 99\n')

    batcher.dispose()
  })

  it('cancels pending timer when size threshold forces early flush', () => {
    const onFlush = vi.fn()
    const batcher = new DataBatcher(onFlush)

    // Start a small write to set the timer
    batcher.write('start')
    expect(onFlush).not.toHaveBeenCalled()

    // Now write a large chunk that exceeds the threshold
    batcher.write('x'.repeat(BATCH_MAX_SIZE))
    expect(onFlush).toHaveBeenCalledTimes(1)

    // Advancing timer should NOT cause a second flush (timer was cleared)
    vi.advanceTimersByTime(BATCH_DURATION_MS)
    expect(onFlush).toHaveBeenCalledTimes(1)

    batcher.dispose()
  })

  it('flush is idempotent when buffer is empty', () => {
    const onFlush = vi.fn()
    const batcher = new DataBatcher(onFlush)

    batcher.flush()
    batcher.flush()
    batcher.flush()

    expect(onFlush).not.toHaveBeenCalled()

    batcher.dispose()
  })

  it('handles alternating small and large writes', () => {
    const onFlush = vi.fn()
    const batcher = new DataBatcher(onFlush)

    // Small write — starts timer
    batcher.write('small')
    expect(onFlush).not.toHaveBeenCalled()

    // Timer fires
    vi.advanceTimersByTime(BATCH_DURATION_MS)
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledWith('small')

    // Large write — immediate flush
    batcher.write('x'.repeat(BATCH_MAX_SIZE + 100))
    expect(onFlush).toHaveBeenCalledTimes(2)

    // Another small write
    batcher.write('after')
    vi.advanceTimersByTime(BATCH_DURATION_MS)
    expect(onFlush).toHaveBeenCalledTimes(3)
    expect(onFlush).toHaveBeenLastCalledWith('after')

    batcher.dispose()
  })
})
