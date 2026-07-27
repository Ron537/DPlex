/**
 * Decides *which* terminals deserve a GPU renderer, based on how much output
 * they actually push.
 *
 * Attaching xterm's WebGL renderer is not free: creating the context involves a
 * GPU-process handshake, shader compilation and building a glyph atlas. That
 * work is native, synchronous and unattributable to JS — measured at ~300ms for
 * the first context in a renderer process. Paying it for every terminal on sight
 * makes startup and tab switches janky, which is exactly the symptom the GPU
 * renderer was meant to cure.
 *
 * The DOM renderer's cost, by contrast, scales with how much is actually drawn:
 * a shell sitting at a prompt costs nothing. So only terminals that demonstrate
 * a heavy render load — an AI CLI repainting a full-screen TUI, a big file being
 * cat'd — are promoted to the GPU. Everything else stays on the DOM renderer,
 * where it was already fast.
 *
 * "Busy" latches: once a terminal has proven it can flood, it keeps its claim to
 * a context across hide/show cycles instead of having to re-prove it each time.
 */

/** Bytes within one window that mark a terminal as render-heavy. A full-screen
 *  TUI repaint with SGR sequences is ~10-20KB, so this is a handful of repaints
 *  per second — well above shell prompts and short command output. */
export const BUSY_BYTES_THRESHOLD = 64 * 1024

/**
 * Length of the throughput window.
 *
 * Windows are tumbling, not sliding: the counter resets once a window expires
 * rather than tracking per-chunk timestamps. A burst that straddles a boundary
 * can therefore need a second window to promote. That's deliberate — this runs
 * on the hottest path in the renderer (every PTY chunk of every terminal), and
 * the cost of a false negative is only that a heavy terminal waits up to one
 * extra second for its GPU context. Terminals heavy enough to matter keep
 * producing output, so they promote on the following window regardless.
 */
export const BUSY_WINDOW_MS = 1000

export class RenderLoadTracker {
  private readonly windows = new Map<string, { bytes: number; startedAt: number }>()
  private readonly busy = new Set<string>()

  constructor(private readonly now: () => number = () => performance.now()) {}

  /**
   * Record PTY output for a terminal.
   *
   * @returns `true` only on the transition into "busy", so callers can schedule
   *   the (expensive) GPU attach exactly once instead of on every chunk.
   */
  record(terminalId: string, bytes: number): boolean {
    if (this.busy.has(terminalId)) return false

    const at = this.now()
    const window = this.windows.get(terminalId)
    if (!window || at - window.startedAt >= BUSY_WINDOW_MS) {
      this.windows.set(terminalId, { bytes, startedAt: at })
      // A single chunk can exceed the threshold on its own (a large paste or a
      // burst flushed by flow control), which is just as much a reason to
      // promote as a sustained stream.
      if (bytes < BUSY_BYTES_THRESHOLD) return false
    } else {
      window.bytes += bytes
      if (window.bytes < BUSY_BYTES_THRESHOLD) return false
    }

    this.busy.add(terminalId)
    this.windows.delete(terminalId)
    return true
  }

  /** Whether this terminal has ever proven itself render-heavy. */
  isBusy(terminalId: string): boolean {
    return this.busy.has(terminalId)
  }

  /** Promote a terminal without waiting for it to hit the threshold. Used for
   *  panes we know will be heavy (an AI CLI) the moment they're shown. */
  markBusy(terminalId: string): void {
    this.busy.add(terminalId)
    this.windows.delete(terminalId)
  }

  /** Drop all state for a destroyed terminal. */
  forget(terminalId: string): void {
    this.busy.delete(terminalId)
    this.windows.delete(terminalId)
  }
}
