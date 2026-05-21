/**
 * Coalesces rapid data chunks and flushes them in a single callback per
 * frame (~16ms) or when the buffer exceeds a size threshold.
 *
 * Modelled after Hyper's DataBatcher — reduces IPC message count by
 * 10-100x during heavy output bursts.
 */

export const BATCH_DURATION_MS = 16 // ~1 frame at 60fps
export const BATCH_MAX_SIZE = 200 * 1024 // 200KB

export class DataBatcher {
  private buffer = ''
  private timeout: ReturnType<typeof setTimeout> | null = null
  private readonly onFlush: (data: string) => void

  constructor(onFlush: (data: string) => void) {
    this.onFlush = onFlush
  }

  write(chunk: string): void {
    this.buffer += chunk
    if (this.buffer.length >= BATCH_MAX_SIZE) {
      // Size threshold exceeded — flush immediately
      if (this.timeout) {
        clearTimeout(this.timeout)
        this.timeout = null
      }
      this.flush()
      return
    }
    if (!this.timeout) {
      this.timeout = setTimeout(() => this.flush(), BATCH_DURATION_MS)
    }
  }

  flush(): void {
    this.timeout = null
    if (this.buffer.length === 0) return
    const data = this.buffer
    this.buffer = ''
    this.onFlush(data)
  }

  dispose(): void {
    if (this.timeout) {
      clearTimeout(this.timeout)
      this.timeout = null
    }
    // Flush any remaining buffered data before disposing
    if (this.buffer.length > 0) {
      const data = this.buffer
      this.buffer = ''
      this.onFlush(data)
    }
  }
}
