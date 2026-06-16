/**
 * Read-side of the commit-graph (history) feature: list commits with their
 * parent topology + ref decoration, and list the files changed by a single
 * commit. Pure data — graph layout (swim-lanes) is computed in the renderer.
 *
 * Path discipline mirrors `diffService.ts`: `repoRootFs` is treated as
 * already-realpath'd by the IPC layer; `gitPath` is POSIX/repo-relative.
 *
 * All git invocations use `-z` NUL framing so paths/messages containing
 * spaces, tabs, or newlines parse correctly and cross-platform.
 */

import { execGitRaw } from '../gitService'
import { parseNameStatusZ } from './porcelainV2'
import type {
  ChangeListResult,
  CommitGraphEntry,
  CommitGraphOptions,
  CommitGraphResult,
  CommitRef
} from './types'

/** Hard cap on commits returned in a single page, regardless of `limit`. */
const MAX_PAGE = 1000

/**
 * Field separator inside a single commit record. We use an ASCII Unit
 * Separator (0x1f) which cannot appear in SHAs, author fields, or a subject
 * (git collapses control chars in `%s`). Records themselves are NUL-framed
 * via `-z`, so a record may freely contain newlines without ambiguity.
 */
const FIELD_SEP = '\x1f'

/**
 * `git log` pretty format, field-separated. Order:
 *   sha, shortSha, parents (space-joined), authorName, authorEmail,
 *   authorDate (unix seconds), refs (%D), subject.
 * `%D` is the ref-decoration list WITHOUT surrounding parens.
 */
const LOG_FORMAT = ['%H', '%h', '%P', '%an', '%ae', '%at', '%D', '%s'].join(FIELD_SEP)

/**
 * List commits reachable from all refs (branches, remotes, tags, HEAD), in
 * reverse-chronological topo order, with parent SHAs and ref decoration.
 *
 * Paginates via `skip` + `limit`. To detect "has more", we request one extra
 * commit beyond `limit` and trim it.
 */
export async function getCommitGraph(
  repoRootFs: string,
  opts: CommitGraphOptions
): Promise<CommitGraphResult> {
  const limit = Math.max(1, Math.min(opts.limit, MAX_PAGE))
  const skip = Math.max(0, opts.skip ?? 0)

  // `--all` covers branches/remotes/tags; HEAD is implied. `--date-order`
  // keeps a stable, intuitive ordering for the graph layout. We over-fetch
  // by one to learn whether another page exists.
  const r = await execGitRaw(
    [
      'log',
      '--all',
      '--date-order',
      `--pretty=format:${LOG_FORMAT}`,
      '-z',
      `--max-count=${limit + 1}`,
      `--skip=${skip}`
    ],
    repoRootFs,
    30_000
  )
  if (r.code !== 0) return { commits: [], hasMore: false }

  const parsed = parseLog(r.stdout)
  const hasMore = parsed.length > limit
  const commits = hasMore ? parsed.slice(0, limit) : parsed
  return { commits, hasMore }
}

/**
 * Parse the NUL-framed `git log` output produced with {@link LOG_FORMAT}.
 * Exported for unit testing.
 */
export function parseLog(stdout: string): CommitGraphEntry[] {
  const out: CommitGraphEntry[] = []
  if (stdout.length === 0) return out
  // Records are NUL-separated; a trailing NUL yields a final empty record.
  for (const record of stdout.split('\0')) {
    if (record.length === 0) continue
    const fields = record.split(FIELD_SEP)
    if (fields.length < 8) continue
    const [sha, shortSha, parentsRaw, authorName, authorEmail, dateRaw, refsRaw] = fields
    // Subject is the last field; it may itself contain the separator only if
    // git emitted it (it won't — control chars are stripped from %s), but be
    // defensive and rejoin any trailing fields.
    const subject = fields.slice(7).join(FIELD_SEP)
    if (!sha) continue
    const parents = parentsRaw.length > 0 ? parentsRaw.split(' ').filter(Boolean) : []
    const seconds = Number.parseInt(dateRaw, 10)
    out.push({
      sha,
      shortSha,
      parents,
      subject,
      authorName,
      authorEmail,
      authorDate: Number.isFinite(seconds) ? seconds * 1000 : 0,
      refs: parseRefs(refsRaw)
    })
  }
  return out
}

/**
 * Parse git's `%D` ref-decoration string into structured refs.
 * Examples:
 *   "HEAD -> main, origin/main, tag: v1.0.0"
 *   "origin/HEAD, origin/main"
 * Exported for unit testing.
 */
export function parseRefs(raw: string): CommitRef[] {
  const refs: CommitRef[] = []
  const trimmed = raw.trim()
  if (trimmed.length === 0) return refs
  for (const partRaw of trimmed.split(',')) {
    let token = partRaw.trim()
    if (token.length === 0) continue

    // "HEAD -> main" — the symbolic HEAD plus the branch it points at.
    if (token.startsWith('HEAD -> ')) {
      refs.push({ name: 'HEAD', kind: 'head' })
      token = token.slice('HEAD -> '.length).trim()
      if (token.length === 0) continue
    }

    if (token === 'HEAD') {
      refs.push({ name: 'HEAD', kind: 'head' })
      continue
    }
    if (token.startsWith('tag: ')) {
      refs.push({ name: token.slice('tag: '.length).trim(), kind: 'tag' })
      continue
    }
    // Remote-tracking refs look like "origin/main"; skip the noisy
    // "origin/HEAD" alias which just mirrors the default branch.
    if (token.endsWith('/HEAD')) continue
    if (token.includes('/')) {
      refs.push({ name: token, kind: 'remoteBranch' })
      continue
    }
    refs.push({ name: token, kind: 'localBranch' })
  }
  return refs
}

/**
 * List the files changed by a single commit (vs its first parent; vs the
 * empty tree for a root commit). Reuses the shared name-status parser.
 *
 * `sha` must already be validated/sanitized by the IPC layer.
 */
export async function getCommitFiles(repoRootFs: string, sha: string): Promise<ChangeListResult> {
  // Compare the commit against its FIRST parent. `git diff-tree` ignores
  // `--first-parent` for a single commit (that flag only affects history
  // walks), and `-m` would emit the diff against *every* parent. So we use
  // the explicit two-arg range `<sha>^1 <sha>` for commits that have a parent,
  // and `--root <sha>` for a parentless (initial) commit so it lists its full
  // tree as additions.
  const parentRes = await execGitRaw(
    ['rev-parse', '--verify', '--quiet', `${sha}^1`],
    repoRootFs,
    5_000
  )
  const hasParent = parentRes.code === 0 && parentRes.stdout.trim().length > 0
  const baseArgs = ['diff-tree', '--no-commit-id', '--name-status', '-r', '-z', '--find-renames']
  const args = hasParent ? [...baseArgs, `${sha}^1`, sha] : [...baseArgs, '--root', sha]
  const r = await execGitRaw(args, repoRootFs, 30_000)
  if (r.code !== 0) return { files: [], truncated: false, totalCount: 0 }
  const files = parseNameStatusZ(r.stdout)
  return { files, truncated: false, totalCount: files.length }
}
