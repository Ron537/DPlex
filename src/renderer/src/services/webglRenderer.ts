/**
 * WebGL renderer management for xterm.js terminals.
 *
 * Without a GPU renderer xterm falls back to its DOM renderer, which rebuilds a
 * `<span>` per style-run per row on every frame. AI CLIs (Copilot/Claude)
 * repaint a full-screen TUI many times a second, so the DOM renderer saturates
 * the main thread and freezes the whole app — React, the sidebar, tab switching
 * and all. The WebGL renderer moves that work to the GPU.
 *
 * WebGL contexts are a scarce, browser-wide resource (Chromium keeps roughly a
 * dozen alive and silently kills the oldest beyond that). DPlex is a
 * multiplexer, so a user can easily have more terminals than that. Rather than
 * let the browser evict contexts behind our back — which surfaces as a
 * terminal that suddenly renders through the slow path again — the pool caps
 * the number of live contexts itself and evicts the least-recently-shown
 * terminal. Hidden terminals don't need a GPU context: their render loop is
 * paused (they're `content-visibility: hidden`, which xterm's
 * IntersectionObserver reports as not intersecting, while still preserving the
 * subtree's layout and paint state so showing them again is cheap), and they
 * re-acquire a context when shown.
 */

/** Maximum number of simultaneously attached WebGL contexts. Comfortably below
 *  Chromium's per-process limit while covering any realistic split layout. */
export const MAX_WEBGL_CONTEXTS = 8

/** After this many context losses, a terminal stays on the DOM renderer. Guards
 *  against a loss/reattach loop on flaky drivers. */
export const MAX_CONTEXT_LOSSES = 2

/** After this many failed attachments across all terminals, WebGL is treated as
 *  unavailable for the session. High enough that a transient failure (e.g. the
 *  element detached mid-Space-switch) doesn't permanently downgrade rendering,
 *  low enough that an environment without WebGL2 stops retrying quickly. */
export const MAX_ATTACH_FAILURES = 3

export interface Disposable {
  dispose(): void
}

/** Structural view of `@xterm/addon-webgl`'s `WebglAddon`, so the pool can be
 *  unit-tested without a real WebGL2 context. */
export interface WebglAddonLike extends Disposable {
  onContextLoss(listener: () => void): Disposable
}

interface AttachedContext {
  addon: WebglAddonLike
  lossSubscription: Disposable
}

export class WebglRendererPool<T extends WebglAddonLike = WebglAddonLike> {
  /** Insertion order doubles as LRU recency — re-attaching moves an entry to
   *  the end, and eviction takes from the front. */
  private readonly attached = new Map<string, AttachedContext>()
  /** Per-terminal count of context losses AND failed attachments. Both mean
   *  "this terminal couldn't hold a GPU context", so they share a budget. */
  private readonly failures = new Map<string, number>()
  private attachFailures = 0
  private unavailable = false

  /**
   * @param createAddon Builds a fresh renderer addon.
   * @param maxContexts Cap on simultaneously live contexts.
   * @param isPinned Optional predicate marking terminals that must not be
   *   evicted — normally "currently on screen". Eviction prefers unpinned
   *   terminals and only falls back to pinned ones when the cap can't otherwise
   *   be met (more visible panes than contexts), so a wide split layout never
   *   has a visible pane silently demoted to the DOM renderer while a hidden
   *   background tab keeps its context.
   * @param onContextLost Optional notification that a terminal lost its context
   *   and has fallen back to the DOM renderer, so the caller can re-queue an
   *   attach if that terminal is still on screen. Not called for evictions,
   *   which are deliberate.
   */
  constructor(
    private readonly createAddon: () => T,
    private readonly maxContexts: number = MAX_WEBGL_CONTEXTS,
    private readonly isPinned: (terminalId: string) => boolean = () => false,
    private readonly onContextLost: (terminalId: string) => void = () => {}
  ) {}

  /**
   * Ensure `terminalId` is rendering through WebGL. Safe to call on every
   * activation — it's a no-op when already attached (beyond refreshing LRU
   * recency). Returns whether the terminal ended up on the WebGL renderer.
   */
  attach(terminalId: string, load: (addon: T) => void): boolean {
    if (this.unavailable) return false

    const existing = this.attached.get(terminalId)
    if (existing) {
      this.attached.delete(terminalId)
      this.attached.set(terminalId, existing)
      return true
    }

    if ((this.failures.get(terminalId) ?? 0) >= MAX_CONTEXT_LOSSES) return false

    let addon: T | null = null
    try {
      addon = this.createAddon()
      // Throws in environments without WebGL2 — xterm's DOM renderer stands in.
      load(addon)
    } catch {
      if (addon) {
        try {
          addon.dispose()
        } catch {
          /* addon may already be half-disposed */
        }
      }
      this.recordFailure(terminalId)
      return false
    }

    const boundAddon = addon
    const lossSubscription = boundAddon.onContextLoss(() => {
      this.recordFailure(terminalId, false)
      // A lost context can't be revived — drop the addon so xterm falls back to
      // the DOM renderer, then let the owner decide whether to queue a fresh
      // one (it will, if this terminal is still the tab on screen). The
      // per-terminal loss budget above stops that becoming a retry loop.
      this.release(terminalId)
      this.onContextLost(terminalId)
    })

    this.attached.set(terminalId, { addon: boundAddon, lossSubscription })
    // A successful attach proves WebGL2 works here, so any earlier failures were
    // transient — don't let them accumulate toward writing WebGL off entirely.
    this.attachFailures = 0
    this.evictOverflow(terminalId)
    return this.attached.has(terminalId)
  }

  /** Drop a terminal's WebGL context (it reverts to the DOM renderer). */
  release(terminalId: string): void {
    const ctx = this.attached.get(terminalId)
    if (!ctx) return
    this.attached.delete(terminalId)
    try {
      ctx.lossSubscription.dispose()
    } catch {
      /* isolate teardown errors */
    }
    try {
      ctx.addon.dispose()
    } catch {
      /* isolate teardown errors */
    }
  }

  /** Release and forget all state for a destroyed terminal. */
  forget(terminalId: string): void {
    this.release(terminalId)
    this.failures.delete(terminalId)
  }

  hasContext(terminalId: string): boolean {
    return this.attached.has(terminalId)
  }

  /** True once WebGL has been written off for this session. */
  get isUnavailable(): boolean {
    return this.unavailable
  }

  get size(): number {
    return this.attached.size
  }

  private recordFailure(terminalId: string, countsTowardGlobal = true): void {
    this.failures.set(terminalId, (this.failures.get(terminalId) ?? 0) + 1)
    // Context *losses* are normal (driver resets, GPU pressure) and must not
    // disable WebGL globally; failed *attachments* usually mean no WebGL2.
    if (!countsTowardGlobal) return
    this.attachFailures++
    if (this.attachFailures >= MAX_ATTACH_FAILURES) this.unavailable = true
  }

  private evictOverflow(keep: string): void {
    if (this.attached.size <= this.maxContexts) return
    // Two passes: shed hidden terminals first — their render loop is paused, so
    // losing the context costs them nothing — and only fall back to evicting a
    // visible pane if that wasn't enough to get under the cap.
    this.evictPass(keep, true)
    this.evictPass(keep, false)
  }

  private evictPass(keep: string, skipPinned: boolean): void {
    for (const id of this.attached.keys()) {
      if (this.attached.size <= this.maxContexts) return
      if (id === keep) continue
      if (skipPinned && this.isPinned(id)) continue
      this.release(id)
    }
  }
}
