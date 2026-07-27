/**
 * Decides *when* a terminal that has earned a GPU renderer actually gets one.
 *
 * Creating a WebGL context is a few hundred milliseconds of synchronous native
 * work — GPU-process handshake, shader compilation, glyph atlas. Left
 * unmanaged, that cost lands at the worst possible moments:
 *
 *  - inline during startup or the frame after a tab switch, dropping frames;
 *  - on every terminal a user flicks past while switching tabs;
 *  - on several sessions at once (a window full of resuming AI CLIs all cross
 *    the busy threshold together), stacking into a single long freeze.
 *
 * So attaches are deferred to idle time, re-checked against `canAttach` when
 * they finally run (the caller folds "still alive and still on screen" into
 * that), and spaced apart from one another.
 */

/** Longest we'll wait for an idle slot before attaching anyway. Long enough to
 *  clear a startup burst or a tab switch, short enough that a terminal that
 *  starts hot on a permanently busy main thread still gets the GPU promptly. */
export const WEBGL_ATTACH_IDLE_TIMEOUT_MS = 2000

/** Minimum spacing between two context creations, so simultaneous promotions
 *  are felt as separate blips rather than one stall. */
export const WEBGL_ATTACH_MIN_GAP_MS = 500

interface WebglAttachSchedulerOptions {
  /** Perform the attach. */
  attach: (terminalId: string) => void
  /**
   * Whether an attach is still worth doing — terminal alive, on screen, no
   * context yet. Checked when queueing *and* again when the deferred callback
   * runs, since anything can change while it waits for an idle slot.
   */
  canAttach: (terminalId: string) => boolean
  now?: () => number
}

export class WebglAttachScheduler {
  /** Cancellers for attaches waiting on an idle slot, keyed by terminal. */
  private readonly pending = new Map<string, () => void>()
  private lastAttachAt = -Infinity

  private readonly attach: (terminalId: string) => void
  private readonly canAttach: (terminalId: string) => boolean
  private readonly now: () => number

  constructor(options: WebglAttachSchedulerOptions) {
    this.attach = options.attach
    this.canAttach = options.canAttach
    this.now = options.now ?? ((): number => performance.now())
  }

  /** Queue an attach for the next idle slot. Idempotent. */
  schedule(terminalId: string): void {
    if (this.pending.has(terminalId)) return
    if (!this.canAttach(terminalId)) return
    this.pending.set(
      terminalId,
      this.whenIdle(() => this.run(terminalId))
    )
  }

  /**
   * Drop a queued attach.
   *
   * Called when a tab is hidden or destroyed, so flicking through busy sessions
   * doesn't queue a context creation for every one passed through. An
   * already-attached renderer is deliberately untouched — rebuilding it on the
   * next switch is the very cost being avoided.
   */
  cancel(terminalId: string): void {
    const cancel = this.pending.get(terminalId)
    if (!cancel) return
    this.pending.delete(terminalId)
    cancel()
  }

  /** Whether an attach is queued for this terminal. */
  isPending(terminalId: string): boolean {
    return this.pending.has(terminalId)
  }

  private run(terminalId: string): void {
    this.pending.delete(terminalId)
    if (!this.canAttach(terminalId)) return

    const sinceLast = this.now() - this.lastAttachAt
    if (sinceLast < WEBGL_ATTACH_MIN_GAP_MS) {
      const handle = setTimeout(() => this.run(terminalId), WEBGL_ATTACH_MIN_GAP_MS - sinceLast)
      this.pending.set(terminalId, () => clearTimeout(handle))
      return
    }

    this.lastAttachAt = this.now()
    this.attach(terminalId)
  }

  private whenIdle(run: () => void): () => void {
    if (typeof requestIdleCallback === 'function') {
      const handle = requestIdleCallback(run, { timeout: WEBGL_ATTACH_IDLE_TIMEOUT_MS })
      return () => cancelIdleCallback(handle)
    }
    const handle = setTimeout(run, 0)
    return () => clearTimeout(handle)
  }
}
