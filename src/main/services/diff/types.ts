/**
 * Shared types for the diff viewer feature.
 *
 * Path discipline (enforced by naming):
 *  - `repoRootFs`: absolute OS path of the repo / worktree root.
 *  - `gitPath`:    repo-relative POSIX path (slash-separated) — exactly
 *                  what git emits in `status`/`diff --name-only`.
 *  - `fsPath`:     `path.join(repoRootFs, ...gitPath.split('/'))` — used
 *                  for filesystem reads/writes only.
 *
 * Renderer code consumes `gitPath` for display & lookups; `fsPath` is
 * only constructed in main when actually reading a working file.
 */

/** Single-letter git status code (porcelain v2 / name-status). */
export type GitStatusCode =
  | '.' // unchanged
  | 'M' // modified
  | 'A' // added
  | 'D' // deleted
  | 'R' // renamed
  | 'C' // copied
  | 'T' // typechange
  | 'U' // unmerged (conflict)
  | '?' // untracked
  | '!' // ignored

/** A file appearing in a change list. */
export interface ChangedFile {
  /** Repo-relative POSIX path (current name). */
  gitPath: string
  /** Previous repo-relative POSIX path for renames/copies. */
  oldGitPath?: string
  /** HEAD ↔ index status (the "staged" column). `.` = unchanged. */
  headStatus: GitStatusCode
  /** Index ↔ working-tree status (the "unstaged" column). `.` = unchanged. */
  wtStatus: GitStatusCode
  /** Rename/copy score percentage (0–100). */
  similarity?: number
  /** True for binary files (per-file content load will return empty texts). */
  isBinary?: boolean
  /** Working-tree size in bytes (when known). Used for size-cap decisions. */
  sizeBytes?: number
  /** True when the file is currently in conflict (XY contains `U`/`AA`/`DD`). */
  isConflict?: boolean
}

/**
 * Working-tree-vs-HEAD scope returns BOTH "Staged" and "Changes" sections —
 * a file may appear in both with different statuses (partial stage). The
 * branch-vs-base and commit scopes return a single flat list.
 *
 * `commit` scope diffs a single commit against its first parent (`sha^..sha`),
 * or against the empty tree for a root commit. It is always read-only.
 */
export type DiffScope =
  | { kind: 'workingTree' }
  | { kind: 'branch'; base: string; resolvedRef?: string }
  | { kind: 'commit'; sha: string }

export interface ChangeListResult {
  files: ChangedFile[]
  /** True when the result was capped (more files exist on disk). */
  truncated: boolean
  /** Total file count BEFORE truncation (informational). */
  totalCount: number
}

/** What side of a file diff the renderer asks for. */
export interface FileDiffRequest {
  repoRootFs: string
  scope: DiffScope
  /** The change record for the file (need oldGitPath + statuses). */
  file: ChangedFile
  /** When true, return content for the HEAD↔index pair (Staged Changes
   *  section); otherwise return content for the index↔WT pair (Changes
   *  section). Ignored for branch scope. */
  staged?: boolean
}

export interface FileDiffContent {
  /** "HEAD" / "<base>" / "index" / "" (untracked add) */
  leftRef: string
  /** "index" / "HEAD" / "WORKTREE" / "" (deleted) */
  rightRef: string
  /** Repo-relative POSIX path used to fetch left text (handles renames). */
  leftGitPath: string | null
  rightGitPath: string | null
  leftText: string
  rightText: string
  leftIsEmpty: boolean
  rightIsEmpty: boolean
  isBinary: boolean
  /** True when either side exceeded the 2 MB size cap. */
  truncated: boolean
  /** Mtime in ms of the working file at read time (used for race checks). */
  rightMtimeMs?: number
  /** Blob OID (hex) for the canonical "left" version (used for race checks). */
  leftBlobOid?: string
  /** Detected line-ending style of the working file ("\n" | "\r\n"). */
  eol?: '\n' | '\r\n'
}

