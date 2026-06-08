/**
 * Shared types for the project-bounded file explorer service.
 *
 * Unlike the diff service (which is keyed by git-relative `gitPath` and
 * expands to the containing repo root), the explorer is bounded to a single
 * project directory. Paths are POSIX-style, forward-slash, project-root
 * relative (`relPath`), with `''` denoting the root itself.
 */

export type FsEntryType = 'dir' | 'file'

export interface FsEntry {
  /** Base name (no slashes). */
  name: string
  /** Project-root-relative POSIX path (no leading slash). */
  relPath: string
  type: FsEntryType
  /** True when the entry is (or points through) a symbolic link. */
  isSymlink: boolean
}

export interface ListDirResult {
  ok: boolean
  entries: FsEntry[]
  code?: FsErrorCode
  message?: string
}

export interface ReadFileResult {
  ok: boolean
  content: string
  eol: '\n' | '\r\n'
  mtimeMs: number
  sizeBytes: number
  isBinary: boolean
  truncated: boolean
  code?: FsErrorCode
  message?: string
}

export interface WriteFileResult {
  ok: boolean
  mtimeMs?: number
  code?: FsErrorCode
  message?: string
}

export interface FsMutationResult {
  ok: boolean
  /** New project-relative path for create/rename ops. */
  relPath?: string
  code?: FsErrorCode
  message?: string
}

export type FsErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'NOT_A_DIRECTORY'
  | 'IS_A_DIRECTORY'
  | 'EXISTS'
  | 'STALE_FILE'
  | 'TOO_LARGE'
  | 'BINARY'
  | 'IO_ERROR'
