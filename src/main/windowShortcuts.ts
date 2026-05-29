import type { Input } from 'electron'

/**
 * Subset of `Electron.Input` consumed by {@link shouldBlockShortcut}. Derived
 * with `Pick` so the type tracks Electron's definition automatically.
 */
export type ShortcutInput = Pick<Input, 'type' | 'code' | 'control' | 'meta' | 'shift'>

/**
 * Returns `true` when an input event should be `preventDefault`ed before it
 * reaches the renderer (i.e. before xterm sees it).
 *
 * Replaces `optimizer.watchWindowShortcuts` from `@electron-toolkit/utils`,
 * which preventDefaulted `KeyR + (control || meta)` in packaged builds and
 * broke reverse-i-search inside the terminal. DPlex is a terminal: every key
 * the main process intercepts is a key the PTY can't see, so this policy
 * blocks as little as possible.
 *
 * Only Chromium's zoom shortcuts are blocked — DPlex exposes its own
 * font-size setting and accidental zoom desyncs the terminal grid. DevTools
 * is handled at the Electron level via `webPreferences.devTools` rather than
 * by intercepting keys here.
 */
export function shouldBlockShortcut(input: ShortcutInput): boolean {
  if (input.type !== 'keyDown') return false

  const mod = input.control || input.meta

  if (input.code === 'Minus' && mod) return true
  if (input.code === 'Equal' && input.shift && mod) return true

  return false
}