/** Inputs for hunk-level SCM mutations (working-tree scope only). */
export interface HunkMutationRequest {
  repoRootFs: string
  /** "stage" = move hunk index→WT into the index;
   *  "unstage" = move hunk HEAD→index back to working tree;
   *  "discard" = throw away hunk index→WT change (unstaged) — destructive;
   *  "revert"  = throw away hunk HEAD→WT change entirely — destructive.    */
  action: 'stage' | 'unstage' | 'discard' | 'revert'
  file: ChangedFile
  /** Pre-image (left) text the renderer used to compute hunkLines. */
  originalText: string
  /** Post-image (right) text the renderer used to compute hunkLines. */
  modifiedText: string
  /** 1-based inclusive line ranges in `modifiedText` selected for the action. */
  hunkLines: Array<{ startLine: number; endLine: number }>
  /** Race check: blob OID we expected when the diff was loaded. */
  expectedLeftBlobOid?: string
  /** Race check: working-file mtime (ms) we expected. */
  expectedRightMtimeMs?: number
}

export interface MutationResult {
  ok: boolean
  /** When `ok=false`, a stable error code for the renderer to act on. */
  code?:
    | 'STALE_DIFF'
    | 'CONFLICT'
    | 'BINARY_NOT_SUPPORTED'
    | 'INVALID_INPUT'
    | 'GIT_APPLY_FAILED'
    | 'IO_ERROR'
    | 'UNKNOWN'
  message?: string
}

/**
 * Repo-level status used by the Git panel to render an empty/error state.
 * Computed cheaply (a few git rev-parse calls + a couple of fs.stat checks).
 */
export type RepoStatusKind =
  /** Healthy git repo on a normal branch. */
  | 'ok'
  /** Path exists but is not (or no longer) a git repo / worktree. */
  | 'not-a-repo'
  /** Path does not exist on disk. */
  | 'missing-path'
  /** Repo is healthy but HEAD is detached. */
  | 'detached-head'
  /** Mid-merge (`.git/MERGE_HEAD` present). */
  | 'merge'
  /** Mid-rebase (interactive or apply). */
  | 'rebase'
  /** Mid-cherry-pick (`.git/CHERRY_PICK_HEAD` present). */
  | 'cherry-pick'
  /** Mid-bisect (`.git/BISECT_LOG` present). */
  | 'bisect'
  /** Anything else — `message` carries details. */
  | 'error'

export interface RepoStatus {
  kind: RepoStatusKind
  /** Short branch name when on a branch. */
  headRef?: string
  /** True when HEAD is detached. */
  isDetached?: boolean
  /** In-progress operation, when applicable. */
  operation?: 'merge' | 'rebase' | 'cherry-pick' | 'bisect'
  /** Human-readable detail (only populated for `error`). */
  message?: string
}

// ── Commit graph (history) ─────────────────────────────────────────

/** A ref label decorating a commit (branch / remote branch / tag / HEAD). */
export interface CommitRef {
  /** Short, display-ready name (e.g. `main`, `origin/main`, `v1.2.0`). */
  name: string
  kind: 'head' | 'localBranch' | 'remoteBranch' | 'tag'
}

/** A single commit in the history graph. Topology is encoded via `parents`. */
export interface CommitGraphEntry {
  /** Full 40-char commit SHA. */
  sha: string
  /** Abbreviated SHA (git's default short form). */
  shortSha: string
  /** Parent SHAs in order. Empty for a root commit; >1 for a merge. */
  parents: string[]
  /** Commit subject (first line of the message). */
  subject: string
  authorName: string
  authorEmail: string
  /** Author date in epoch milliseconds. */
  authorDate: number
  /** Ref labels pointing at this commit (may be empty). */
  refs: CommitRef[]
}

export interface CommitGraphResult {
  commits: CommitGraphEntry[]
  /** True when more commits exist beyond this page (caller can load more). */
  hasMore: boolean
}

/** Options for paginating the commit graph. */
export interface CommitGraphOptions {
  /** Max commits to return (page size). */
  limit: number
  /** Number of commits to skip (for pagination). */
  skip?: number
}
