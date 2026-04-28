/**
 * Core worktree service.
 *
 * Responsibilities:
 *  - maintain the ops queue per repo (phase 1 = git mutation + sidecar + env copy)
 *  - host watchers (ref-counted by subscription token)
 *  - emit `worktrees:changed` via the injected emitter (main index.ts wires this
 *    to webContents.send + tracks subscribers per webContents)
 *  - copy env files
 *  - list with status (delegates to gitWorktree)
 *  - structured errors
 *
 * Setup script execution is delegated: the renderer requests a PTY tab via the
 * existing pty IPC; the service only records lastSetupRunAt/ExitCode in sidecar
 * once the renderer reports completion.
 */

import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { randomUUID } from 'crypto'
import {
  realpath,
  resolveGitDir,
  getCommonGitDir,
  getRepoIdentity,
  listLocalBranches,
  listRemoteBranches,
  resolveDefaultBaseBranch,
  getUpstream,
  revListAheadBehind
} from '../gitService'
import {
  listWorktreesWithStatus,
  gitWorktreeAdd,
  gitWorktreeRemove,
  gitBranchDelete,
  isGitRepo
} from './gitWorktree'
import { getEntry, removeEntry, upsertEntry, reconcile } from './sidecar'
import type {
  CreateWorktreeOptions,
  CreateWorktreeResult,
  DeleteWorktreeOptions,
  DeleteWorktreeResult,
  WorktreeError,
  WorktreeInfo,
  WorktreesChangedPayload,
  WorktreeSubscriptionToken
} from './types'
import { worktreeError } from './types'

type Emitter = (payload: WorktreesChangedPayload) => void

// ── Subscriptions ─────────────────────────────────────────────────────
// Subscriptions are keyed by repo *identity* (the main-checkout root), which
// is stable across a user opening the project from the main checkout or from
// any linked worktree.

interface SubscriptionEntry {
  identity: string
  emit: Emitter
}

const subscriptions = new Map<WorktreeSubscriptionToken, SubscriptionEntry>()

interface WatcherEntry {
  identity: string
  gitDirWatcher: fs.FSWatcher | null
  worktreeWatchers: Map<string, fs.FSWatcher>
  debounceTimer: ReturnType<typeof setTimeout> | null
  lastSnapshot: WorktreeInfo[]
}

const watchers = new Map<string, WatcherEntry>() // keyed by repo identity

// ── Ops queue ─────────────────────────────────────────────────────────
// Queued per repo identity so that concurrent ops on the same repo serialize,
// while unrelated repos run in parallel.

const repoQueues = new Map<string, Promise<unknown>>()

function queue<T>(identity: string, fn: () => Promise<T>): Promise<T> {
  const prev = repoQueues.get(identity) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  const tracked = next.catch(() => undefined)
  repoQueues.set(identity, tracked)
  // Reclaim the slot once this queue entry settles AND no newer entry has
  // chained behind it. This keeps the Map from growing linearly with the
  // number of distinct repos touched over a long session.
  void tracked.finally(() => {
    if (repoQueues.get(identity) === tracked) {
      repoQueues.delete(identity)
    }
  })
  return next
}

async function resolveIdentity(repoRoot: string): Promise<string | null> {
  const id = await getRepoIdentity(repoRoot)
  if (id) return id
  // Fallback when the caller passed something that's not a git repo.
  return null
}

// ── Public API ────────────────────────────────────────────────────────

export async function listBranches(
  repoRoot: string
): Promise<{ local: string[]; remote: string[]; defaultBase: string | null }> {
  const canonical = await realpath(repoRoot)
  const [local, remote, defaultBase] = await Promise.all([
    listLocalBranches(canonical),
    listRemoteBranches(canonical),
    resolveDefaultBaseBranch(canonical)
  ])
  return { local, remote, defaultBase }
}

