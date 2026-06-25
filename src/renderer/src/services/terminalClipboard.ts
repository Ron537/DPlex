import type { Terminal } from '@xterm/xterm'

/**
 * Terminal clipboard behavior, modeled on Windows Terminal / VS Code:
 *
 *  - **Ctrl+C** (Win/Linux) or **⌘C** (macOS) copies the current selection.
 *    When nothing is selected, Ctrl+C is left untouched so it still reaches
 *    the PTY as SIGINT — the classic "interrupt vs. copy" duality.
 *  - **Ctrl+Shift+C / Ctrl+Shift+V** (Win/Linux) are explicit copy/paste that
 *    never clash with SIGINT. On macOS the explicit pair is ⌘C / ⌘V.
 *  - Right-click copies the selection (then clears it so a follow-up
 *    right-click pastes) or pastes when there is no selection.
 *  - Optional copy-on-selection mirrors the selection to the clipboard.
 *
 * Plain Ctrl+V is intentionally NOT bound on Win/Linux: readline binds it to
 * `quoted-insert`, so hijacking it would break literal control-char entry.
 */
export type ClipboardKeyAction = 'copy' | 'paste' | 'none'

/** The subset of a DOM KeyboardEvent the clipboard decision depends on. */
export interface ClipboardKeyEvent {
  type: string
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/**
 * Decide whether a keystroke should copy, paste, or be left alone (`none`).
 * Pure so it can be unit-tested without an xterm instance.
 */
export function clipboardKeyAction(
  e: ClipboardKeyEvent,
  opts: { isMac: boolean; hasSelection: boolean }
): ClipboardKeyAction {
  if (e.type !== 'keydown') return 'none'
  const key = e.key.toLowerCase()

  if (opts.isMac) {
    // ⌘C / ⌘V — must not also carry Ctrl/Alt (those are different chords).
    if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      if (key === 'c') return opts.hasSelection ? 'copy' : 'none'
      if (key === 'v') return 'paste'
    }
    return 'none'
  }

  // Windows / Linux — only pure Ctrl chords (no Meta/Alt).
  if (!e.ctrlKey || e.metaKey || e.altKey) return 'none'

  if (e.shiftKey) {
    // Explicit copy/paste that never collides with SIGINT.
    if (key === 'c') return opts.hasSelection ? 'copy' : 'none'
    if (key === 'v') return 'paste'
    return 'none'
  }

  // Plain Ctrl+C: copy only when a selection exists, otherwise let it fall
  // through to the PTY as SIGINT.
  if (key === 'c') return opts.hasSelection ? 'copy' : 'none'

  return 'none'
}

/**
 * Copy the terminal's current selection to the system clipboard.
 * Returns `true` when something was copied. When `clearAfter` is set the
 * selection is cleared so a subsequent right-click pastes instead of
 * re-copying the same text.
 */
export function copyTerminalSelection(term: Terminal, clearAfter = false): boolean {
  if (!term.hasSelection()) return false
  const selection = term.getSelection()
  if (!selection) return false
  window.dplex.clipboard.writeText(selection)
  if (clearAfter) term.clearSelection()
  return true
}

/**
 * Paste clipboard text into the terminal. Routed through `term.paste` so
 * bracketed-paste mode is honored when the shell/app has enabled it.
 */
export async function pasteIntoTerminal(term: Terminal): Promise<void> {
  try {
    const text = await window.dplex.clipboard.readText()
    if (text) term.paste(text)
  } catch {
    // Clipboard read can reject (permissions/empty) — nothing to paste.
  }
}

// ── AI-pane clipboard helpers (issue #86) ────────────────────────────────
//
// When the foreground app (Copilot CLI, Claude Code) enables mouse tracking,
// xterm forwards drags to the PTY and `term.hasSelection()` is always false —
// so the selection-based copy paths above never fire and copy silently fails.
// For AI panes we instead reconstruct the dragged text straight from the xterm
// buffer. The helpers below are pure so the cell math and copy precedence can
// be unit-tested without an xterm instance.

/** A single buffer cell coordinate (absolute row, including scrollback). */
export interface BufferCell {
  col: number
  row: number
}

/** Cell dimensions in CSS pixels, as exposed by xterm's render service. */
export interface CellDims {
  cellWidth: number
  cellHeight: number
}

