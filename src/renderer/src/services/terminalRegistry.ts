import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { getTheme } from './themes'
import { MAX_WEBGL_CONTEXTS, WebglRendererPool } from './webglRenderer'
import { RenderLoadTracker } from './terminalRenderLoad'
import { WebglAttachScheduler } from './webglAttachScheduler'
import { FlowController } from './flowControl'
import { isMac } from '../utils/shortcuts'
import {
  wordMotionSequence,
  shiftEnterSequence,
  modifyOtherKeysActive
} from '../utils/terminalKeys'
import {
  clipboardKeyAction,
  copyTerminalSelection,
  parseOsc52,
  pasteIntoTerminal
} from './terminalClipboard'
import { useSettingsStore } from '../stores/settingsStore'
import { TruecolorSgrNormalizer } from './truecolorSgrNormalizer'

export interface TerminalEntry {
  term: Terminal
  fitAddon: FitAddon
  ptyId: string | null
  wrapperEl: HTMLDivElement
  truecolorNormalizer: TruecolorSgrNormalizer
  ready: boolean
  creating: boolean
  cleanupIpc: (() => void) | null
  /** Disposes the per-terminal clipboard wiring (key/selection/contextmenu). */
  disposeExtras: (() => void) | null
}

// Global registry — lives outside React lifecycle
const registry = new Map<string, TerminalEntry>()

/**
 * Whether a terminal currently has a layout box. Guards against measuring an
 * entry that is mid-teardown or not yet in the document.
 *
 * Note this is deliberately *not* a visibility check: hidden tabs use
 * `content-visibility: hidden` (see EditorGroup), which keeps their layout box
 * and resolved dimensions intact. Visibility is tracked explicitly by
 * TerminalView instead.
 */
function isTerminalRendered(entry: TerminalEntry): boolean {
  return entry.wrapperEl.isConnected && entry.wrapperEl.getClientRects().length > 0
}

/**
 * Fit a terminal to its container, but only while it's on screen with a box.
 *
 * The box check is not an optimization — it's required for correctness. FitAddon
 * sizes the terminal from `getComputedStyle(parent)`, and for an element with
 * no box Chromium returns the *computed* value rather than the used one: our
 * wrapper's `height: 100%` comes back as the string `"100%"`, which parses to
 * the number 100. Fitting then resizes the terminal to roughly 10×5 cells and
 * forwards that to the PTY, wrecking the layout of the AI CLI running inside.
 *
 * Hidden tabs are skipped too. They still have a box, so they'd otherwise be
 * refitted on every pane, window and sidebar resize — and each fit queues a
 * resize xterm can only flush as a full re-render of a 10k-line scrollback the
 * moment that tab is shown. TerminalView refits on show instead.
 */
function fitIfVisible(terminalId: string, entry: TerminalEntry): void {
  if (!visibleTerminals.has(terminalId) || !isTerminalRendered(entry)) return
  try {
    entry.fitAddon.fit()
  } catch {
    // ignore
  }
}

/**
 * Tabs currently shown by their group, as reported by TerminalView.
 *
 * Tracked explicitly rather than sniffed from the DOM: hidden tabs use
 * `content-visibility: hidden`, which pauses their rendering but *keeps* their
 * layout box, so geometry can't tell a hidden tab from a shown one.
 */
const visibleTerminals = new Set<string>()

// GPU rendering. Attached lazily (on first display) rather than at creation, so
// restoring a workspace with dozens of tabs doesn't allocate dozens of WebGL
// contexts up front — see webglRenderer.ts for the LRU/eviction rationale.
// On-screen terminals are pinned so a background tab can never steal the
// context out from under a visible split pane.
const webglPool = new WebglRendererPool(
  () => new WebglAddon(),
  MAX_WEBGL_CONTEXTS,
  (terminalId) => visibleTerminals.has(terminalId),
  // A context lost mid-session (GPU reset, driver update) drops the terminal
  // back to the DOM renderer. If it's still the tab on screen, queue a fresh
  // one instead of waiting for the user to switch away and back. The pool's
  // per-terminal loss budget stops this from becoming a retry loop.
  (terminalId) => webglAttach.schedule(terminalId)
)

// Only terminals that actually push a lot of output get a GPU context — see
// terminalRenderLoad.ts for why handing one to every terminal is a net loss.
const renderLoad = new RenderLoadTracker()

/**
 * Defers and rate-limits GPU-context creation — see webglAttachScheduler.ts for
 * why an unmanaged attach is felt as a freeze.
 */