export async function list(repoRoot: string): Promise<WorktreeInfo[]> {
  const canonical = await realpath(repoRoot)
  if (!(await isGitRepo(canonical))) return []
  const identity = (await resolveIdentity(canonical)) ?? canonical
  const worktrees = await listWorktreesWithStatus(canonical)
  if (worktrees === null) {
    // Transient git failure — do NOT reconcile (would wipe sidecar).
    return watchers.get(identity)?.lastSnapshot ?? []
  }
  await reconcile(
    identity,
    worktrees.map((w) => w.path)
  )
  return worktrees
}

/**
 * Validate that a requested worktree location is safe.
 *
 * Rules:
 *   - Must be absolute (caller resolves this before calling).
 *   - Must not equal the repo root (would clobber main checkout).
 *   - Must not be inside the main `.git` directory.
 *   - Must be under the user's home directory OR the parent directory of
 *     the repo root. This blocks accidental `/etc/...` / `/tmp/...` paths
 *     created by a buggy pattern expansion while still allowing both
 *     `~/work/proj-branch` and `<repoParent>/proj-branch` patterns.
 */
function validateWorktreePath(desiredPath: string, repoRoot: string): WorktreeError | null {
  if (!path.isAbsolute(desiredPath)) {
    return worktreeError('INVALID_ARGUMENT', `Worktree path must be absolute: ${desiredPath}`)
  }
  if (desiredPath === repoRoot) {
    return worktreeError('INVALID_ARGUMENT', 'Worktree path cannot be the repository root itself')
  }
  if (
    desiredPath.includes(`${path.sep}.git${path.sep}`) ||
    desiredPath.endsWith(`${path.sep}.git`)
  ) {
    return worktreeError('INVALID_ARGUMENT', 'Worktree path cannot be inside a .git directory')
  }
  const home = os.homedir()
  const repoParent = path.dirname(repoRoot)
  const isUnderHome = home ? desiredPath === home || desiredPath.startsWith(home + path.sep) : false
  const isUnderRepoParent =
    desiredPath === repoParent || desiredPath.startsWith(repoParent + path.sep)
  if (!isUnderHome && !isUnderRepoParent) {
    return worktreeError(
      'INVALID_ARGUMENT',
      `Worktree path must be under your home directory or the project's parent folder: ${desiredPath}`
    )
  }
  return null
}