/** The subset of a DOMRect the pixel→cell math needs. */
export interface ScreenRect {
  left: number
  top: number
}

/**
 * Map a viewport pixel coordinate to an absolute buffer cell. Pure: takes the
 * screen rect, cell dimensions, grid size, and the current viewport scroll
 * offset rather than reaching into xterm. Returns `null` when cell dimensions
 * aren't available yet (fail closed to native behavior).
 *
 * The column is a **caret boundary** in `[0, cols]` (rounded at the half-cell),
 * matching how xterm resolves selection endpoints: dragging into the right half
 * of a cell includes it, and a selection can extend through the final column.
 * The row is a cell index in `[0, rows - 1]`, offset by `viewportY` so it
 * addresses absolute scrollback rows.
 */
export function cellFromPixel(
  clientX: number,
  clientY: number,
  rect: ScreenRect,
  dims: CellDims,
  cols: number,
  rows: number,
  viewportY: number
): BufferCell | null {
  if (!dims.cellWidth || !dims.cellHeight) return null
  const col = Math.max(0, Math.min(cols, Math.round((clientX - rect.left) / dims.cellWidth)))
  const row = Math.max(0, Math.min(rows - 1, Math.floor((clientY - rect.top) / dims.cellHeight)))
  return { col, row: row + viewportY }
}

/** The subset of an xterm buffer line `readBufferRange` needs. */
export interface BufferLineLike {
  translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string
}

/** The subset of an xterm buffer `readBufferRange` needs. */
export interface BufferLike {
  getLine(row: number): BufferLineLike | undefined
}

/**
 * Read the text spanning two buffer cells, normalizing order so the caller
 * doesn't have to. Multi-row ranges join with `\n`; `translateToString(true)`
 * collapses wide-char placeholder cells and trailing padding within each line.
 */
export function readBufferRange(buffer: BufferLike, start: BufferCell, end: BufferCell): string {
  let s = start
  let e = end
  if (s.row > e.row || (s.row === e.row && s.col > e.col)) {
    const tmp = s
    s = e
    e = tmp
  }
  if (s.row === e.row) {
    return buffer.getLine(s.row)?.translateToString(true, s.col, e.col) ?? ''
  }
  const parts: string[] = []
  parts.push(buffer.getLine(s.row)?.translateToString(true, s.col) ?? '')
  for (let r = s.row + 1; r < e.row; r++) {
    parts.push(buffer.getLine(r)?.translateToString(true) ?? '')
  }
  parts.push(buffer.getLine(e.row)?.translateToString(true, 0, e.col) ?? '')
  return parts.join('\n')
}

/** Number of cells covered by a selection start→end, for `term.select`. */
export function selectionLength(start: BufferCell, end: BufferCell, cols: number): number {
  let s = start
  let e = end
  if (s.row > e.row || (s.row === e.row && s.col > e.col)) {
    const tmp = s
    s = e
    e = tmp
  }
  return (e.row - s.row) * cols + (e.col - s.col)
}

/** Distance from a drag start exceeds the click→drag threshold (px). */
export function isDrag(dx: number, dy: number, threshold = 5): boolean {
  return Math.sqrt(dx * dx + dy * dy) > threshold
}

/**
 * Resolve which text a copy gesture should write, in precedence order:
 * native xterm selection first, then a buffer snapshot captured under mouse
 * mode. Whitespace-only candidates are rejected (returns `null`) so we never
 * claim "copied" for an empty clipboard write. The native selection is
 * returned verbatim (its internal whitespace may be meaningful); only the
 * accept/reject test trims.
 */
export function resolveCopyText(native: string | null, snapshot: string | null): string | null {
  if (native && native.trim()) return native
  const snap = snapshot?.replace(/\s+$/u, '') ?? ''
  if (snap.trim()) return snap
  return null
}

/**
 * Whether a paste should be suppressed because a copy just happened. Guards
 * the right-click path so a confirming second right-click doesn't paste the
 * just-copied text back into the prompt.
 */
export function shouldSuppressPaste(lastCopyAt: number, now: number, guardMs = 600): boolean {
  return lastCopyAt > 0 && now - lastCopyAt < guardMs
}
