/**
 * Watcher service for the diff viewer's "Changes List".
 *
 * Per repoRoot:
 *  - watches `.git/index` and `.git/HEAD` for stage/unstage/commit/checkout.
 *  - watches the working-tree root (recursive on macOS/Windows; shallow on
 *    Linux — fs.watch's recursive mode isn't supported there. We accept the
 *    Linux gap; the renderer also does an opportunistic refresh on focus).
 *
 * Worktree events under `.gitignore`d paths (build outputs, dependency
 * caches, agent session state, etc.) are dropped via a per-repo
 * `.gitignore`-aware matcher so we don't run a `git status` round-trip for
 * paths git itself would never report. The matcher is rebuilt (debounced)
 * when any `.gitignore` file in the worktree changes.
 *
 * All events are coalesced inside main: at most one
 * `git:changes-changed` event per `repoRootFs` every `DEBOUNCE_MS`. An
 * in-flight guard prevents stacked refreshes.
 *
 * The renderer subscribes via the IPC layer (see `main/index.ts`) and gets
 * an opaque token; multiple subscribers per repoRoot share one watcher
 * via ref-counting.
 */

import * as fs from 'fs'
import * as path from 'path'
import type { WebContents } from 'electron'

import {
  buildGitignoreMatcher,
  GitignoreMatcher,
  getMatcherSourcePaths,
  resolveGitDir as resolveGitDirShared
} from './gitignoreMatcher'

const DEBOUNCE_MS = 750
// Hard floor between successive emits per repo. Even if the watcher fires
// continuously (busy build process, FSEvents storm, agent writing logs into
// the worktree), we never push more than one `git:diff:changes-changed`
// event per `MIN_EMIT_INTERVAL_MS` per repo. This is the last-line defense
// against the renderer-side "perpetual refresh" symptom.
const MIN_EMIT_INTERVAL_MS = 2000
const DEBUG = process.env.DPLEX_DEBUG_DIFF_WATCHER === '1'

// Throttle for matcher rebuilds when `.gitignore` files are edited rapidly.
const IGNORE_REBUILD_DEBOUNCE_MS = 250

function isPathIgnored(matcher: GitignoreMatcher | null, filename: string): boolean {
  const norm = filename.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!norm) return false
  // `ignore` rejects paths starting with `./` or absolute paths; we already
  // stripped leading slashes above and fs.watch never emits `./` prefixes.
  if (matcher) {
    try {
      return matcher.ignores(norm)
    } catch {
      /* fall through to defaults */
    }
  }
  // Pre-matcher (during the brief window before bootWatchers finishes) we
  // still want to drop the obvious churn so the watcher is never noisier
  // than the previous heuristic at boot.
  return norm === '.git' || norm.startsWith('.git/')
}

function isGitignoreEvent(filename: string): boolean {
  const norm = filename.replace(/\\/g, '/')
  return norm === '.gitignore' || norm.endsWith('/.gitignore')
}

interface SubscriberEntry {
  wc: WebContents
  /** Per-wc subscription count. A single wc may subscribe N times for the
   *  same repo (e.g. multiple diff tabs); we must track per-wc counts so
   *  the destroyed-handler can release ALL of that wc's references at once. */
  count: number
}

interface WatcherEntry {
  repoRootFs: string
  refCount: number
  gitIndexWatcher: fs.FSWatcher | null
  gitHeadWatcher: fs.FSWatcher | null
  worktreeWatcher: fs.FSWatcher | null
  infoExcludeWatcher: fs.FSWatcher | null
  globalExcludesWatcher: fs.FSWatcher | null
  debounceTimer: ReturnType<typeof setTimeout> | null
  inFlight: boolean
  pendingTrigger: boolean
  lastEmitMs: number
  subscribers: Map<number, SubscriberEntry> // webContents.id → entry
  // webContentsIds for which we've already attached the 'destroyed' listener.
  // Without this we leak one Electron listener per `subscribeChanges()` call.
  destroyHooks: Set<number>
  // Cached `.gitignore`-aware matcher used to drop fs events under ignored
  // paths before they trigger a refresh.
  ignoreMatcher: GitignoreMatcher | null
  ignoreRebuildTimer: ReturnType<typeof setTimeout> | null
  // Set to true in teardown so deferred work (matcher build, setImmediate
  // re-emit, debounce/rebuild timer callbacks) noops on an orphaned entry.
  disposed: boolean
}