export async function create(
  opts: CreateWorktreeOptions
): Promise<CreateWorktreeResult | WorktreeError> {
  const repoRoot = await realpath(opts.repoRoot)
  if (!opts.branch || !opts.worktreePath) {
    return worktreeError('INVALID_ARGUMENT', 'branch and worktreePath are required')
  }
  // Reject branch names that git would interpret as command-line options.
  // Even though we use execFile (no shell), git argv parsing treats e.g.
  // "-f" as --force, which would change semantics.
  if (opts.branch.startsWith('-')) {
    return worktreeError('INVALID_ARGUMENT', `Branch name cannot start with "-": ${opts.branch}`)
  }
  if (opts.baseBranch && opts.baseBranch.startsWith('-')) {
    return worktreeError(
      'INVALID_ARGUMENT',
      `Base branch name cannot start with "-": ${opts.baseBranch}`
    )
  }
  if (!(await isGitRepo(repoRoot))) {
    return worktreeError('NOT_A_GIT_REPO', `${repoRoot} is not a git repo`)
  }

  const identity = (await resolveIdentity(repoRoot)) ?? repoRoot

  const desiredPath = path.isAbsolute(opts.worktreePath)
    ? path.resolve(opts.worktreePath)
    : path.resolve(repoRoot, opts.worktreePath)

  const pathError = validateWorktreePath(desiredPath, identity)
  if (pathError) return pathError

  // Pre-flight checks
  try {
    await fsp.access(desiredPath)
    return worktreeError('PATH_EXISTS', `${desiredPath} already exists`)
  } catch {
    /* good — does not exist */
  }

  // Resolve default base branch if caller created a new branch but didn't
  // specify a base (common with QuickCreate which always passes null).
  let baseBranch = opts.baseBranch
  if (opts.newBranch && !baseBranch) {
    baseBranch = await resolveDefaultBaseBranch(repoRoot)
    if (!baseBranch) {
      return worktreeError(
        'INVALID_ARGUMENT',
        'Could not resolve a default base branch — please specify one explicitly.'
      )
    }
  }

  const opId = randomUUID()

  return queue(identity, async () => {
    const addResult = await gitWorktreeAdd(repoRoot, desiredPath, opts.branch, {
      newBranch: opts.newBranch,
      baseBranch
    })
    if (addResult.code !== 0) {
      return mapAddError(addResult.stderr || addResult.stdout)
    }

    // The new worktree path may be a symlink on some filesystems — canonicalize.
    const canonicalWorktreePath = await realpath(desiredPath)

    if (opts.trackInSidecar !== false) {
      await upsertEntry(identity, canonicalWorktreePath, {
        createdByDplex: true,
        createdAt: new Date().toISOString(),
        baseBranch,
        initialBranch: opts.branch
      })
    }

    if (opts.envFiles && opts.envFiles.length > 0) {
      await copyEnvFiles(repoRoot, canonicalWorktreePath, opts.envFiles)
    }

    // Refresh + emit. listWorktreesWithStatus may return null if git itself
    // starts failing between add and list (rare) — fall back to a minimal
    // snapshot built from the values we just committed.
    const worktrees = (await listWorktreesWithStatus(repoRoot)) ?? []
    if (worktrees.length > 0) {
      emitToIdentity(identity, {
        repoRoot: identity,
        worktrees,
        changedPaths: [canonicalWorktreePath]
      })
      rebindWorktreeWatchers(identity, worktrees)
    }

    const created =
      worktrees.find((w) => w.path === canonicalWorktreePath) ??
      ({
        path: canonicalWorktreePath,
        branch: opts.branch,
        head: '',
        detached: false,
        isMain: false,
        prunable: false,
        createdByDplex: true,
        createdAt: new Date().toISOString(),
        baseBranch,
        status: {
          dirtyCount: 0,
          untrackedCount: 0,
          stagedCount: 0,
          ahead: null,
          behind: null,
          upstream: null
        }
      } satisfies WorktreeInfo)

    return { worktree: created, opId }
  })
}

