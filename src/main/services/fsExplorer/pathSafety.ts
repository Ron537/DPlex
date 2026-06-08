/**
 * Path-safety guard for the project-bounded file explorer.
 *
 * IMPORTANT: This is deliberately NOT `safeRepoRoot` from `main/index.ts`.
 * `safeRepoRoot` expands a subfolder to the *containing git repo root*, which
 * is correct for the diff panel but wrong for a project-bounded explorer — the
 * explorer must stay inside the project's own directory and never climb to a
 * git top-level.
 *
 * Guarantees provided here:
 *  - the project root is realpath-resolved and must be a directory;
 *  - a renderer-supplied `relPath` is normalized to POSIX, rejected if it
 *    escapes the root lexically (`..`), is absolute, or contains NUL;
 *  - any path segment named `.git` is refused (protects git internals — root
 *    `.git` dir or worktree `.git` file, and submodule `.git` entries);
 *  - the resolved parent directory is realpathed and must remain inside the
 *    root — this catches in-repo symlinks that point outside the project;
 *  - when the target must already exist, the target itself is realpathed and
 *    must remain inside the root (catches symlinked files pointing outside).
 *
 * Symlinked directories are listed (as entries) but never recursed *through*
 * to a location outside the root, because every resolve goes through these
 * realpath containment checks.
 */

import * as fs from 'fs'
import * as path from 'path'

/** Case-insensitive path comparison on macOS/Windows, exact elsewhere. */
const CASE_INSENSITIVE = process.platform === 'darwin' || process.platform === 'win32'

function samePathPrefix(root: string, target: string): boolean {
  // `target` is "inside" root when the path-relative from root to target does
  // not start with `..` and is not absolute (a different Windows drive yields
  // an absolute relative path). Empty relative means target === root.
  const rel = path.relative(root, target)
  if (rel === '') return true
  if (path.isAbsolute(rel)) return false
  const first = rel.split(path.sep)[0]
  return first !== '..'
}

function caseFold(p: string): string {
  return CASE_INSENSITIVE ? p.toLowerCase() : p
}

/**
 * True when a path segment is git's metadata dir. Compared case-insensitively
 * on case-insensitive filesystems (APFS/NTFS), where `.GIT` and `.git` resolve
 * to the same on-disk directory that git itself treats as repo internals.
 */
export function isDotGitSegment(name: string): boolean {
  return caseFold(name) === '.git'
}

/** True when `target` is `root` or nested inside it (case-aware per platform). */
function isInsideRoot(root: string, target: string): boolean {
  return samePathPrefix(caseFold(root), caseFold(target))
}

/**
 * Realpath + validate a renderer-supplied project root. Returns the canonical
 * absolute path, or `null` when the input is not a usable directory.
 */
export async function safeProjectRoot(input: unknown): Promise<string | null> {
  if (typeof input !== 'string' || input.length === 0) return null
  if (input.includes('\0')) return null
  try {
    const real = await fs.promises.realpath(input)
    const stat = await fs.promises.stat(real)
    if (!stat.isDirectory()) return null
    return real
  } catch {
    return null
  }
}

/** Normalize a renderer relPath to POSIX segments, or null if invalid. */
export function normalizeRelPath(relPath: unknown): string | null {
  if (relPath === '' || relPath === undefined || relPath === null) return ''
  if (typeof relPath !== 'string') return null
  if (relPath.includes('\0')) return null
  // Accept both separators from the renderer, normalize to POSIX.
  const posix = relPath.replace(/\\/g, '/')
  const segments = posix.split('/').filter((s) => s.length > 0)
  for (const seg of segments) {
    if (seg === '.' || seg === '..') return null
    if (isDotGitSegment(seg)) return null
  }
  return segments.join('/')
}

export interface ResolveOptions {
  /** When true, the target must already exist and realpath inside the root. */
  mustExist?: boolean
}

/**
 * Resolve a project-relative path to a safe absolute fs path, or `null` when
 * the path is invalid or escapes the root. `root` MUST already be a value
 * returned by `safeProjectRoot` (i.e. realpathed).
 */
export async function resolveInsideRoot(
  root: string,
  relPath: unknown,
  opts: ResolveOptions = {}
): Promise<string | null> {
  const rel = normalizeRelPath(relPath)
  if (rel === null) return null
  const fsPath = rel === '' ? root : path.join(root, ...rel.split('/'))

  // Lexical containment (cheap, catches obvious traversal even before realpath).
  if (!isInsideRoot(root, fsPath)) return null

  // Realpath the nearest EXISTING ancestor — it must stay inside the root.
  // Catches symlinked parents escaping the project, while still allowing
  // not-yet-created intermediate directories (nested create/mkdir -p).
  if (rel !== '') {
    let ancestor = path.dirname(fsPath)
    // Walk up until we find a directory that exists on disk.
    for (;;) {
      try {
        const realAncestor = await fs.promises.realpath(ancestor)
        if (!isInsideRoot(root, realAncestor)) return null
        break
      } catch {
        const parent = path.dirname(ancestor)
        // Reached the filesystem root or stopped making progress without ever
        // finding an existing ancestor inside the project — reject.
        if (parent === ancestor || !isInsideRoot(root, ancestor)) return null
        ancestor = parent
      }
    }
  }

  // If the target already exists (or is required to), realpath it too.
  if (rel !== '') {
    try {
      const realTarget = await fs.promises.realpath(fsPath)
      if (!isInsideRoot(root, realTarget)) return null
    } catch {
      if (opts.mustExist) return null
      // realpath failed: the target either doesn't exist yet (fine for
      // create/write) OR is a *dangling* symlink. A broken symlink whose link
      // text points outside the root would let a subsequent write escape the
      // project (writeFile follows the link), so reject any symlink here.
      try {
        const lst = await fs.promises.lstat(fsPath)
        if (lst.isSymbolicLink()) return null
      } catch {
        // lstat ENOENT → genuinely absent; parent was already contained above.
      }
    }
  }

  return fsPath
}
