import { describe, expect, it, vi } from 'vitest'
import {
  FlowController,
  FLOW_CONTROL_HIGH_WATERMARK,
  FLOW_CONTROL_LOW_WATERMARK,
  FLOW_CONTROL_CALLBACK_BYTE_LIMIT,
  type FlowControlWriter,
  type FlowControlTransport
} from '../../src/renderer/src/services/flowControl'

function createMocks() {
  const writeCallbacks: (() => void)[] = []
  const writer: FlowControlWriter = {
    write: vi.fn((data: string, callback?: () => void) => {
      if (callback) writeCallbacks.push(callback)
    })
  }
  const transport: FlowControlTransport = {
    pause: vi.fn(),
    resume: vi.fn()
  }
  return { writer, transport, writeCallbacks }
}

describe('FlowController', () => {
  it('uses fast path (no callback) for small writes', () => {
    const { writer, transport } = createMocks()
    const fc = new FlowController('pty-1', writer, transport)

    fc.write('hello')

    expect(writer.write).toHaveBeenCalledTimes(1)
    expect(writer.write).toHaveBeenCalledWith('hello')
    expect(transport.pause).not.toHaveBeenCalled()

    fc.dispose()
  })

  it('places a write callback when byte threshold is crossed', () => {
    const { writer, transport } = createMocks()
    const fc = new FlowController('pty-1', writer, transport)

    const chunk = 'x'.repeat(FLOW_CONTROL_CALLBACK_BYTE_LIMIT)
    fc.write(chunk)

    expect(writer.write).toHaveBeenCalledTimes(1)
    // Should be called with data AND a callback
    expect(vi.mocked(writer.write).mock.calls[0].length).toBe(2)
    expect(typeof vi.mocked(writer.write).mock.calls[0][1]).toBe('function')

    expect(fc.pendingCallbacks).toBe(1)
    expect(fc.bytesWritten).toBe(0) // reset after placing callback

    fc.dispose()
  })

  it('accumulates bytes across multiple small writes before placing callback', () => {
    const { writer, transport } = createMocks()
    const fc = new FlowController('pty-1', writer, transport)

    const chunkSize = Math.floor(FLOW_CONTROL_CALLBACK_BYTE_LIMIT / 3)

    // Three writes, each under threshold
    fc.write('x'.repeat(chunkSize))
    fc.write('x'.repeat(chunkSize))

    // All fast path so far
    expect(fc.pendingCallbacks).toBe(0)

    // Third write crosses the threshold
    fc.write('x'.repeat(chunkSize + 1))
    expect(fc.pendingCallbacks).toBe(1)

    fc.dispose()
  })

  it('pauses PTY when pending callbacks exceed high watermark', () => {
    const { writer, transport } = createMocks()
    const fc = new FlowController('pty-1', writer, transport)

    const chunk = 'x'.repeat(FLOW_CONTROL_CALLBACK_BYTE_LIMIT)

    // Write enough times to exceed high watermark
    for (let i = 0; i <= FLOW_CONTROL_HIGH_WATERMARK; i++) {
      fc.write(chunk)
    }

    expect(fc.paused).toBe(true)
    expect(transport.pause).toHaveBeenCalledWith('pty-1')
    expect(transport.pause).toHaveBeenCalledTimes(1)

    fc.dispose()
  })

  it('resumes PTY when pending callbacks drop below low watermark', () => {
    const { writer, transport, writeCallbacks } = createMocks()
    const fc = new FlowController('pty-1', writer, transport)

    const chunk = 'x'.repeat(FLOW_CONTROL_CALLBACK_BYTE_LIMIT)

    // Build up to paused state
    for (let i = 0; i <= FLOW_CONTROL_HIGH_WATERMARK; i++) {
      fc.write(chunk)
    }
    expect(fc.paused).toBe(true)

    // Simulate xterm.js completing parse of most callbacks
    const callbacksToFire = writeCallbacks.length - FLOW_CONTROL_LOW_WATERMARK + 1
    for (let i = 0; i < callbacksToFire; i++) {
      writeCallbacks[i]()
    }

    expect(fc.paused).toBe(false)
    expect(transport.resume).toHaveBeenCalledWith('pty-1')

    fc.dispose()
  })

  it('does not pause until high watermark is exceeded (not equal)', () => {
    const { writer, transport } = createMocks()
    const fc = new FlowController('pty-1', writer, transport)

    const chunk = 'x'.repeat(FLOW_CONTROL_CALLBACK_BYTE_LIMIT)

    // Write exactly high watermark times
    for (let i = 0; i < FLOW_CONTROL_HIGH_WATERMARK; i++) {
      fc.write(chunk)
    }

    expect(fc.pendingCallbacks).toBe(FLOW_CONTROL_HIGH_WATERMARK)
    expect(fc.paused).toBe(false)
    expect(transport.pause).not.toHaveBeenCalled()

    // One more write crosses the threshold
    fc.write(chunk)
    expect(fc.paused).toBe(true)

    fc.dispose()
  })

  it('does not resume until pending drops below low watermark', () => {
    const { writer, transport, writeCallbacks } = createMocks()
    const fc = new FlowController('pty-1', writer, transport)

    const chunk = 'x'.repeat(FLOW_CONTROL_CALLBACK_BYTE_LIMIT)

    // Build up past high watermark
    for (let i = 0; i <= FLOW_CONTROL_HIGH_WATERMARK; i++) {
      fc.write(chunk)
    }
    expect(fc.paused).toBe(true)

    // Fire callbacks down to exactly low watermark — should still be paused
    const target = FLOW_CONTROL_LOW_WATERMARK
    while (fc.pendingCallbacks > target) {
      writeCallbacks.shift()!()
    }
    expect(fc.paused).toBe(true)

    // Fire one more to drop below low watermark
    writeCallbacks.shift()!()
    expect(fc.paused).toBe(false)

    fc.dispose()
  })

  it('does not double-pause on subsequent writes while already paused', () => {
    const { writer, transport } = createMocks()
    const fc = new FlowController('pty-1', writer, transport)

    const chunk = 'x'.repeat(FLOW_CONTROL_CALLBACK_BYTE_LIMIT)

    // Get into paused state
    for (let i = 0; i <= FLOW_CONTROL_HIGH_WATERMARK; i++) {
      fc.write(chunk)
    }
    expect(transport.pause).toHaveBeenCalledTimes(1)

    // More writes while paused
    fc.write(chunk)
    fc.write(chunk)
    expect(transport.pause).toHaveBeenCalledTimes(1) // still just 1

    fc.dispose()
  })

  it('pendingCallbacks never goes below zero', () => {
    const { writer, transport, writeCallbacks } = createMocks()
    const fc = new FlowController('pty-1', writer, transport)

    const chunk = 'x'.repeat(FLOW_CONTROL_CALLBACK_BYTE_LIMIT)
    fc.write(chunk)
    expect(fc.pendingCallbacks).toBe(1)

    // Fire the callback
    writeCallbacks[0]()
    expect(fc.pendingCallbacks).toBe(0)

    // Fire it again (shouldn't happen but testing robustness)
    writeCallbacks[0]()
    expect(fc.pendingCallbacks).toBe(0) // clamped at 0

    fc.dispose()
  })

  it('dispose resumes PTY if currently paused', () => {
    const { writer, transport } = createMocks()
    const fc = new FlowController('pty-1', writer, transport)

    const chunk = 'x'.repeat(FLOW_CONTROL_CALLBACK_BYTE_LIMIT)
    for (let i = 0; i <= FLOW_CONTROL_HIGH_WATERMARK; i++) {
      fc.write(chunk)
    }
    expect(fc.paused).toBe(true)

    fc.dispose()

    expect(transport.resume).toHaveBeenCalledWith('pty-1')
    expect(fc.paused).toBe(false)
  })

  it('dispose is a no-op when not paused', () => {
    const { writer, transport } = createMocks()
    const fc = new FlowController('pty-1', writer, transport)

    fc.write('small data')
    fc.dispose()

    expect(transport.resume).not.toHaveBeenCalled()
  })

  it('handles mixed small and large writes correctly', () => {
    const { writer, transport, writeCallbacks } = createMocks()
    const fc = new FlowController('pty-1', writer, transport)

    // Many small writes (fast path)
    for (let i = 0; i < 50; i++) {
      fc.write('x'.repeat(100))
    }
    expect(fc.pendingCallbacks).toBe(0)

    // Then a large write that crosses threshold
    fc.write('x'.repeat(FLOW_CONTROL_CALLBACK_BYTE_LIMIT))
    expect(fc.pendingCallbacks).toBe(1)

    // Fire callback
    writeCallbacks[0]()
    expect(fc.pendingCallbacks).toBe(0)

    // More small writes
    fc.write('small')
    expect(fc.pendingCallbacks).toBe(0)

    fc.dispose()
  })

  it('correctly routes pause/resume to the right ptyId', () => {
    const { writer: writer1, transport: transport1 } = createMocks()
    const { writer: writer2, transport: transport2 } = createMocks()
    const fc1 = new FlowController('pty-1', writer1, transport1)
    const fc2 = new FlowController('pty-2', writer2, transport2)

    const chunk = 'x'.repeat(FLOW_CONTROL_CALLBACK_BYTE_LIMIT)

    // Pause pty-1
    for (let i = 0; i <= FLOW_CONTROL_HIGH_WATERMARK; i++) {
      fc1.write(chunk)
    }

    expect(transport1.pause).toHaveBeenCalledWith('pty-1')
    expect(transport2.pause).not.toHaveBeenCalled()

    fc1.dispose()
    expect(transport1.resume).toHaveBeenCalledWith('pty-1')
    expect(transport2.resume).not.toHaveBeenCalled()

    fc2.dispose()
  })
})
