import type { Input } from 'electron'

/**
 * Subset of `Electron.Input` consumed by {@link shouldBlockShortcut}. Derived
 * with `Pick` so the type tracks Electron's definition automatically.
 */
export type ShortcutInput = Pick<Input, 'type' | 'code' | 'control' | 'meta' | 'alt' | 'shift'>

export interface ShortcutPolicyOptions {
  isDev: boolean
}

/**
 * Returns `true` when an input event should be `preventDefault`ed before it
 * reaches the renderer (i.e. before xterm sees it).
 *
 * Replaces `optimizer.watchWindowShortcuts` from `@electron-toolkit/utils`,
 * which preventDefaulted `KeyR + (control || meta)` in packaged builds and
 * broke reverse-i-search inside the terminal. DPlex is a terminal: Ctrl+R
 * belongs to the PTY, so this policy intentionally never blocks `KeyR`.
 *
 * What we still block (matching the toolkit's defaults):
 *   - The DevTools accelerator in production (Cmd+Alt+I / Ctrl+Shift+I).
 *   - Chromium's zoom shortcuts — DPlex exposes its own font-size setting.
 */
export function shouldBlockShortcut(input: ShortcutInput, opts: ShortcutPolicyOptions): boolean {
  if (input.type !== 'keyDown') return false

  const mod = input.control || input.meta

  if (!opts.isDev) {
    if (
      input.code === 'KeyI' &&
      ((input.alt && input.meta) || (input.control && input.shift))
    ) {
      return true
    }
  }

  if (input.code === 'Minus' && mod) return true
  if (input.code === 'Equal' && input.shift && mod) return true

  return false
}
