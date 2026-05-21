/**
 * Flow control for xterm.js write operations.
 *
 * Implements watermark-based backpressure per the xterm.js official flow
 * control guide. Places write callbacks periodically to track parse
 * progress and pauses/resumes the PTY when pending callbacks cross
 * high/low watermarks.
 */

export const FLOW_CONTROL_HIGH_WATERMARK = 5 // pending callbacks before pause
export const FLOW_CONTROL_LOW_WATERMARK = 2 // pending callbacks before resume
export const FLOW_CONTROL_CALLBACK_BYTE_LIMIT = 100_000 // bytes between callbacks

export interface FlowControlWriter {
  write(data: string, callback?: () => void): void
}

export interface FlowControlTransport {
  pause(ptyId: string): void
  resume(ptyId: string): void
}

export class FlowController {
  pendingCallbacks = 0
  bytesWritten = 0
  paused = false

  constructor(
    private readonly ptyId: string,
    private readonly writer: FlowControlWriter,
    private readonly transport: FlowControlTransport
  ) {}

  write(data: string): void {
    this.bytesWritten += data.length

    if (this.bytesWritten >= FLOW_CONTROL_CALLBACK_BYTE_LIMIT) {
      this.pendingCallbacks++
      this.bytesWritten = 0

      this.writer.write(data, () => {
        this.pendingCallbacks = Math.max(this.pendingCallbacks - 1, 0)
        if (this.paused && this.pendingCallbacks < FLOW_CONTROL_LOW_WATERMARK) {
          this.paused = false
          this.transport.resume(this.ptyId)
        }
      })

      if (!this.paused && this.pendingCallbacks > FLOW_CONTROL_HIGH_WATERMARK) {
        this.paused = true
        this.transport.pause(this.ptyId)
      }
    } else {
      // Fast path: no callback overhead
      this.writer.write(data)
    }
  }

  dispose(): void {
    if (this.paused) {
      this.transport.resume(this.ptyId)
      this.paused = false
    }
  }
}