export async function remove(
  opts: DeleteWorktreeOptions
): Promise<DeleteWorktreeResult | WorktreeError> {
  const repoRoot = await realpath(opts.repoRoot)
  const worktreePath = await realpath(opts.worktreePath)

  if (!(await isGitRepo(repoRoot))) {
    return worktreeError('NOT_A_GIT_REPO', `${repoRoot} is not a git repo`)
  }

  const identity = (await resolveIdentity(repoRoot)) ?? repoRoot

  return queue(identity, async () => {
    // Capture branch before removal — needed for optional branch delete.
    const pre = await listWorktreesWithStatus(repoRoot)
    if (pre === null) {
      return worktreeError('UNKNOWN', 'Failed to list worktrees')
    }
    const target = pre.find((w) => w.path === worktreePath)
    if (!target) {
      return worktreeError('WORKTREE_NOT_FOUND', `No worktree at ${worktreePath}`)
    }
    if (target.isMain) {
      return worktreeError('IS_MAIN_CHECKOUT', 'Cannot delete the main checkout')
    }

    const rmResult = await gitWorktreeRemove(repoRoot, worktreePath, opts.force)
    if (rmResult.code !== 0) {
      return mapRemoveError(rmResult.stderr || rmResult.stdout)
    }

    await removeEntry(identity, worktreePath)

    if (opts.deleteBranch && target.branch) {
      // Reject branch names that git would interpret as options.
      if (target.branch.startsWith('-')) {
        await refreshAndEmit(identity, repoRoot, [worktreePath])
        return {
          ok: true as const,
          warning: worktreeError(
            'INVALID_ARGUMENT',
            `Refusing to delete branch with option-like name: ${target.branch}`
          )
        }
      }
      // Safety: if branch has no upstream OR is ahead of upstream, block unless force.
      const upstream = await getUpstream(repoRoot, target.branch)
      if (!upstream && !opts.forceDeleteBranch) {
        await refreshAndEmit(identity, repoRoot, [worktreePath])
        return {
          ok: true as const,
          warning: worktreeError(
            'BRANCH_NO_UPSTREAM',
            `Branch ${target.branch} has no upstream — branch not deleted`
          )
        }
      }
      if (upstream && !opts.forceDeleteBranch) {
        const ab = await revListAheadBehind(repoRoot, upstream, target.branch)
        if ((ab.ahead ?? 0) > 0) {
          await refreshAndEmit(identity, repoRoot, [worktreePath])
          return {
            ok: true as const,
            warning: worktreeError(
              'BRANCH_HAS_UNPUSHED_COMMITS',
              `Branch ${target.branch} has unpushed commits — branch not deleted`
            )
          }
        }
      }
      const delResult = await gitBranchDelete(
        repoRoot,
        target.branch,
        Boolean(opts.forceDeleteBranch)
      )
      if (delResult.code !== 0) {
        await refreshAndEmit(identity, repoRoot, [worktreePath])
        return {
          ok: true as const,
          warning: worktreeError('UNKNOWN', delResult.stderr || delResult.stdout)
        }
      }
    }

    await refreshAndEmit(identity, repoRoot, [worktreePath])
    return { ok: true as const, warning: null }
  })
}

// ── Env file copy ────────────────────────────────────────────────────

async function copyEnvFiles(
  repoRoot: string,
  worktreePath: string,
  patterns: string[]
): Promise<void> {
  // v1: simple pattern support — exact filenames + one trailing glob (`.env.*.local`).
  //
  // Security: env-file patterns come from the renderer (user-provided). Reject
  // anything that resolves outside `repoRoot` (source) or `worktreePath`
  // (destination) so a malicious/misconfigured pattern like `../secrets/.env`
  // can't read or overwrite files elsewhere on disk.
  const repoRootResolved = path.resolve(repoRoot)
  const worktreeResolved = path.resolve(worktreePath)

  const isInside = (parent: string, child: string): boolean => {
    const rel = path.relative(parent, child)
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
  }

  const expanded = new Set<string>()
  for (const pat of patterns) {
    if (pat.includes('*')) {
      const dir = path.resolve(repoRootResolved, path.dirname(pat))
      if (!isInside(repoRootResolved, dir) && dir !== repoRootResolved) continue
      const base = path.basename(pat)
      try {
        const entries = await fsp.readdir(dir)
        const re = new RegExp('^' + base.replace(/[.]/g, '\\.').replace(/\*/g, '.*') + '$')
        for (const e of entries) {
          if (re.test(e)) {
            const src = path.join(dir, e)
            if (isInside(repoRootResolved, src)) expanded.add(src)
          }
        }
      } catch {
        /* skip missing dir */
      }
    } else {
      const src = path.resolve(repoRootResolved, pat)
      if (isInside(repoRootResolved, src)) expanded.add(src)
    }
  }

  for (const src of expanded) {
    try {
      const rel = path.relative(repoRootResolved, src)
      const dst = path.resolve(worktreeResolved, rel)
      if (!isInside(worktreeResolved, dst)) continue
      await fsp.mkdir(path.dirname(dst), { recursive: true })
      await fsp.copyFile(src, dst)
    } catch {
      // Missing source → skip silently (documented behavior).
    }
  }
}

// ── Watchers ─────────────────────────────────────────────────────────

