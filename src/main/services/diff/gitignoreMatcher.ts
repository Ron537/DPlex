/**
 * Builds a `.gitignore`-aware matcher used by `changesWatcher` to filter out
 * fs events under ignored paths (build artifacts, dependency caches, etc.)
 * before they trigger a `git status` refresh.
 *
 * Sources combined into one matcher (in git's precedence order, with later
 * entries overriding earlier ones via `ignore`'s last-rule-wins semantics):
 *   1. Built-in always-ignore set (`.git/`, `.DS_Store`, editor swap files).
 *   2. The user's global excludes file. Resolved via `git config --get
 *      core.excludesfile` if configured (and only that path is consulted in
 *      that case, matching git semantics); otherwise falls back to
 *      `$XDG_CONFIG_HOME/git/ignore` then `~/.config/git/ignore`.
 *   3. `<repo>/.git/info/exclude` (with linked-worktree `commondir` lookup).
 *   4. Every `.gitignore` discovered by walking the repo, with patterns
 *      from a nested `.gitignore` rewritten so they're relative to the
 *      repo root (so a single combined matcher behaves correctly).
 *
 * This is a coarse pre-screen, not a full reimplementation of git's ignore
 * machinery — but it's accurate enough that we no longer need a hardcoded
 * list of "noisy" directories.
 */

import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import ignore, { Ignore } from 'ignore'

const ALWAYS_IGNORE = ['.git/', '.DS_Store', '*.swp', '*.swo', '*~']

// Defensive caps to keep matcher construction bounded on pathological repos
// or hostile inputs.
const MAX_WALK_DEPTH = 10
const MAX_GITIGNORE_FILES = 500
const MAX_GITIGNORE_BYTES = 1 * 1024 * 1024 // 1 MiB per file
const GIT_CONFIG_TIMEOUT_MS = 5000

export interface GitignoreMatcher {
  /** Returns true when `relPath` (POSIX, relative to repo root) is ignored. */
  ignores(relPath: string): boolean
}

/**
 * Resolve `<repoRootFs>/.git` to an actual directory path, following the
 * `gitdir:` pointer when `.git` is a file (linked worktrees, submodules).
 * Returns null when no usable gitdir can be located.
 */
export function resolveGitDir(repoRootFs: string): string | null {
  const dotGit = path.join(repoRootFs, '.git')
  let stat: fs.Stats
  try {
    stat = fs.statSync(dotGit)
  } catch {
    return null
  }
  if (stat.isDirectory()) return dotGit
  if (!stat.isFile()) return null
  let txt: string
  try {
    txt = fs.readFileSync(dotGit, 'utf8')
  } catch {
    return null
  }
  const m = txt.match(/^gitdir:\s*(.+?)\s*$/m)
  if (!m) return null
  return path.isAbsolute(m[1]) ? m[1] : path.resolve(repoRootFs, m[1])
}

/**
 * Resolve the shared `commondir` for a linked worktree. Reads the
 * `<gitdir>/commondir` file when present; otherwise returns the gitdir
 * itself (which is correct for the main worktree where there is no
 * `commondir` file).
 */
export function resolveCommonDir(gitDir: string): string {
  const commondirFile = path.join(gitDir, 'commondir')
  try {
    const txt = safeReadFile(commondirFile)
    if (txt !== null) {
      const target = txt.trim()
      if (target) return path.isAbsolute(target) ? target : path.resolve(gitDir, target)
    }
  } catch {
    /* fall through */
  }
  return gitDir
}

/**
 * Build a matcher for `repoRootFs`. Synchronous and best-effort: any I/O
 * failure (permission denied, race with deletion, etc.) is silently skipped
 * so a transient FS hiccup never breaks the watcher.
 */
