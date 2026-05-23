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
