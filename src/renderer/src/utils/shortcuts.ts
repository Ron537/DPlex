export const isMac =
  typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC')

/** Primary modifier symbol. ⌘ on macOS, Ctrl+ on other platforms. */
export const MOD = isMac ? '⌘' : 'Ctrl+'

/** Shift modifier symbol. ⇧ on macOS, Shift+ on other platforms. */
export const SHIFT = isMac ? '⇧' : 'Shift+'

/** Alt/Option modifier symbol. ⌥ on macOS, Alt+ on other platforms. */
export const ALT = isMac ? '⌥' : 'Alt+'