export function buildGitignoreMatcher(repoRootFs: string): GitignoreMatcher {
  const ig = ignore()
  ig.add(ALWAYS_IGNORE)

  const globalExcludes = readGlobalExcludes(repoRootFs)
  if (globalExcludes) ig.add(globalExcludes)

  const infoExclude = readInfoExclude(repoRootFs)
  if (infoExclude) ig.add(infoExclude)

  walkGitignores(repoRootFs, '', ig, { remaining: MAX_GITIGNORE_FILES }, 0)

  return ig
}

/**
 * Returns the absolute paths whose contents are baked into the matcher and
 * whose changes should trigger a rebuild. `changesWatcher` uses these to
 * watch `info/exclude` and the global excludes file (in addition to its
 * existing `.gitignore` event handling).
 */
export function getMatcherSourcePaths(repoRootFs: string): {
  infoExclude: string | null
  globalExcludes: string | null
} {
  return {
    infoExclude: locateInfoExclude(repoRootFs),
    globalExcludes: locateGlobalExcludes(repoRootFs)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// internals
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Locate the path to `info/exclude` for this worktree without reading it.
 * Honors linked worktrees via the `commondir` file.
 */
function locateInfoExclude(repoRootFs: string): string | null {
  const gitDir = resolveGitDir(repoRootFs)
  if (!gitDir) return null
  const common = resolveCommonDir(gitDir)
  return path.join(common, 'info', 'exclude')
}

function readInfoExclude(repoRootFs: string): string | null {
  const target = locateInfoExclude(repoRootFs)
  if (!target) return null
  return safeReadFile(target)
}

/**
 * Locate the path to the user's global excludes file without reading it.
 * Mirrors `readGlobalExcludes`: honors `core.excludesfile` exclusively when
 * it is set, otherwise falls back to the XDG default.
 */
function locateGlobalExcludes(repoRootFs: string): string | null {
  const configured = readCoreExcludesfileConfig(repoRootFs)
  if (configured !== null) {
    return configured ? expandHome(configured) : null
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(xdg, 'git', 'ignore')
}

function readCoreExcludesfileConfig(repoRootFs: string): string | null {
  // Returns:
  //   - The configured value (possibly an empty string) when `git config`
  //     could be executed and the key is set.
  //   - null when the key is unset (`git config` exited non-zero) or git
  //     itself is unavailable / hung.
  try {
    const out = execFileSync('git', ['config', '--get', 'core.excludesfile'], {
      cwd: repoRootFs,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_CONFIG_TIMEOUT_MS
    }).trim()
    return out
  } catch {
    return null
  }
}

function readGlobalExcludes(repoRootFs: string): string | null {
  // Per `git config(1)`, when `core.excludesfile` is set it is the ONLY
  // global excludes path consulted — git does not fall back to the XDG
  // default. Falling back here would make us filter paths git would not.
  const configured = readCoreExcludesfileConfig(repoRootFs)
  if (configured !== null) {
    return configured ? safeReadFile(expandHome(configured)) : null
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return safeReadFile(path.join(xdg, 'git', 'ignore'))
}

function expandHome(p: string): string {
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2))
  }
  return p
}

/**
 * Read a `.gitignore`-style text file with hardening:
 *   - reject non-regular files (symlinks, devices, fifos) so a malicious
 *     symlink can't make us read `/dev/zero`.
 *   - cap the size so a huge file can't freeze the main process.
 * Returns null on any failure.
 */
function safeReadFile(absPath: string): string | null {
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(absPath)
  } catch {
    return null
  }
  if (!stat.isFile()) return null
  if (stat.size > MAX_GITIGNORE_BYTES) return null
  try {
    return fs.readFileSync(absPath, 'utf8')
  } catch {
    return null
  }
}

interface WalkBudget {
  remaining: number
}

