/**
 * Filesystem watcher for the file-explorer tree.
 *
 * Per project root:
 *  - macOS/Windows: a single recursive `fs.watch` on the root.
 *  - Linux: `fs.watch` has no recursive mode, so we watch the root shallowly.
 *    Nested edits are not guaranteed — the renderer also refreshes on window
 *    focus (same documented tradeoff as the diff `changesWatcher`).
 *
 * Events are coalesced: at most one `files:tree-changed` emit per root per
 * `DEBOUNCE_MS`, carrying the set of changed directory relPaths so the
 * renderer refreshes only the dirs it currently shows expanded.
 *
 * Self-write suppression: `noteSelfWrite` records paths the app just wrote so
 * the watcher can drop the echo event (the renderer additionally guards via
 * mtime/hash — this just avoids needless tree churn).
 */

import * as fs from 'fs'
import type { WebContents } from 'electron'

const DEBOUNCE_MS = 300
const MIN_EMIT_INTERVAL_MS = 750
const SELF_WRITE_WINDOW_MS = 1500

const RECURSIVE_SUPPORTED = process.platform === 'darwin' || process.platform === 'win32'
const CASE_INSENSITIVE = process.platform === 'darwin' || process.platform === 'win32'

interface SubscriberEntry {
  wc: WebContents
  count: number
}

interface WatcherEntry {
  root: string
  refCount: number
  watcher: fs.FSWatcher | null
  debounceTimer: ReturnType<typeof setTimeout> | null
  lastEmitMs: number
  pendingDirs: Set<string>
  subscribers: Map<number, SubscriberEntry>
  /** Per-WebContents `destroyed` listener, kept so it can be removed cleanly. */
  destroyHooks: Map<number, () => void>
  disposed: boolean
}

const watchers = new Map<string, WatcherEntry>()
const recentSelfWrites = new Map<string, number>()

let nextToken = 1

export interface TreeSubscriptionToken {
  readonly id: number
  readonly root: string
}

/** Record an app-originated write so its watcher echo can be suppressed. */
export function noteSelfWrite(root: string, relPath: string): void {
  recentSelfWrites.set(selfWriteKey(root, relPath), Date.now())
  // Opportunistic cleanup so the map can't grow unbounded.
  if (recentSelfWrites.size > 256) {
    const cutoff = Date.now() - SELF_WRITE_WINDOW_MS
    for (const [k, ts] of recentSelfWrites) {
      if (ts < cutoff) recentSelfWrites.delete(k)
    }
  }
}

function selfWriteKey(root: string, relPath: string): string {
  // Match the normalization the watcher applies to incoming filenames so the
  // suppression key lines up: posix separators, no leading slashes, and
  // case-folded on case-insensitive filesystems.
  let norm = relPath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (CASE_INSENSITIVE) norm = norm.toLowerCase()
  const r = CASE_INSENSITIVE ? root.toLowerCase() : root
  return `${r}\0${norm}`
}

function isRecentSelfWrite(root: string, relPath: string): boolean {
  const ts = recentSelfWrites.get(selfWriteKey(root, relPath))
  if (ts === undefined) return false
  if (Date.now() - ts > SELF_WRITE_WINDOW_MS) {
    recentSelfWrites.delete(selfWriteKey(root, relPath))
    return false
  }
  return true
}

export function subscribeTree(root: string, wc: WebContents): TreeSubscriptionToken {
  let entry = watchers.get(root)
  if (!entry) {
    entry = {
      root,
      refCount: 0,
      watcher: null,
      debounceTimer: null,
      lastEmitMs: 0,
      pendingDirs: new Set(),
      subscribers: new Map(),
      destroyHooks: new Map(),
      disposed: false
    }
    watchers.set(root, entry)
    bootWatcher(entry)
  }
  // The entry may exist but its watcher may have died (boot threw / 'error');
  // rearm so subscribers don't silently go blind for the app's lifetime.
  if (!entry.watcher) bootWatcher(entry)
  entry.refCount++
  const existing = entry.subscribers.get(wc.id)
  if (existing) {
    existing.count++
  } else {
    entry.subscribers.set(wc.id, { wc, count: 1 })
  }
  if (!entry.destroyHooks.has(wc.id)) {
    const listener = (): void => unsubscribeAll(root, wc.id)
    entry.destroyHooks.set(wc.id, listener)
    wc.once('destroyed', listener)
  }
  return { id: nextToken++, root }
}

