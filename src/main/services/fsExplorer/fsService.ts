/**
 * Project-bounded filesystem operations backing the file explorer.
 *
 * Every public function takes an already-validated project `root` (from
 * `safeProjectRoot`) plus a renderer `relPath`, and routes through
 * `resolveInsideRoot` so no operation can touch anything outside the project
 * directory or the refused `.git` segments. All returned paths are POSIX,
 * project-root relative.
 */

import * as fs from 'fs'
import * as path from 'path'
import { resolveInsideRoot, normalizeRelPath, isDotGitSegment } from './pathSafety'
import type {
  FsEntry,
  ListDirResult,
  ReadFileResult,
  WriteFileResult,
  FsMutationResult
} from './types'

/** Max editable file size (2 MB). Matches the diff service cap. */
export const MAX_CONTENT_BYTES = 2 * 1024 * 1024
/** Tolerance for the optimistic-concurrency mtime check (filesystem jitter). */
const MTIME_TOLERANCE_MS = 1500

function toRelPosix(root: string, fsPath: string): string {
  return path.relative(root, fsPath).split(path.sep).join('/')
}

function joinRel(parentRel: string, name: string): string {
  return parentRel ? `${parentRel}/${name}` : name
}

/** List the direct children of a directory (root `.git` is omitted). */
export async function listDir(root: string, relPath: unknown): Promise<ListDirResult> {
  const dirPath = await resolveInsideRoot(root, relPath, { mustExist: true })
  if (dirPath === null) return { ok: false, entries: [], code: 'INVALID_INPUT' }
  const rel = normalizeRelPath(relPath) ?? ''
  let dirents: fs.Dirent[]
  try {
    const stat = await fs.promises.stat(dirPath)
    if (!stat.isDirectory()) return { ok: false, entries: [], code: 'NOT_A_DIRECTORY' }
    dirents = await fs.promises.readdir(dirPath, { withFileTypes: true })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'NOT_FOUND' : 'IO_ERROR'
    return { ok: false, entries: [], code, message: errMessage(err) }
  }

  const entries: FsEntry[] = []
  for (const d of dirents) {
    // Refuse `.git` only at the project root — nested `.git` dirs (submodules)
    // are likewise skipped to avoid surfacing git internals. Case-insensitive
    // on APFS/NTFS where `.GIT` aliases `.git`.
    if (isDotGitSegment(d.name)) continue
    const isSymlink = d.isSymbolicLink()
    let isDir = d.isDirectory()
    // Resolve the kind through a symlink so the tree shows the right affordance.
    if (isSymlink) {
      try {
        const st = await fs.promises.stat(path.join(dirPath, d.name))
        isDir = st.isDirectory()
      } catch {
        isDir = false
      }
    }
    entries.push({
      name: d.name,
      relPath: joinRel(rel, d.name),
      type: isDir ? 'dir' : 'file',
      isSymlink
    })
  }

  entries.sort(compareEntries)
  return { ok: true, entries }
}

/** Directories first, then files; case-insensitive, locale-aware by name. */
function compareEntries(a: FsEntry, b: FsEntry): number {
  if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'accent', numeric: true })
}

