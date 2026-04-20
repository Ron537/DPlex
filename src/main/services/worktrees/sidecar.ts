/**
 * DPlex-owned worktree sidecar.
 *
 * Git itself is the source of truth for which worktrees exist. This sidecar only
 * stores provenance we can't derive from git:
 *   - did DPlex create this worktree? (enables safer auto-cleanup later)
 *   - when, and from which base branch?
 *   - last setup script run result (informational)
 *
 * Storage: userData/worktrees.json
 * Schema (v1):
 *   {
 *     "schemaVersion": 1,
 *     "entries": {
 *       "<repoIdentity>::<canonicalWorktreePath>": {
 *         "createdByDplex": true,
 *         "createdAt": "<iso>",
 *         "baseBranch": "main",
 *         "initialBranch": "feature/auth",
 *         "lastSetupRunAt": "<iso>?",
 *         "lastSetupExitCode": 0
 *       }
 *     }
 *   }
 *
 * The repo-identity component is the canonical main-checkout path as returned
 * by `gitService.getRepoIdentity`. Callers in this module never synthesize the
 * key themselves — they pass whichever path they have and we resolve it first.
 *
 * Concurrency model:
 *   - An in-memory cache holds the parsed file. It is loaded on first use.
 *   - All reads and writes go through a single module-level promise chain so
 *     that concurrent upserts/removes/reconciles never race the file on disk.
 *   - Writes are atomic (write-to-tmp + rename).
 */

import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'
import { app } from 'electron'

export interface WorktreeSidecarEntry {
  createdByDplex: boolean
  createdAt: string
  baseBranch: string | null
  initialBranch: string | null
  lastSetupRunAt?: string
  lastSetupExitCode?: number
}

interface SidecarFile {
  schemaVersion: number
  entries: Record<string, WorktreeSidecarEntry>
}

const SCHEMA_VERSION = 1

let cache: SidecarFile | null = null
let opChain: Promise<unknown> = Promise.resolve()

function sidecarPath(): string {
  return path.join(app.getPath('userData'), 'worktrees.json')
}

function keyOf(repoIdentity: string, worktreePath: string): string {
  return `${repoIdentity}::${worktreePath}`
}

function loadFromDisk(): SidecarFile {
  try {
    const p = sidecarPath()
    if (!fs.existsSync(p)) return { schemaVersion: SCHEMA_VERSION, entries: {} }
    const raw = fs.readFileSync(p, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<SidecarFile>
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.entries &&
      typeof parsed.entries === 'object'
    ) {
      return {
        schemaVersion:
          typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : SCHEMA_VERSION,
        entries: parsed.entries as Record<string, WorktreeSidecarEntry>
      }
    }
  } catch {
    // Corrupted file — start fresh
  }
  return { schemaVersion: SCHEMA_VERSION, entries: {} }
}

function ensureCache(): SidecarFile {
  if (cache === null) cache = loadFromDisk()
  return cache
}

async function persist(): Promise<void> {
  if (cache === null) return
  try {
    const p = sidecarPath()
    const tmp = p + '.tmp'
    await fsp.writeFile(tmp, JSON.stringify(cache, null, 2))
    await fsp.rename(tmp, p)
  } catch {
    // Best-effort — sidecar loss downgrades features but doesn't break the app.
  }
}

/**
 * Serialize a sidecar operation. Returns a promise that resolves when the
 * operation has completed (including disk flush for mutations).
 *
 * All sidecar exports are convenience wrappers around this so that no two
 * writes ever interleave, even across different repos.
 */
function enqueue<T>(fn: () => T | Promise<T>): Promise<T> {
  const next = opChain.then(fn, fn)
  opChain = next.catch(() => undefined)
  return next
}

export function getEntry(
  repoIdentity: string,
  worktreePath: string
): WorktreeSidecarEntry | null {
  const file = ensureCache()
  return file.entries[keyOf(repoIdentity, worktreePath)] ?? null
}

export function upsertEntry(
  repoIdentity: string,
  worktreePath: string,
  entry: WorktreeSidecarEntry
): Promise<void> {
  return enqueue(async () => {
    const file = ensureCache()
    file.entries[keyOf(repoIdentity, worktreePath)] = entry
    await persist()
  })
}

export function removeEntry(repoIdentity: string, worktreePath: string): Promise<void> {
  return enqueue(async () => {
    const file = ensureCache()
    const key = keyOf(repoIdentity, worktreePath)
    if (file.entries[key]) {
      delete file.entries[key]
      await persist()
    }
  })
}

/**
 * Prune sidecar entries whose worktree path is not in `livePaths` for the given repo.
 * Called after every successful list refresh so stale metadata never accumulates.
 *
 * NOTE: Callers MUST only invoke this when they have an authoritative list from
 * git. Passing an empty `livePaths` after a transient git failure would wipe
 * every entry for the repo.
 */
export function reconcile(repoIdentity: string, livePaths: string[]): Promise<void> {
  return enqueue(async () => {
    const file = ensureCache()
    const live = new Set(livePaths)
    const prefix = `${repoIdentity}::`
    let mutated = false
    for (const key of Object.keys(file.entries)) {
      if (!key.startsWith(prefix)) continue
      const p = key.slice(prefix.length)
      if (!live.has(p)) {
        delete file.entries[key]
        mutated = true
      }
    }
    if (mutated) await persist()
  })
}

/**
 * Read all entries for a repo — used by the list layer to enrich each worktree
 * without N individual disk reads.
 */
export function getEntriesForRepo(
  repoIdentity: string
): Map<string, WorktreeSidecarEntry> {
  const file = ensureCache()
  const out = new Map<string, WorktreeSidecarEntry>()
  const prefix = `${repoIdentity}::`
  for (const [key, value] of Object.entries(file.entries)) {
    if (key.startsWith(prefix)) {
      out.set(key.slice(prefix.length), value)
    }
  }
  return out
}

/**
 * Test-only hook. Resets the in-memory cache so subsequent calls reload from
 * disk. Safe to call at any time — the next op will trigger a fresh read.
 */
export function __resetCacheForTests(): void {
  cache = null
}