export async function watchRepo(
  repoRoot: string,
  emit: Emitter
): Promise<{ token: WorktreeSubscriptionToken; repoRoot: string } | null> {
  const canonical = await realpath(repoRoot)
  if (!(await isGitRepo(canonical))) return null

  const identity = (await resolveIdentity(canonical)) ?? canonical

  const token = randomUUID()
  subscriptions.set(token, { identity, emit })

  let entry = watchers.get(identity)
  if (!entry) {
    entry = {
      identity,
      gitDirWatcher: null,
      worktreeWatchers: new Map(),
      debounceTimer: null,
      lastSnapshot: []
    }
    watchers.set(identity, entry)

    const commonDir = await getCommonGitDir(canonical)
    const gitDir = commonDir ?? (await resolveGitDir(canonical))
    if (gitDir) {
      try {
        entry.gitDirWatcher = fs.watch(gitDir, { persistent: false, recursive: false }, () =>
          scheduleRefresh(identity)
        )
        entry.gitDirWatcher.on('error', () => {
          /* ignore — falls back to manual refresh */
        })
      } catch {
        /* ignore */
      }
    }

    // Seed snapshot + worktree-level watchers. If git is transiently failing,
    // start with an empty snapshot rather than tearing down sidecar state.
    const snapshot = await listWorktreesWithStatus(canonical)
    if (snapshot !== null) {
      entry.lastSnapshot = snapshot
      rebindWorktreeWatchers(identity, snapshot)
      emit({ repoRoot: identity, worktrees: snapshot })
    } else {
      emit({ repoRoot: identity, worktrees: [] })
    }
  } else {
    // Emit cached snapshot to the newcomer without rescanning.
    emit({ repoRoot: identity, worktrees: entry.lastSnapshot })
  }

  return { token, repoRoot: identity }
}

export function unwatchRepo(token: WorktreeSubscriptionToken): void {
  const sub = subscriptions.get(token)
  if (!sub) return
  subscriptions.delete(token)

  // If no subscribers remain for this repo, tear down watchers.
  const stillSubscribed = [...subscriptions.values()].some((s) => s.identity === sub.identity)
  if (stillSubscribed) return

  const entry = watchers.get(sub.identity)
  if (!entry) return
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
  try {
    entry.gitDirWatcher?.close()
  } catch {
    /* ignore */
  }
  for (const w of entry.worktreeWatchers.values()) {
    try {
      w.close()
    } catch {
      /* ignore */
    }
  }
  watchers.delete(sub.identity)
}

/** Manual refresh — used by "refresh on window focus" fallback. */
export async function refreshRepo(repoRoot: string): Promise<void> {
  const canonical = await realpath(repoRoot)
  const identity = (await resolveIdentity(canonical)) ?? canonical
  await refreshAndEmit(identity, canonical)
}

/** Stop everything — call on app shutdown. */
export function stopAll(): void {
  for (const entry of watchers.values()) {
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
    try {
      entry.gitDirWatcher?.close()
    } catch {
      /* ignore */
    }
    for (const w of entry.worktreeWatchers.values()) {
      try {
        w.close()
      } catch {
        /* ignore */
      }
    }
  }
  watchers.clear()
  subscriptions.clear()
  repoQueues.clear()
}

// ── Internals ────────────────────────────────────────────────────────

function rebindWorktreeWatchers(identity: string, worktrees: WorktreeInfo[]): void {
  const entry = watchers.get(identity)
  if (!entry) return
  const needed = new Set(worktrees.map((w) => w.path))

  // Close watchers for worktrees that no longer exist.
  for (const [p, w] of entry.worktreeWatchers) {
    if (!needed.has(p)) {
      try {
        w.close()
      } catch {
        /* ignore */
      }
      entry.worktreeWatchers.delete(p)
    }
  }

  // Add watchers for new worktrees.
  //
  // Note: `recursive: true` works on macOS and Windows, but Node's fs.watch
  // does NOT support recursive on Linux (it's silently ignored). On Linux we
  // fall back to a shallow watch + the window-focus manual refresh path
  // (refreshRepo) to catch nested edits. Watching the whole tree recursively
  // on Linux would require a third-party native watcher (chokidar etc.) and
  // was deemed out of scope.
  const recursive = process.platform === 'darwin' || process.platform === 'win32'
  for (const w of worktrees) {
    if (entry.worktreeWatchers.has(w.path)) continue
    try {
      const watcher = fs.watch(w.path, { persistent: false, recursive }, () =>
        scheduleRefresh(identity)
      )
      watcher.on('error', () => {
        /* ignore */
      })
      entry.worktreeWatchers.set(w.path, watcher)
    } catch {
      /* ignore */
    }
  }
}

