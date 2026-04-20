/**
 * Shared types for the worktree service.
 *
 * Naming convention: all paths stored in these structures are canonical
 * (realpath-resolved + path.resolve'd). Callers receiving these values can
 * safely compare them by string equality.
 */

export type WorktreeErrorCode =
  | 'NOT_A_GIT_REPO'
  | 'BRANCH_ALREADY_CHECKED_OUT'
  | 'PATH_EXISTS'
  | 'WORKTREE_NOT_FOUND'
  | 'BRANCH_HAS_UNPUSHED_COMMITS'
  | 'BRANCH_NO_UPSTREAM'
  | 'BRANCH_IS_CHECKED_OUT'
  | 'READ_ONLY_FS'
  | 'PERMISSION_DENIED'
  | 'SETUP_CANCELLED'
  | 'OPERATION_SUPERSEDED'
  | 'IS_MAIN_CHECKOUT'
  | 'INVALID_ARGUMENT'
  | 'UNKNOWN'

export interface WorktreeError {
  code: WorktreeErrorCode
  message: string
  details?: unknown
}

export function isWorktreeError(value: unknown): value is WorktreeError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as WorktreeError).code === 'string' &&
    typeof (value as WorktreeError).message === 'string'
  )
}

export function worktreeError(
  code: WorktreeErrorCode,
  message: string,
  details?: unknown
): WorktreeError {
  return { code, message, details }
}

/**
 * Status of a single worktree, composed from git + filesystem probes.
 * All numeric fields default to 0; null indicates the value could not be computed.
 */
export interface WorktreeStatus {
  dirtyCount: number | null
  untrackedCount: number | null
  stagedCount: number | null
  ahead: number | null
  behind: number | null
  upstream: string | null
}

export interface WorktreeInfo {
  /** Canonical absolute path (realpath + resolve). */
  path: string
  /** Short branch name (without refs/heads/), or null for detached HEAD. */
  branch: string | null
  /** Short commit SHA (7 chars) — always present. */
  head: string
  /** True if the worktree is in detached-HEAD state. */
  detached: boolean
  /** True if the worktree is the main checkout of its repo. */
  isMain: boolean
  /** True if git reports this worktree as prunable (path no longer exists / locked removal). */
  prunable: boolean
  /** True if we created this worktree via DPlex (from sidecar). */
  createdByDplex: boolean
  /** ISO timestamp when DPlex created the worktree (from sidecar). */
  createdAt: string | null
  /** Base branch DPlex used at creation time (from sidecar). */
  baseBranch: string | null
  /** Enriched status. */
  status: WorktreeStatus
}

/**
 * Options for creating a new worktree.
 */
export interface CreateWorktreeOptions {
  /** Canonical path of the git repo root (main checkout). */
  repoRoot: string
  /** Desired branch name for the worktree. */
  branch: string
  /** If true, create a new branch from `baseBranch`; if false, check out an existing branch. */
  newBranch: boolean
  /** Base branch for new-branch mode (ignored when newBranch is false). */
  baseBranch: string | null
  /** Absolute (or repo-relative) path where the worktree should live. */
  worktreePath: string
  /**
   * Optional list of env file patterns (relative to repoRoot) to copy into the
   * new worktree. Globs are expanded simply (trailing `*` only).
   */
  envFiles?: string[]
  /** Track this worktree in the DPlex sidecar as "created by DPlex". */
  trackInSidecar?: boolean
}

export interface CreateWorktreeResult {
  worktree: WorktreeInfo
  opId: string
}

export interface DeleteWorktreeOptions {
  /** Canonical repo root. */
  repoRoot: string
  /** Canonical worktree path to delete. */
  worktreePath: string
  /** Pass --force to `git worktree remove` (required if worktree is dirty). */
  force: boolean
  /** Also run `git branch -d/-D` on the worktree's branch after removal. */
  deleteBranch: boolean
  /** If set, force-delete the branch (skip the "not merged" safety check). */
  forceDeleteBranch?: boolean
}

/**
 * Successful delete. `warning` is non-null when the worktree was removed but
 * an optional follow-up step (e.g. branch deletion) was skipped or failed.
 */
export interface DeleteWorktreeResult {
  ok: true
  warning: WorktreeError | null
}

/**
 * Subscription token returned by watchRepo. Callers must pass this same token
 * to unwatchRepo so multiple consumers can coexist without tearing down each
 * other's subscriptions.
 */
export type WorktreeSubscriptionToken = string

export interface WorktreesChangedPayload {
  repoRoot: string
  worktrees: WorktreeInfo[]
  /** Paths of worktrees whose data changed in this update (optional hint). */
  changedPaths?: string[]
}
