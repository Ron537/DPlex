/**
 * Maps a renderer-side "bound" project root (the raw `project.path` the UI uses
 * as a key and passes to file IPC) to the canonical realpath the main process
 * actually watches and stamps onto `files:tree-changed` payloads.
 *
 * For non-symlinked project paths the two are identical, but on macOS/Linux a
 * project under a symlinked path (e.g. `/tmp` → `/private/tmp`, or a worktree
 * reached via a symlink) is canonicalized by `safeProjectRoot`. Without this
 * mapping every watcher event for such a root is dropped because the bound root
 * never equals the canonical payload root.
 */
const canonicalByBound = new Map<string, string>()

export function setCanonicalRoot(boundRoot: string, canonicalRoot: string): void {
  canonicalByBound.set(boundRoot, canonicalRoot)
}

export function clearCanonicalRoot(boundRoot: string): void {
  canonicalByBound.delete(boundRoot)
}

/** True when a tree-changed payload root refers to the given bound root. */
export function watchRootMatches(payloadRoot: string, boundRoot: string | null): boolean {
  if (!boundRoot) return false
  if (payloadRoot === boundRoot) return true
  return canonicalByBound.get(boundRoot) === payloadRoot
}
