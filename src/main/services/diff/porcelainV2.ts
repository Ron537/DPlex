/**
 * Parser for `git status --porcelain=v2 -z --untracked-files=normal`.
 *
 * Pure functions, no I/O — safe to unit test in isolation.
 *
 * Format reference: git-status(1) "Porcelain Format Version 2".
 *  Type 1 (ordinary):
 *    "1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>"
 *  Type 2 (rename/copy):
 *    "2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\0<origPath>"
 *  Type u (unmerged):
 *    "u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>"
 *  Type ? (untracked): "? <path>"
 *  Type ! (ignored):   "! <path>"
 *
 * With `-z`, every record is terminated by NUL. For type-2 records, the
 * path field internally contains a NUL between <path> and <origPath>, so
 * a single record consumes TWO NUL-separated chunks from the stream.
 */

import type { ChangedFile, GitStatusCode } from './types'

const STATUS_CHARS = new Set<GitStatusCode>(['.', 'M', 'A', 'D', 'R', 'C', 'T', 'U', '?', '!'])

function asStatus(ch: string): GitStatusCode {
  return STATUS_CHARS.has(ch as GitStatusCode) ? (ch as GitStatusCode) : '.'
}

/**
 * One file may produce TWO `ChangedFile` entries when partially staged
 * (e.g. XY=`MM` → one row in the Staged section, one row in Changes).
 * The caller decides which section each entry belongs in by inspecting
 * `headStatus` (Staged section if !== '.') and `wtStatus` (Changes section
 * if !== '.').
 */
export function parsePorcelainV2(stdout: string): ChangedFile[] {
  const files: ChangedFile[] = []
  if (stdout.length === 0) return files

  // Split by NUL — keep a cursor so type-2 can consume the next chunk too.
  // Trailing NUL produces a final empty chunk we ignore.
  const chunks = stdout.split('\0')
  let i = 0
  while (i < chunks.length) {
    const rec = chunks[i]
    i++
    if (!rec) continue

    const tag = rec[0]
    if (tag === '#') continue // header (shouldn't appear without --branch but be safe)

    if (tag === '1') {
      // "1 XY sub mH mI mW hH hI path"
      // Path may contain spaces — only split off the first 8 fields.
      const parsed = splitFields(rec, 8)
      if (!parsed) continue
      const xy = parsed.fields[1]
      const gitPath = parsed.rest
      const x = asStatus(xy[0] ?? '.')
      const y = asStatus(xy[1] ?? '.')
      files.push({
        gitPath,
        headStatus: x,
        wtStatus: y
      })
    } else if (tag === '2') {
      // "2 XY sub mH mI mW hH hI X<score> path\0origPath"
      const parsed = splitFields(rec, 9)
      if (!parsed) continue
      const xy = parsed.fields[1]
      const xscore = parsed.fields[8] // e.g. "R100" or "C75"
      const gitPath = parsed.rest
      // The "origPath" lives in the NEXT NUL-separated chunk per git docs.
      const oldGitPath = chunks[i] ?? ''
      i++
      const x = asStatus(xy[0] ?? '.')
      const y = asStatus(xy[1] ?? '.')
      const scoreNum = Number.parseInt(xscore.slice(1), 10)
      files.push({
        gitPath,
        oldGitPath: oldGitPath || undefined,
        headStatus: x,
        wtStatus: y,
        similarity: Number.isFinite(scoreNum) ? scoreNum : undefined
      })
    } else if (tag === 'u') {
      // Conflict — both sides "U"-ish. We surface a single ChangedFile with isConflict.
      const parsed = splitFields(rec, 10)
      if (!parsed) continue
      const xy = parsed.fields[1]
      const gitPath = parsed.rest
      files.push({
        gitPath,
        headStatus: asStatus(xy[0] ?? 'U'),
        wtStatus: asStatus(xy[1] ?? 'U'),
        isConflict: true
      })
    } else if (tag === '?') {
      // "? path"
      const gitPath = rec.slice(2)
      if (!gitPath) continue
      files.push({
        gitPath,
        headStatus: '.',
        wtStatus: '?'
      })
    } else if (tag === '!') {
      // ignored — drop
      continue
    }
  }

  return files
}

/**
 * Split a porcelain-v2 record into the first `count` whitespace-separated
 * fields plus the remainder (which may contain spaces — i.e. the path).
 * Returns null if the record is too short.
 */
function splitFields(rec: string, count: number): { fields: string[]; rest: string } | null {
  const fields: string[] = []
  let pos = 0
  for (let f = 0; f < count; f++) {
    const sp = rec.indexOf(' ', pos)
    if (sp === -1) return null
    fields.push(rec.slice(pos, sp))
    pos = sp + 1
  }
  return { fields, rest: rec.slice(pos) }
}

/**
 * Parser for `git diff --name-status -z` and `git diff-tree --name-status -z`.
 *
 * Modern git (`-z`) emits each field as its own NUL-separated chunk:
 *   ordinary:    `<status>\0<path>\0`
 *   rename/copy: `R<score>\0<oldPath>\0<newPath>\0`
 * Older git emitted ordinary entries as a single `<status>\t<path>\0` chunk
 * (tab between status and path). We accept BOTH ordinary forms so the parser
 * is robust across git versions.
 */
export function parseNameStatusZ(stdout: string): ChangedFile[] {
  const files: ChangedFile[] = []
  if (stdout.length === 0) return files
  const chunks = stdout.split('\0')
  let i = 0
  while (i < chunks.length) {
    const head = chunks[i]
    i++
    if (!head) continue

    // Legacy ordinary form: "M\tpath" — status and path share one chunk.
    const tabIdx = head.indexOf('\t')
    if (tabIdx !== -1) {
      const code = head.slice(0, tabIdx)
      const gitPath = head.slice(tabIdx + 1)
      if (!gitPath) continue
      const status = asStatus(code[0] ?? '.')
      // For branch/commit scope, all changes are encoded in headStatus and
      // wtStatus is left '.'. Renderer flat list reads headStatus.
      files.push({ gitPath, headStatus: status, wtStatus: '.' })
    } else if (head[0] === 'R' || head[0] === 'C') {
      // Rename/copy: status chunk, then oldPath, then newPath.
      const oldGitPath = chunks[i] ?? ''
      i++
      const newGitPath = chunks[i] ?? ''
      i++
      if (!newGitPath) continue
      const scoreNum = Number.parseInt(head.slice(1), 10)
      files.push({
        gitPath: newGitPath,
        oldGitPath: oldGitPath || undefined,
        headStatus: asStatus(head[0]),
        wtStatus: '.',
        similarity: Number.isFinite(scoreNum) ? scoreNum : undefined
      })
    } else if (head.length === 1 && STATUS_CHARS.has(head as GitStatusCode)) {
      // Modern ordinary form: status chunk, path in the next chunk.
      const gitPath = chunks[i] ?? ''
      i++
      if (!gitPath) continue
      files.push({ gitPath, headStatus: asStatus(head), wtStatus: '.' })
    }
  }
  return files
}