function scheduleRefresh(identity: string): void {
  const entry = watchers.get(identity)
  if (!entry) return
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
  entry.debounceTimer = setTimeout(() => {
    entry.debounceTimer = null
    // Use the identity itself as the git command cwd — it is the main
    // checkout root, which `git worktree list` accepts.
    void refreshAndEmit(identity, identity)
  }, 250)
}

async function refreshAndEmit(
  identity: string,
  gitCwd: string,
  changedPaths?: string[]
): Promise<WorktreeInfo[]> {
  const worktrees = await listWorktreesWithStatus(gitCwd)
  if (worktrees === null) {
    // Transient git failure — keep last snapshot intact, don't reconcile,
    // don't emit (nothing changed from the subscriber's POV).
    return watchers.get(identity)?.lastSnapshot ?? []
  }
  await reconcile(
    identity,
    worktrees.map((w) => w.path)
  )
  const entry = watchers.get(identity)
  if (entry) {
    entry.lastSnapshot = worktrees
    rebindWorktreeWatchers(identity, worktrees)
  }
  emitToIdentity(identity, { repoRoot: identity, worktrees, changedPaths })
  return worktrees
}

function emitToIdentity(identity: string, payload: WorktreesChangedPayload): void {
  for (const sub of subscriptions.values()) {
    if (sub.identity === identity) {
      try {
        sub.emit(payload)
      } catch {
        /* subscriber threw — isolate */
      }
    }
  }
}

// ── Error mapping ────────────────────────────────────────────────────

function mapAddError(stderr: string): WorktreeError {
  const s = stderr.toLowerCase()
  if (s.includes('already exists')) return worktreeError('PATH_EXISTS', stderr.trim())
  if (s.includes('already checked out') || s.includes('is already used by worktree')) {
    return worktreeError('BRANCH_ALREADY_CHECKED_OUT', stderr.trim())
  }
  if (s.includes('permission denied')) return worktreeError('PERMISSION_DENIED', stderr.trim())
  if (s.includes('read-only') || s.includes('readonly'))
    return worktreeError('READ_ONLY_FS', stderr.trim())
  return worktreeError('UNKNOWN', stderr.trim() || 'git worktree add failed')
}

function mapRemoveError(stderr: string): WorktreeError {
  const s = stderr.toLowerCase()
  if (s.includes('not a working tree')) return worktreeError('WORKTREE_NOT_FOUND', stderr.trim())
  if (s.includes('permission denied')) return worktreeError('PERMISSION_DENIED', stderr.trim())
  return worktreeError('UNKNOWN', stderr.trim() || 'git worktree remove failed')
}

/**
 * Record setup-script completion for a worktree. Resolves the repo identity
 * internally so callers don't need to know the main-checkout path.
 */
export async function recordSetupResult(
  repoRoot: string,
  worktreePath: string,
  exitCode: number
): Promise<void> {
  const identity = (await resolveIdentity(repoRoot)) ?? (await realpath(repoRoot))
  const canonical = await realpath(worktreePath)
  const existing = getEntry(identity, canonical)
  if (!existing) return
  await upsertEntry(identity, canonical, {
    ...existing,
    lastSetupRunAt: new Date().toISOString(),
    lastSetupExitCode: exitCode
  })
}
