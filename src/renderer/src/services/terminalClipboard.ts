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
 * Parse an OSC 52 clipboard-write payload into decoded UTF-8 text.
 *
 * OSC 52 (`ESC ] 52 ; Pc ; Pd BEL`) is how a program running inside the PTY
 * asks the terminal to set the host clipboard. The value passed here is the
 * part after `52;`, i.e. `<Pc>;<Pd>`, where `Pc` selects the target
 * (`c`=clipboard, `p`=primary, …) and `Pd` is base64-encoded text — or `?`
 * for a clipboard *read* request.
 *
 * Returns the decoded text for a write, or `null` for a read / malformed /
 * empty payload. Read requests are ignored on purpose so a program can't
 * exfiltrate the user's clipboard.
 */
export function parseOsc52(data: string): string | null {
  const sep = data.indexOf(';')
  if (sep === -1) return null
  const payload = data.slice(sep + 1)
  if (!payload || payload === '?') return null
  try {
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    // Malformed base64 — nothing safe to copy.
    return null
  }
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