const watchers = new Map<string, WatcherEntry>()

let nextSubscriptionToken = 1

export interface ChangesSubscriptionToken {
  readonly id: number
  readonly repoRootFs: string
}

/**
 * Subscribe a renderer (`webContents`) to changes for `repoRootFs`. Returns
 * an opaque token to pass to `unsubscribe`. Safe to call multiple times.
 */
export function subscribeChanges(
  repoRootFs: string,
  webContents: WebContents
): ChangesSubscriptionToken {
  let entry = watchers.get(repoRootFs)
  if (!entry) {
    entry = {
      repoRootFs,
      refCount: 0,
      gitIndexWatcher: null,
      gitHeadWatcher: null,
      worktreeWatcher: null,
      infoExcludeWatcher: null,
      globalExcludesWatcher: null,
      debounceTimer: null,
      inFlight: false,
      pendingTrigger: false,
      lastEmitMs: 0,
      subscribers: new Map(),
      destroyHooks: new Set(),
      ignoreMatcher: null,
      ignoreRebuildTimer: null,
      disposed: false
    }
    watchers.set(repoRootFs, entry)
    bootWatchers(entry)
  }
  entry.refCount++
  const existing = entry.subscribers.get(webContents.id)
  if (existing) {
    existing.count++
  } else {
    entry.subscribers.set(webContents.id, { wc: webContents, count: 1 })
  }
  // Only attach the destroyed listener ONCE per webContents — otherwise
  // every subscribe call leaks an event listener (Electron warns at 10).
  if (!entry.destroyHooks.has(webContents.id)) {
    entry.destroyHooks.add(webContents.id)
    const onDestroyed = (): void => {
      unsubscribeAll(repoRootFs, webContents.id)
    }
    webContents.once('destroyed', onDestroyed)
  }
  return { id: nextSubscriptionToken++, repoRootFs }
}

export function unsubscribeChanges(token: ChangesSubscriptionToken, webContentsId: number): void {
  const entry = watchers.get(token.repoRootFs)
  if (!entry) return
  const sub = entry.subscribers.get(webContentsId)
  if (!sub) {
    // The wc was already cleared by `unsubscribeAll` (e.g., destroyed event
    // fired first). All of that wc's references were accounted for there;
    // doing a second decrement here would over-collapse the refcount and
    // tear down the watcher while other windows still hold subscriptions.
    return
  }
  sub.count--
  entry.refCount = Math.max(0, entry.refCount - 1)
  if (sub.count <= 0) {
    entry.subscribers.delete(webContentsId)
    entry.destroyHooks.delete(webContentsId)
  }
  if (entry.refCount <= 0) {
    teardown(entry)
    watchers.delete(token.repoRootFs)
  }
}

function unsubscribeAll(repoRootFs: string, webContentsId: number): void {
  const entry = watchers.get(repoRootFs)
  if (!entry) return
  const sub = entry.subscribers.get(webContentsId)
  if (sub) {
    // Release ALL of this wc's references at once. This is what fixes the
    // leak when a single wc subscribed multiple times to the same repo.
    entry.refCount = Math.max(0, entry.refCount - sub.count)
    entry.subscribers.delete(webContentsId)
    entry.destroyHooks.delete(webContentsId)
  }
  if (entry.refCount <= 0 || entry.subscribers.size === 0) {
    teardown(entry)
    watchers.delete(repoRootFs)
  }
}

