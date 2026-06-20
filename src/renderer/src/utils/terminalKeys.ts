/**
 * Word-wise navigation for terminals on macOS. When ⌥ Option is left to the
 * OS so it can compose characters (macOptionIsMeta off) rather than acting as
 * the Meta key, ⌥+Arrow / ⌥+Backspace / ⌥+Delete would emit CSI sequences the
 * shell ignores. This maps them to the readline escape sequences bash/zsh
 * bind to word motions — the same translation iTerm2's "Natural Text Editing"
 * applies.
 */

/** The subset of a DOM KeyboardEvent this translation depends on. */
export interface WordMotionKeyEvent {
  type: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  key: string
}

/**
 * Returns the escape sequence an ⌥+Arrow / ⌥+Backspace / ⌥+Delete keystroke
 * should send to the PTY, or `null` when the event is not one of those
 * keystrokes and should be handled by xterm normally.
 *
 * Shifted combinations are excluded so Shift+⌥+Arrow falls through to xterm
 * untouched rather than being collapsed into a plain word motion.
 */
export function wordMotionSequence(e: WordMotionKeyEvent): string | null {
  if (e.type !== 'keydown' || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) {
    return null
  }
  switch (e.key) {
    case 'ArrowLeft':
      return '\x1bb' // ESC b — backward-word
    case 'ArrowRight':
      return '\x1bf' // ESC f — forward-word
    case 'Backspace':
      return '\x1b\x7f' // ESC DEL — backward-kill-word
    case 'Delete':
      return '\x1bd' // ESC d — kill-word forward
    default:
      return null
  }
}

/**
 * The bytes a Shift+Enter keystroke should send to the PTY when the foreground
 * application has enabled xterm's modifyOtherKeys mode (CSI > 4 ; 2 m) — as the
 * Copilot and Claude CLIs do. It is the modifyOtherKeys encoding of Enter
 * (key 13) with the Shift modifier (2): CSI 27 ; 2 ; 13 ~. Those TUIs treat it
 * as "insert a newline" rather than "submit", matching how Shift+Enter behaves
 * under a fully compliant terminal. xterm.js does not implement modifyOtherKeys
 * itself, so without this it sends a bare CR and the prompt is submitted.
 */
export const SHIFT_ENTER_SEQUENCE = '\x1b[27;2;13~'

/**
 * Returns {@link SHIFT_ENTER_SEQUENCE} for a Shift+Enter keydown when
 * modifyOtherKeys is active, or `null` otherwise.
 *
 * The mode gate matters: a terminal that never enabled modifyOtherKeys (a plain
 * shell, for instance) does not expect this sequence, and readline would leak it
 * into the line as literal text. Returning `null` lets xterm handle the key
 * normally — a bare CR that submits — preserving existing behaviour there.
 */
export function shiftEnterSequence(
  e: WordMotionKeyEvent,
  modifyOtherKeysActive: boolean
): string | null {
  if (!modifyOtherKeysActive) return null
  if (e.type !== 'keydown' || !e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return null
  if (e.key !== 'Enter') return null
  return SHIFT_ENTER_SEQUENCE
}

/**
 * Interprets the parameters of a `CSI > Pp ; Pv m` (XTMODKEYS set/reset)
 * sequence, returning the resulting modifyOtherKeys state, or `null` when the
 * sequence targets an unrelated key-modifier resource and the current state
 * should be left unchanged.
 *
 * - resource 4 (modifyOtherKeys): enabled when its mode is ≥ 1, else disabled.
 * - resource 0: the reset-all form `CSI > m` (which xterm represents as `[0]`)
 *   resets every key-modifier resource — including modifyOtherKeys — to its
 *   initial, disabled state. `CSI > 0 m` (modifyKeyboard) collapses to the same
 *   `[0]` shape; treating it as disabled is the safe direction (Shift+Enter
 *   falls back to a bare CR rather than leaking the sequence).
 * - resources 1/2 (cursor/function keys): unrelated, state unchanged.
 */
export function modifyOtherKeysActive(params: (number | number[])[]): boolean | null {
  const first = params[0]
  const resource = Array.isArray(first) ? first[0] : first
  if (resource === 0) return false
  if (resource !== 4) return null
  const second = params.length > 1 ? params[1] : 0
  const mode = Array.isArray(second) ? second[0] : second
  return (mode ?? 0) >= 1
}
