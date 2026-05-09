/** Extract the trailing path segment ("folder name") from an absolute or
 *  relative path, treating both POSIX and Windows separators as boundaries.
 *
 *  Returns the original path when no separator is present, and an empty
 *  string when the input is undefined. Cross-platform safe — used by every
 *  search source so future changes (UNC paths, trailing slashes, …) live
 *  in one place.
 *
 *  Note: this intentionally does **not** delegate to `utils/normalizePath`.
 *  `normalizePath` case-folds on macOS/Windows for *comparison* purposes;
 *  search results need the original casing for display. The separator
 *  rewrite is duplicated on purpose. */
export function pathBasename(p?: string): string {
  if (!p) return ''
  const parts = p.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || p
}