function bootWatchers(entry: WatcherEntry): void {
  // Defer matcher construction off the IPC critical path. Building the
  // matcher walks the working tree and may execFileSync `git config`; both
  // can take meaningful time on large repos / slow filesystems. Until the
  // matcher arrives, `isPathIgnored` falls back to dropping `.git/*` so we
  // never regress past the previous heuristic during the warm-up window.
  setImmediate(() => {
    if (entry.disposed) return
    try {
      entry.ignoreMatcher = buildGitignoreMatcher(entry.repoRootFs)
    } catch {
      entry.ignoreMatcher = null
    }
  })

  const gitDir = resolveGitDirShared(entry.repoRootFs) ?? path.join(entry.repoRootFs, '.git')
  // .git/index — touched on stage/unstage.
  try {
    entry.gitIndexWatcher = fs.watch(path.join(gitDir, 'index'), { persistent: false }, () => {
      if (DEBUG) console.log('[diff-watcher] .git/index changed', entry.repoRootFs)
      scheduleEmit(entry, 'git-index')
    })
    entry.gitIndexWatcher.on('error', () => {
      /* ignore — file may not exist yet on fresh repo */
    })
  } catch {
    /* fresh repo / shallow — best-effort */
  }
  // .git/HEAD — checkout/branch switch.
  try {
    entry.gitHeadWatcher = fs.watch(path.join(gitDir, 'HEAD'), { persistent: false }, () => {
      if (DEBUG) console.log('[diff-watcher] .git/HEAD changed', entry.repoRootFs)
      scheduleEmit(entry, 'git-head')
    })
    entry.gitHeadWatcher.on('error', () => {})
  } catch {
    /* best-effort */
  }
  // Working tree — recursive on darwin/win32, shallow on linux.
  try {
    const recursive = process.platform === 'darwin' || process.platform === 'win32'
    entry.worktreeWatcher = fs.watch(
      entry.repoRootFs,
      { persistent: false, recursive },
      (_event, filename) => {
        // macOS FSEvents (and some Windows scenarios) can emit events with
        // empty / null filenames when bulk filesystem activity occurs.
        // Without a path we cannot tell if this is real or noise, so we
        // drop it — explicit `Refresh` and the .git/index watcher cover
        // any case the user actually cares about.
        if (!filename) return
        const name = typeof filename === 'string' ? filename : (filename as Buffer).toString('utf8')
        if (!name) return
        // `.gitignore` edits change which paths we should consider noisy.
        // Schedule a debounced matcher rebuild AND let the event through —
        // a `.gitignore` change is itself a worktree change worth refreshing.
        if (isGitignoreEvent(name)) {
          scheduleIgnoreRebuild(entry)
          if (DEBUG) console.log('[diff-watcher] .gitignore event', name)
          scheduleEmit(entry, 'gitignore')
          return
        }
        if (isPathIgnored(entry.ignoreMatcher, name)) {
          if (DEBUG) console.log('[diff-watcher] ignored (gitignored)', name)
          return
        }
        if (DEBUG) console.log('[diff-watcher] worktree event:', name)
        scheduleEmit(entry, 'worktree')
      }
    )
    entry.worktreeWatcher.on('error', () => {})
  } catch {
    /* best-effort */
  }
  // Watch `.git/info/exclude` and the user's global excludes file (if either
  // is present) so edits to those — which are sources for the matcher but
  // live outside the worktree-recursive watch — also trigger a rebuild.
  bootMatcherSourceWatchers(entry)
}

function bootMatcherSourceWatchers(entry: WatcherEntry): void {
  let sources: { infoExclude: string | null; globalExcludes: string | null }
  try {
    sources = getMatcherSourcePaths(entry.repoRootFs)
  } catch {
    return
  }
  if (sources.infoExclude) {
    try {
      entry.infoExcludeWatcher = fs.watch(sources.infoExclude, { persistent: false }, () => {
        if (DEBUG) console.log('[diff-watcher] info/exclude changed', entry.repoRootFs)
        scheduleIgnoreRebuild(entry)
        scheduleEmit(entry, 'info-exclude')
      })
      entry.infoExcludeWatcher.on('error', () => {})
    } catch {
      /* file may not exist; rebuilds still happen on .gitignore events */
    }
  }
  if (sources.globalExcludes) {
    try {
      entry.globalExcludesWatcher = fs.watch(sources.globalExcludes, { persistent: false }, () => {
        if (DEBUG) console.log('[diff-watcher] global excludes changed', entry.repoRootFs)
        scheduleIgnoreRebuild(entry)
        scheduleEmit(entry, 'global-excludes')
      })
      entry.globalExcludesWatcher.on('error', () => {})
    } catch {
      /* file may not exist */
    }
  }
}