const webglAttach = new WebglAttachScheduler({
  canAttach: (terminalId) => {
    if (webglPool.isUnavailable || webglPool.hasContext(terminalId)) return false
    if (!visibleTerminals.has(terminalId)) return false
    const entry = registry.get(terminalId)
    return Boolean(entry && isTerminalRendered(entry))
  },
  attach: (terminalId) => {
    const entry = registry.get(terminalId)
    if (!entry) return
    webglPool.attach(terminalId, (addon) => entry.term.loadAddon(addon))
  }
})

/**
 * Tell the registry whether a terminal is the tab currently on screen.
 *
 * Only visible terminals may claim a GPU context: several sessions resuming at
 * once all flood output and all earn one, but the user is looking at exactly
 * one of them. Hidden terminals are also skipped when fitting, since xterm has
 * paused them and TerminalView refits on show anyway.
 */
export function setTerminalVisible(terminalId: string, visible: boolean): void {
  if (visible) {
    visibleTerminals.add(terminalId)
    return
  }
  visibleTerminals.delete(terminalId)
  webglAttach.cancel(terminalId)
}

/**
 * Move a terminal onto the WebGL renderer if it has earned one. Call when it
 * becomes visible; it is cheap and idempotent. Terminals that have never pushed
 * a heavy render load stay on xterm's DOM renderer, which is already smooth for
 * them and costs nothing to set up.
 */
export function enableWebglRenderer(terminalId: string): void {
  if (!renderLoad.isBusy(terminalId)) return
  webglAttach.schedule(terminalId)
}

/**
 * Account for PTY output that reached a terminal outside the central dispatcher
 * — currently the early-buffer flush in `useTerminal`, which replays bytes that
 * arrived before `pty.create()` resolved. An AI CLI's first full-screen paint
 * often lands there, and it's exactly the kind of load that should promote a
 * terminal to the GPU renderer.
 */
export function recordTerminalRenderLoad(terminalId: string, bytes: number): void {
  if (renderLoad.record(terminalId, bytes)) webglAttach.schedule(terminalId)
}

// ── Centralized PTY Data Dispatcher ─────────────────────────────────────
// Single global IPC listener routes data to the correct terminal via O(1)
// Map lookup instead of O(N) broadcast across all terminal listeners.
// Flow control is handled by FlowController per terminal.

interface PtyDataHandler {
  terminalId: string
  entry: TerminalEntry
  flowController: FlowController
}

const dataHandlers = new Map<string, PtyDataHandler>()
const exitHandlers = new Map<string, (exitCode: number) => void>()

// ── Terminal readiness subscriptions ────────────────────────────────────
// A terminal becomes "ready" once its PTY first produces output (or on a
// start failure, so the UI stops showing "Starting…"). Readiness is a
// persistent, latched flag on the entry — but a hook can mount AFTER the PTY
// was created (a Space switch remounts the tab mid-startup), so it can't rely
// on catching the one-shot flip via a bound callback. Subscribers are keyed by
// terminalId (stable across remounts); a late subscriber checks entry.ready
// itself. Replacing the old single onReady callback fixes a "Starting terminal…
// forever" hang when the original mount unmounted before the first byte.
const readySubscribers = new Map<string, Set<() => void>>()

/** Subscribe to a terminal's ready event. Returns an unsubscribe fn. The
 *  callback may fire more than once (idempotent by design). */
export function subscribeTerminalReady(terminalId: string, cb: () => void): () => void {
  let subs = readySubscribers.get(terminalId)
  if (!subs) {
    subs = new Set()
    readySubscribers.set(terminalId, subs)
  }
  subs.add(cb)
  return () => {
    const s = readySubscribers.get(terminalId)
    if (!s) return
    s.delete(cb)
    if (s.size === 0) readySubscribers.delete(terminalId)
  }
}

function notifyTerminalReady(terminalId: string): void {
  const subs = readySubscribers.get(terminalId)
  if (!subs) return
  for (const cb of subs) {
    try {
      cb()
    } catch {
      /* isolate subscriber errors */
    }
  }
}

/** Latch a terminal ready and notify any mounted hooks. Idempotent. Used by the
 *  early-buffer flush and start-failure paths, where readiness is decided in
 *  the hook rather than by the global data dispatcher. */
export function markTerminalReady(terminalId: string): void {
  const entry = registry.get(terminalId)
  if (entry) entry.ready = true
  notifyTerminalReady(terminalId)
}

let globalDataListenerCleanup: (() => void) | null = null