function walkGitignores(
  repoRootFs: string,
  relDir: string,
  ig: Ignore,
  budget: WalkBudget,
  depth: number
): void {
  if (depth > MAX_WALK_DEPTH) return
  if (budget.remaining <= 0) return

  const absDir = relDir ? path.join(repoRootFs, relDir) : repoRootFs

  // Read this directory's .gitignore first so it applies before we
  // decide whether to descend into subdirectories.
  const gitignoreAbs = path.join(absDir, '.gitignore')
  const content = safeReadFile(gitignoreAbs)
  if (content !== null) {
    budget.remaining--
    const rewritten = rewritePatterns(content, relDir)
    if (rewritten.length > 0) ig.add(rewritten)
  }

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true })
  } catch {
    return
  }

  // Sort by name so the rule order baked into the matcher is deterministic
  // across machines and filesystems (readdir order is platform-dependent).
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name === '.git') continue
    const childRel = relDir ? `${relDir}/${entry.name}` : entry.name
    // Skip already-ignored subtrees so we don't descend into node_modules
    // and similar megadirs just to look for nested .gitignore files.
    if (ig.ignores(childRel + '/')) continue
    walkGitignores(repoRootFs, childRel, ig, budget, depth + 1)
    if (budget.remaining <= 0) return
  }
}

/**
 * Rewrite patterns from a `.gitignore` so a single repo-root-rooted matcher
 * evaluates them with the same scope semantics git uses for nested files.
 *
 * For root-level `.gitignore` (relDir === '') patterns are returned as-is.
 *
 * For a nested `.gitignore` at `<relDir>/.gitignore`:
 *   - "/foo"           → "<relDir>/foo"
 *   - "foo/bar"        → "<relDir>/foo/bar"
 *   - "foo"            → "<relDir>/**\/foo"   (matches any descendant; per
 *                                               the gitignore spec `**\/foo`
 *                                               matches `foo` at any depth
 *                                               including directly under
 *                                               relDir, so a single pattern
 *                                               suffices)
 *   - "!foo"           → negated form of the above
 *
 * Trailing whitespace is stripped (matching git), but escaped trailing
 * spaces (`foo\ `) are preserved per the gitignore spec.
 *
 * Comments and blank lines are dropped.
 */
export function rewritePatterns(content: string, relDir: string): string[] {
  const out: string[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripUnescapedTrailingWhitespace(rawLine)
    if (!line) continue
    if (line.startsWith('#')) continue

    let neg = ''
    let pat = line
    if (pat.startsWith('!')) {
      neg = '!'
      pat = pat.slice(1)
    }
    if (!pat) continue

    if (!relDir) {
      out.push(neg + pat)
      continue
    }

    if (pat.startsWith('/')) {
      out.push(`${neg}${relDir}${pat}`)
      continue
    }

    // A slash anywhere except the last char means the pattern is anchored
    // in git (relative to the .gitignore's directory).
    const inner = pat.endsWith('/') ? pat.slice(0, -1) : pat
    if (inner.includes('/')) {
      out.push(`${neg}${relDir}/${pat}`)
      continue
    }

    // Bare name: match anywhere under relDir. `**\/` matches zero or more
    // path components, which subsumes the direct-child case, so a single
    // pattern is sufficient and avoids consuming two rule slots in the
    // matcher (which can interact awkwardly with later negations).
    out.push(`${neg}${relDir}/**/${pat}`)
  }
  return out
}

/**
 * Strip trailing whitespace from a `.gitignore` line, but preserve
 * whitespace escaped with a backslash (`foo\ ` matches a filename ending
 * with a space). The escape sequence itself is left intact — the `ignore`
 * package consumes raw gitignore syntax and decodes the escape during
 * matching.
 */
function stripUnescapedTrailingWhitespace(line: string): string {
  let end = line.length
  while (end > 0) {
    const ch = line.charCodeAt(end - 1)
    if (ch !== 0x20 && ch !== 0x09) break
    // Count preceding backslashes; if odd, this whitespace is escaped.
    let bs = 0
    let i = end - 2
    while (i >= 0 && line.charCodeAt(i) === 0x5c) {
      bs++
      i--
    }
    if (bs % 2 === 1) break
    end--
  }
  return end === line.length ? line : line.slice(0, end)
}