/** Read a file's text content with binary/size guards and EOL detection. */
export async function readFile(root: string, relPath: unknown): Promise<ReadFileResult> {
  const fsPath = await resolveInsideRoot(root, relPath, { mustExist: true })
  if (fsPath === null) return readError('INVALID_INPUT')
  try {
    const stat = await fs.promises.stat(fsPath)
    if (stat.isDirectory()) return readError('IS_A_DIRECTORY')
    const sizeBytes = stat.size
    if (sizeBytes > MAX_CONTENT_BYTES) {
      return {
        ok: true,
        content: '',
        eol: '\n',
        mtimeMs: stat.mtimeMs,
        sizeBytes,
        isBinary: false,
        truncated: true
      }
    }
    const buf = await fs.promises.readFile(fsPath)
    // Heuristic: a NUL byte in the first 8 KB means binary.
    const sample = buf.subarray(0, 8192)
    const isBinary = sample.includes(0)
    if (isBinary) {
      return {
        ok: true,
        content: '',
        eol: '\n',
        mtimeMs: stat.mtimeMs,
        sizeBytes,
        isBinary: true,
        truncated: false
      }
    }
    // CRLF only when a real `\r\n` pair occurs — a lone stray `\r` must not
    // flip the whole file to CRLF (a save would then rewrite every LF).
    const eol: '\n' | '\r\n' = buf.includes('\r\n') ? '\r\n' : '\n'
    return {
      ok: true,
      content: buf.toString('utf8'),
      eol,
      mtimeMs: stat.mtimeMs,
      sizeBytes,
      isBinary: false,
      truncated: false
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'NOT_FOUND' : 'IO_ERROR'
    return readError(code, errMessage(err))
  }
}

/**
 * Write `content` to a file, normalizing line endings to `eol`. When
 * `expectedMtimeMs` is supplied, the write is refused (`STALE_FILE`) if the
 * on-disk mtime has drifted beyond tolerance — optimistic concurrency to avoid
 * clobbering edits made outside the app.
 */
export async function writeFile(
  root: string,
  relPath: unknown,
  content: string,
  eol: '\n' | '\r\n',
  expectedMtimeMs?: number
): Promise<WriteFileResult> {
  if (typeof content !== 'string' || (eol !== '\n' && eol !== '\r\n')) {
    return { ok: false, code: 'INVALID_INPUT' }
  }
  const fsPath = await resolveInsideRoot(root, relPath)
  if (fsPath === null) return { ok: false, code: 'INVALID_INPUT' }
  try {
    if (typeof expectedMtimeMs === 'number') {
      const stat = await fs.promises.stat(fsPath).catch(() => null)
      if (!stat || Math.abs(stat.mtimeMs - expectedMtimeMs) > MTIME_TOLERANCE_MS) {
        return { ok: false, code: 'STALE_FILE' }
      }
    }
    const normalized = content.replace(/\r\n/g, '\n')
    const out = eol === '\r\n' ? normalized.replace(/\n/g, '\r\n') : normalized
    await fs.promises.writeFile(fsPath, out, 'utf8')
    const after = await fs.promises.stat(fsPath)
    return { ok: true, mtimeMs: after.mtimeMs }
  } catch (err) {
    return { ok: false, code: 'IO_ERROR', message: errMessage(err) }
  }
}

/** Create a new empty file. Fails if anything already exists at the path. */
export async function createFile(root: string, relPath: unknown): Promise<FsMutationResult> {
  const fsPath = await resolveInsideRoot(root, relPath)
  if (fsPath === null || fsPath === root) return { ok: false, code: 'INVALID_INPUT' }
  try {
    // Mirror createDir/rename: ensure the parent exists so callers get
    // consistent behavior (not a surprise ENOENT) for nested creates.
    await fs.promises.mkdir(path.dirname(fsPath), { recursive: true })
    // 'wx' — fail if the path exists.
    const handle = await fs.promises.open(fsPath, 'wx')
    await handle.close()
    return { ok: true, relPath: toRelPosix(root, fsPath) }
  } catch (err) {
    return mutationError(err)
  }
}

/** Create a new directory (and missing parents within the root). */
export async function createDir(root: string, relPath: unknown): Promise<FsMutationResult> {
  const fsPath = await resolveInsideRoot(root, relPath)
  if (fsPath === null || fsPath === root) return { ok: false, code: 'INVALID_INPUT' }
  try {
    const exists = await fs.promises.stat(fsPath).catch(() => null)
    if (exists) return { ok: false, code: 'EXISTS' }
    await fs.promises.mkdir(fsPath, { recursive: true })
    return { ok: true, relPath: toRelPosix(root, fsPath) }
  } catch (err) {
    return mutationError(err)
  }
}

/** Rename/move a file or directory within the project root. */
export async function rename(
  root: string,
  fromRelPath: unknown,
  toRelPath: unknown
): Promise<FsMutationResult> {
  const fromPath = await resolveInsideRoot(root, fromRelPath, { mustExist: true })
  const toPath = await resolveInsideRoot(root, toRelPath)
  if (fromPath === null || toPath === null || fromPath === root || toPath === root) {
    return { ok: false, code: 'INVALID_INPUT' }
  }
  try {
    const dest = await fs.promises.stat(toPath).catch(() => null)
    if (dest) return { ok: false, code: 'EXISTS' }
    await fs.promises.mkdir(path.dirname(toPath), { recursive: true })
    await fs.promises.rename(fromPath, toPath)
    return { ok: true, relPath: toRelPosix(root, toPath) }
  } catch (err) {
    return mutationError(err)
  }
}

/** Delete a file or directory (recursive) within the project root. */
export async function deletePath(root: string, relPath: unknown): Promise<FsMutationResult> {
  const fsPath = await resolveInsideRoot(root, relPath, { mustExist: true })
  if (fsPath === null || fsPath === root) return { ok: false, code: 'INVALID_INPUT' }
  try {
    await fs.promises.rm(fsPath, { recursive: true, force: false })
    return { ok: true, relPath: toRelPosix(root, fsPath) }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'NOT_FOUND' : 'IO_ERROR'
    return { ok: false, code, message: errMessage(err) }
  }
}

function readError(code: ReadFileResult['code'], message?: string): ReadFileResult {
  return {
    ok: false,
    content: '',
    eol: '\n',
    mtimeMs: 0,
    sizeBytes: 0,
    isBinary: false,
    truncated: false,
    code,
    message
  }
}

function mutationError(err: unknown): FsMutationResult {
  const e = err as NodeJS.ErrnoException
  if (e?.code === 'EEXIST') return { ok: false, code: 'EXISTS' }
  if (e?.code === 'ENOENT') return { ok: false, code: 'NOT_FOUND' }
  return { ok: false, code: 'IO_ERROR', message: errMessage(err) }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