function ensureGlobalListeners(): void {
  if (globalDataListenerCleanup) return

  globalDataListenerCleanup = window.dplex.pty.onData((ptyId, data) => {
    const handler = dataHandlers.get(ptyId)
    if (!handler) return

    handler.flowController.write(handler.entry.truecolorNormalizer.write(data))

    // A terminal that starts flooding output is one the DOM renderer can't keep
    // up with — promote it to the GPU renderer (during idle, off this frame).
    if (renderLoad.record(handler.terminalId, data.length)) {
      webglAttach.schedule(handler.terminalId)
    }

    if (!handler.entry.ready) {
      handler.entry.ready = true
      notifyTerminalReady(handler.terminalId)
    }
  })

  window.dplex.pty.onExit((ptyId, exitCode) => {
    const handler = exitHandlers.get(ptyId)
    if (handler) handler(exitCode)
  })
}

/** Register a terminal to receive PTY data via the centralized dispatcher. */
export function registerPtyDataHandler(
  ptyId: string,
  terminalId: string,
  entry: TerminalEntry,
  onExit: (exitCode: number) => void
): () => void {
  ensureGlobalListeners()

  const transport = {
    pause: (id: string) => window.dplex.pty.pause(id),
    resume: (id: string) => window.dplex.pty.resume(id)
  }

  const flowController = new FlowController(ptyId, entry.term, transport)

  dataHandlers.set(ptyId, {
    terminalId,
    entry,
    flowController
  })

  exitHandlers.set(ptyId, onExit)

  return () => {
    flowController.dispose()
    dataHandlers.delete(ptyId)
    exitHandlers.delete(ptyId)
  }
}

