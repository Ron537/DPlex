/**
 * Normalize a path for comparison: resolve separators, trim trailing slashes.
 * Case-fold only on case-insensitive platforms (macOS, Windows).
 *
 * Lives in its own module (no store imports) so renderer utils that compare
 * paths can import it without dragging in the project/terminal stores —
 * important for tests that mock the stores at module-load time.
 */
export function normalizePath(p: string): string {
  let normalized = p.replace(/\\/g, '/').replace(/\/+$/, '')
  if (typeof navigator !== 'undefined') {
    const platform = navigator.platform?.toLowerCase() ?? ''
    if (platform.includes('mac') || platform.includes('win')) {
      normalized = normalized.toLowerCase()
    }
  }
  return normalized
}