/** Remove and detach the `destroyed` listener for a WebContents, if present. */
function detachDestroyHook(entry: WatcherEntry, wcId: number): void {
  const listener = entry.destroyHooks.get(wcId)
  if (!listener) return
  entry.destroyHooks.delete(wcId)
  const sub = entry.subscribers.get(wcId)
  if (sub && !sub.wc.isDestroyed()) sub.wc.removeListener('destroyed', listener)
}

export function unsubscribeTree(token: TreeSubscriptionToken, wcId: number): void {
  const entry = watchers.get(token.root)
  if (!entry) return
  const sub = entry.subscribers.get(wcId)
  if (!sub) return
  sub.count--
  entry.refCount = Math.max(0, entry.refCount - 1)
  if (sub.count <= 0) {
    detachDestroyHook(entry, wcId)
    entry.subscribers.delete(wcId)
  }
  if (entry.refCount <= 0) teardown(entry)
}

function unsubscribeAll(root: string, wcId: number): void {
  const entry = watchers.get(root)
  if (!entry) return
  const sub = entry.subscribers.get(wcId)
  if (!sub) return
  entry.refCount = Math.max(0, entry.refCount - sub.count)
  detachDestroyHook(entry, wcId)
  entry.subscribers.delete(wcId)
  if (entry.refCount <= 0) teardown(entry)
}

function bootWatcher(entry: WatcherEntry): void {
  try {
    const watcher = fs.watch(
      entry.root,
      { recursive: RECURSIVE_SUPPORTED },
      (_eventType, filename) => onRawEvent(entry, filename)
    )
    watcher.on('error', (err) => {
      // A watcher error (e.g. the root was deleted/renamed) leaves the handle
      // dead. Null it out and close so the *next* subscribe reboots a fresh
      // watcher instead of silently going blind. The renderer's focus-refresh
      // covers the gap until then.
      console.error('[treeWatcher] watch error on', entry.root, err)
      try {
        watcher.close()
      } catch {
        /* already closed */
      }
      if (entry.watcher === watcher) entry.watcher = null
    })
    entry.watcher = watcher
  } catch (err) {
    console.error('[treeWatcher] failed to watch', entry.root, err)
    entry.watcher = null
  }
}

function onRawEvent(entry: WatcherEntry, filename: string | Buffer | null): void {
  if (entry.disposed || filename === null) return
  const raw = typeof filename === 'string' ? filename : filename.toString('utf8')
  const norm = raw.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!norm) return
  // Drop git internals (case-insensitive on APFS/NTFS where `.GIT` aliases).
  const head = norm.includes('/') ? norm.slice(0, norm.indexOf('/')) : norm
  if ((CASE_INSENSITIVE ? head.toLowerCase() : head) === '.git') return
  // Suppress our own recent writes to avoid tree churn / reload races.
  if (isRecentSelfWrite(entry.root, norm)) return
  // The changed dir is the parent of the changed entry (POSIX relPath, '' = root).
  const parent = norm.includes('/') ? norm.slice(0, norm.lastIndexOf('/')) : ''
  entry.pendingDirs.add(parent)
  scheduleEmit(entry)
}

function scheduleEmit(entry: WatcherEntry): void {
  if (entry.debounceTimer) return
  const sinceLast = Date.now() - entry.lastEmitMs
  const delay = Math.max(DEBOUNCE_MS, MIN_EMIT_INTERVAL_MS - sinceLast)
  entry.debounceTimer = setTimeout(() => {
    entry.debounceTimer = null
    if (entry.disposed) return
    const dirs = Array.from(entry.pendingDirs)
    entry.pendingDirs.clear()
    if (dirs.length === 0) return
    entry.lastEmitMs = Date.now()
    for (const { wc } of entry.subscribers.values()) {
      if (!wc.isDestroyed()) {
        wc.send('files:tree-changed', { rootFs: entry.root, dirs })
      }
    }
  }, delay)
}

function teardown(entry: WatcherEntry): void {
  entry.disposed = true
  if (entry.debounceTimer) {
    clearTimeout(entry.debounceTimer)
    entry.debounceTimer = null
  }
  try {
    entry.watcher?.close()
  } catch {
    /* ignore */
  }
  entry.watcher = null
  watchers.delete(entry.root)
}

/** Test-only helper to assert no watcher leaks. */
export function __activeWatcherCount(): number {
  return watchers.size
}