export function getOrCreateTerminal(
  terminalId: string,
  fontSize: number,
  fontFamily: string,
  macOptionIsMeta: boolean,
  themeId?: string,
  isAiPane = false
): TerminalEntry {
  const existing = registry.get(terminalId)
  if (existing) return existing

  const appTheme = getTheme(themeId || 'dplex')

  const term = new Terminal({
    fontFamily,
    fontSize,
    theme: appTheme.terminal,
    cursorBlink: true,
    cursorStyle: 'block',
    allowProposedApi: true,
    macOptionIsMeta,
    // Don't let xterm reselect the word under the cursor on right-click
    // (its default on macOS). We drive right-click copy/paste ourselves, and
    // reselecting would replace the user's selection before our contextmenu
    // handler runs — so right-click only copied when clicked on the selection.
    rightClickSelectsWord: false,
    scrollback: 10000
  })

  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.loadAddon(new WebLinksAddon())

  // Track whether the foreground app has enabled xterm's modifyOtherKeys mode
  // (CSI > 4 ; n m). Copilot/Claude CLIs enable it; plain shells do not. We use
  // it to gate Shift+Enter translation so the encoded sequence only reaches
  // apps that understand it. xterm.js does not implement modifyOtherKeys, so we
  // observe the request and leave the rest of its handling untouched (the
  // handler returns false so xterm keeps processing the sequence normally).
  let modifyOtherKeys = false
  const modifyOtherKeysDisposable = term.parser.registerCsiHandler(
    { prefix: '>', final: 'm' },
    (params) => {
      const active = modifyOtherKeysActive(params)
      if (active !== null) modifyOtherKeys = active
      return false
    }
  )

  // OSC 52 clipboard writes. AI CLIs (Copilot/Claude) enable mouse tracking and
  // do their own drag-selection; when the user copies, they ask the terminal to
  // set the host clipboard via OSC 52 (`ESC ] 52 ; c ; <base64> BEL`). xterm has
  // no built-in OSC 52 handler, so without this the sequence is parsed and
  // silently dropped — the app prints "copied" but nothing reaches the system
  // clipboard (issue #86). We honor writes and ignore read requests (Pd = `?`)
  // so a program can't exfiltrate the clipboard.
  const osc52Disposable = term.parser.registerOscHandler(52, (data) => {
    const text = parseOsc52(data)
    if (text !== null) window.dplex.clipboard.writeText(text)
    return true
  })

  // Copy/paste + (macOS) word-motion + Shift+Enter key handling. xterm allows a
  // single custom key handler, so these concerns share one. Returning false
  // stops xterm from forwarding the key to the PTY.
  term.attachCustomKeyEventHandler((e) => {
    const action = clipboardKeyAction(e, {
      isMac,
      hasSelection: term.hasSelection(),
      isAiPane
    })
    if (action === 'copy') {
      e.preventDefault()
      copyTerminalSelection(term)
      return false
    }
    if (action === 'paste') {
      e.preventDefault()
      void pasteIntoTerminal(term)
      return false
    }
    // Shift+Enter: when the foreground app enabled modifyOtherKeys (Copilot/
    // Claude CLIs), send the modifyOtherKeys encoding so the prompt inserts a
    // newline instead of submitting. xterm would otherwise send a bare CR.
    const shiftEnter = shiftEnterSequence(e, modifyOtherKeys)
    if (shiftEnter !== null) {
      e.preventDefault()
      term.input(shiftEnter)
      return false
    }
    // macOS-only: when ⌥ Option is left to compose characters
    // (macOptionIsMeta off), restore word-wise navigation by translating
    // ⌥+Arrow / ⌥+Backspace to readline escape sequences. The Option-as-Meta
    // conflict does not exist on Windows/Linux, where non-US layouts compose
    // symbols via AltGr.
    if (isMac && !term.options.macOptionIsMeta) {
      const seq = wordMotionSequence(e)
      if (seq !== null) {
        e.preventDefault()
        term.input(seq)
        return false
      }
    }
    return true
  })

  // Right-click. In AI panes the CLI (Copilot/Claude) enables mouse tracking and
  // owns the right-click itself — it copies the selection (via OSC 52, handled
  // above) and pastes from its own buffer. If DPlex also pasted here the text
  // would be inserted twice (#86), so we suppress the OS menu and let the
  // forwarded right-click reach the app. Plain shells have no mouse tracking, so
  // DPlex provides right-click copy/paste (Windows Terminal convention): copy the
  // selection (clearing it so a follow-up right-click pastes), else paste.
  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault()
    if (isAiPane) return
    if (!copyTerminalSelection(term, true)) {
      void pasteIntoTerminal(term)
    }
  }

  // Optional copy-on-selection. xterm's onSelectionChange fires repeatedly
  // while a drag grows the selection, so we debounce: copy once the selection
  // settles. No long-lived text dedup — re-selecting the same text always
  // re-asserts it onto the clipboard (the clipboard may have changed in
  // another app since).
  let selectionCopyTimer: ReturnType<typeof setTimeout> | null = null
  const selectionDisposable = term.onSelectionChange(() => {
    if (!useSettingsStore.getState().settings.copyOnSelection) return
    if (selectionCopyTimer) clearTimeout(selectionCopyTimer)
    selectionCopyTimer = setTimeout(() => {
      selectionCopyTimer = null
      if (term.hasSelection()) copyTerminalSelection(term)
    }, 120)
  })

  // Create a persistent wrapper element for the xterm DOM
  const wrapperEl = document.createElement('div')
  wrapperEl.style.width = '100%'
  wrapperEl.style.height = '100%'
  wrapperEl.style.backgroundColor = appTheme.terminal.background || '#000'
  wrapperEl.addEventListener('contextmenu', onContextMenu)

  term.open(wrapperEl)

  const entry: TerminalEntry = {
    term,
    fitAddon,
    ptyId: null,
    wrapperEl,
    truecolorNormalizer: new TruecolorSgrNormalizer(),
    ready: false,
    creating: false,
    cleanupIpc: null,
    disposeExtras: () => {
      if (selectionCopyTimer) clearTimeout(selectionCopyTimer)
      selectionDisposable.dispose()
      modifyOtherKeysDisposable.dispose()
      osc52Disposable.dispose()
      wrapperEl.removeEventListener('contextmenu', onContextMenu)
    }
  }

  registry.set(terminalId, entry)
  return entry
}

export function getTerminalEntry(terminalId: string): TerminalEntry | undefined {
  return registry.get(terminalId)
}

// ── Pending exit handlers ───────────────────────────────────────────────
// Callers (e.g. worktree setup-script flow) may want to react to a
// terminal's PTY exit without waiting for useTerminal to mount and resolve
// the ptyId. Registering here is unconditional: the handler fires on the
// first of (a) PTY exit reported by useTerminal, or (b) destroyTerminal()
// for cases where the tab never mounted. After firing, it's cleared.

type PendingExitHandler = (exitCode: number) => void
const pendingExitHandlers = new Map<string, PendingExitHandler>()

export function registerExitHandler(terminalId: string, handler: PendingExitHandler): () => void {
  pendingExitHandlers.set(terminalId, handler)
  return () => {
    if (pendingExitHandlers.get(terminalId) === handler) {
      pendingExitHandlers.delete(terminalId)
    }
  }
}

/** Invoke and clear any pending exit handler for a terminal. Idempotent. */
export function fireExitHandler(terminalId: string, exitCode: number): void {
  const handler = pendingExitHandlers.get(terminalId)
  if (!handler) return
  pendingExitHandlers.delete(terminalId)
  try {
    handler(exitCode)
  } catch {
    /* isolate handler errors */
  }
}

