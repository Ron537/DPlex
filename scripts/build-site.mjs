#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type --
   Node build script — JSDoc types provided for IntelliSense. */
// Local mirror of the Pages workflow: assemble _site/ from site/ + docs/assets/,
// then invoke the changelog renderer. Runs on macOS, Windows, and Linux.
//
// Filtering: respects the repo's .gitignore as the single source of truth.
// Anything excluded from git (build artifacts, .DS_Store, drafts/, *.local, …)
// is automatically excluded from the deploy bundle too — no per-script
// allow/deny list to maintain.

import { cpSync, mkdirSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ignore from 'ignore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

/**
 * Build a `.gitignore`-aware copy filter, rooted at `repoRoot`. The matcher
 * is keyed by repo-relative POSIX paths, which is what the `ignore` package
 * expects regardless of the host OS.
 * @param {string} rootDir
 * @returns {(absPath: string) => boolean}
 */
export function makeGitignoreFilter(rootDir) {
  const matcher = ignore().add(['.git', '.DS_Store', 'Thumbs.db'])
  const gitignorePath = resolve(rootDir, '.gitignore')
  if (existsSync(gitignorePath)) {
    matcher.add(readFileSync(gitignorePath, 'utf8'))
  }
  return (absPath) => {
    const rel = relative(rootDir, absPath)
    if (!rel || rel.startsWith('..')) return true
    const posix = sep === '/' ? rel : rel.split(sep).join('/')
    // `ignore` distinguishes file vs directory patterns by trailing slash.
    // Test both forms so a `drafts/` pattern in .gitignore matches the
    // directory itself (preventing an empty dir from being created), not
    // just the files inside it.
    if (matcher.ignores(posix)) return false
    let isDir = false
    try {
      isDir = statSync(absPath).isDirectory()
    } catch {
      // Path may not exist yet (e.g. destination side of cpSync); treat as file.
    }
    if (isDir && matcher.ignores(posix + '/')) return false
    return true
  }
}

/** @returns {void} */
function main() {
  const siteDir = resolve(repoRoot, 'site')
  const docsAssetsDir = resolve(repoRoot, 'docs', 'assets')
  const outDir = resolve(repoRoot, '_site')
  const outAssetsDir = resolve(outDir, 'assets')
  const buildChangelog = resolve(__dirname, 'build-changelog.mjs')

  const shouldCopy = makeGitignoreFilter(repoRoot)

  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outAssetsDir, { recursive: true })

  cpSync(siteDir, outDir, { recursive: true, filter: shouldCopy })
  if (existsSync(docsAssetsDir)) {
    cpSync(docsAssetsDir, outAssetsDir, { recursive: true, filter: shouldCopy })
  }

  // The template is consumed by build-changelog.mjs — never deployed.
  rmSync(resolve(outDir, 'changelog.html.template'), { force: true })

  const result = spawnSync(process.execPath, [buildChangelog], {
    stdio: 'inherit',
    cwd: repoRoot
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }

  console.log(`build-site: assembled ${outDir}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}