function scheduleIgnoreRebuild(entry: WatcherEntry): void {
  if (entry.disposed) return
  if (entry.ignoreRebuildTimer) clearTimeout(entry.ignoreRebuildTimer)
  entry.ignoreRebuildTimer = setTimeout(() => {
    entry.ignoreRebuildTimer = null
    if (entry.disposed) return
    try {
      entry.ignoreMatcher = buildGitignoreMatcher(entry.repoRootFs)
      if (DEBUG) console.log('[diff-watcher] rebuilt ignore matcher', entry.repoRootFs)
    } catch {
      /* keep the previous matcher rather than dropping all filtering */
    }
  }, IGNORE_REBUILD_DEBOUNCE_MS)
}

function scheduleEmit(entry: WatcherEntry, source: string): void {
  if (entry.disposed) return
  // Hard floor on emit frequency — even if events stream in continuously,
  // we never push more than one notification per `MIN_EMIT_INTERVAL_MS`.
  const now = Date.now()
  const sinceLast = now - entry.lastEmitMs
  const wait = sinceLast >= MIN_EMIT_INTERVAL_MS ? DEBOUNCE_MS : MIN_EMIT_INTERVAL_MS - sinceLast
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
  entry.debounceTimer = setTimeout(() => {
    entry.debounceTimer = null
    if (entry.disposed) return
    if (DEBUG) console.log('[diff-watcher] emit (source=' + source + ')', entry.repoRootFs)
    emitNow(entry)
  }, wait)
}

function emitNow(entry: WatcherEntry): void {
  if (entry.disposed) return
  if (entry.inFlight) {
    entry.pendingTrigger = true
    return
  }
  entry.inFlight = true
  entry.lastEmitMs = Date.now()
  // Notify all live subscribers. We do NOT recompute the change list here —
  // the renderer pulls via `listChanges` IPC after receiving the event.
  // This keeps the watcher cheap and avoids racing with concurrent IPC.
  for (const sub of entry.subscribers.values()) {
    if (sub.wc.isDestroyed()) continue
    try {
      sub.wc.send('git:diff:changes-changed', { repoRootFs: entry.repoRootFs })
    } catch {
      /* ignore — destroyed window */
    }
  }
  // Clear the in-flight flag on next tick so any events that fired during
  // emit collapse into a single follow-up.
  setImmediate(() => {
    entry.inFlight = false
    if (entry.disposed) return
    if (entry.pendingTrigger) {
      entry.pendingTrigger = false
      scheduleEmit(entry, 'pending')
    }
  })
}

function teardown(entry: WatcherEntry): void {
  entry.disposed = true
  if (entry.debounceTimer) {
    clearTimeout(entry.debounceTimer)
    entry.debounceTimer = null
  }
  if (entry.ignoreRebuildTimer) {
    clearTimeout(entry.ignoreRebuildTimer)
    entry.ignoreRebuildTimer = null
  }
  entry.gitIndexWatcher?.close()
  entry.gitHeadWatcher?.close()
  entry.worktreeWatcher?.close()
  entry.infoExcludeWatcher?.close()
  entry.globalExcludesWatcher?.close()
  entry.gitIndexWatcher = null
  entry.gitHeadWatcher = null
  entry.worktreeWatcher = null
  entry.infoExcludeWatcher = null
  entry.globalExcludesWatcher = null
  entry.subscribers.clear()
  entry.destroyHooks.clear()
  entry.refCount = 0
  entry.ignoreMatcher = null
}

/** Test-only — stop everything (used by tests; not exported via index.ts). */
export function __resetForTests(): void {
  for (const entry of watchers.values()) teardown(entry)
  watchers.clear()
}