/** Discard a pending exit handler WITHOUT firing it. Used for deliberate
 *  teardown (e.g. a Space is deleted) where a setup script's afterCreate action
 *  must NOT run — otherwise destroying the still-running setup PTY would fire
 *  its exit handler and spawn a session/terminal into a Space that no longer
 *  exists (or re-focus the doomed Space mid-delete). Idempotent.
 *
 *  Note: this cancels only the deferred *afterCreate* work. Resource cleanup
 *  registered via registerDestroyCleanup still runs on destroy, so e.g. a setup
 *  script's temp file is never leaked even when the handler is cancelled. */
export function cancelExitHandler(terminalId: string): void {
  pendingExitHandlers.delete(terminalId)
}

// ── Destroy cleanups ────────────────────────────────────────────────────
// Unlike an exit handler (which fires on PTY exit and is cancellable for
// deliberate teardown), a destroy cleanup ALWAYS runs when the terminal is
// destroyed — even if the exit handler was cancelled. It's for releasing OS
// resources (e.g. a setup script's temp file) that must not leak on any path,
// including Windows where $TMPDIR is not auto-reaped. Cleared after firing.
const destroyCleanups = new Map<string, () => void>()

export function registerDestroyCleanup(terminalId: string, cleanup: () => void): () => void {
  destroyCleanups.set(terminalId, cleanup)
  return () => {
    if (destroyCleanups.get(terminalId) === cleanup) {
      destroyCleanups.delete(terminalId)
    }
  }
}

function fireDestroyCleanup(terminalId: string): void {
  const cleanup = destroyCleanups.get(terminalId)
  if (!cleanup) return
  destroyCleanups.delete(terminalId)
  try {
    cleanup()
  } catch {
    /* isolate cleanup errors */
  }
}

export function destroyTerminal(terminalId: string): void {
  const entry = registry.get(terminalId)
  if (!entry) {
    // Even if the entry never got registered, run cleanup + fire any pending
    // handler so callers waiting on an exit result get unblocked and no temp
    // resources leak.
    fireDestroyCleanup(terminalId)
    fireExitHandler(terminalId, -1)
    return
  }

  if (entry.cleanupIpc) entry.cleanupIpc()
  if (entry.disposeExtras) entry.disposeExtras()
  if (entry.ptyId) window.dplex.pty.destroy(entry.ptyId)
  // Free the GPU context before disposing the terminal, so it's returned to the
  // pool for another tab rather than leaked until the browser reclaims it.
  webglAttach.cancel(terminalId)
  visibleTerminals.delete(terminalId)
  webglPool.forget(terminalId)
  renderLoad.forget(terminalId)
  entry.term.dispose()
  entry.wrapperEl.remove()
  registry.delete(terminalId)
  readySubscribers.delete(terminalId)
  // Always release OS resources (temp files etc.) tied to this terminal, even
  // when the exit handler was cancelled for a deliberate teardown.
  fireDestroyCleanup(terminalId)
  // If useTerminal hadn't yet wired pty:exit (fast destroy before PTY
  // resolved), still fire pending handlers so tmp files get cleaned up.
  fireExitHandler(terminalId, -1)
}

export function isTerminalRegistered(terminalId: string): boolean {
  return registry.has(terminalId)
}

export function fitTerminal(terminalId: string): void {
  const entry = registry.get(terminalId)
  if (!entry) return
  fitIfVisible(terminalId, entry)
}

export function updateTerminalFont(terminalId: string, fontSize: number, fontFamily: string): void {
  const entry = registry.get(terminalId)
  if (!entry) return
  entry.term.options.fontSize = fontSize
  entry.term.options.fontFamily = fontFamily
  fitIfVisible(terminalId, entry)
}

export function updateTerminalMacOptionIsMeta(terminalId: string, macOptionIsMeta: boolean): void {
  const entry = registry.get(terminalId)
  if (!entry) return
  entry.term.options.macOptionIsMeta = macOptionIsMeta
}

function applyThemeToAll(themeId: string): void {
  const appTheme = getTheme(themeId)
  for (const [, entry] of registry) {
    entry.term.options.theme = appTheme.terminal
    entry.wrapperEl.style.backgroundColor = appTheme.terminal.background || '#000'
  }
}

// Keep every registered terminal's palette in sync with the app theme from a
// single subscription. Each mounted terminal used to run its own effect calling
// applyThemeToAll, which iterates the whole registry — O(N²) work per theme
// change in a many-tab workspace. Living here also covers terminals whose hook
// isn't mounted (tabs parked in a background Space).
useSettingsStore.subscribe((state, prev) => {
  if (state.settings.theme !== prev.settings.theme) {
    applyThemeToAll(state.settings.theme)
  }
})
