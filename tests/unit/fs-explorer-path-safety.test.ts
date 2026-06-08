import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  safeProjectRoot,
  normalizeRelPath,
  resolveInsideRoot
} from '../../src/main/services/fsExplorer/pathSafety'

let root = ''

beforeEach(async () => {
  const base = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dplex-ps-'))
  // realpath so comparisons match (macOS /tmp -> /private/tmp).
  root = await fs.promises.realpath(base)
  await fs.promises.mkdir(path.join(root, 'src'))
  await fs.promises.writeFile(path.join(root, 'src', 'a.txt'), 'hi')
  await fs.promises.mkdir(path.join(root, '.git'))
  await fs.promises.writeFile(path.join(root, '.git', 'config'), 'x')
})

afterEach(async () => {
  if (root) await fs.promises.rm(root, { recursive: true, force: true })
})

describe('normalizeRelPath', () => {
  it('returns empty string for root-ish inputs', () => {
    expect(normalizeRelPath('')).toBe('')
    expect(normalizeRelPath(undefined)).toBe('')
    expect(normalizeRelPath(null)).toBe('')
  })

  it('normalizes backslashes to posix', () => {
    expect(normalizeRelPath('src\\a.txt')).toBe('src/a.txt')
  })

  it('rejects traversal and dot segments', () => {
    expect(normalizeRelPath('../escape')).toBeNull()
    expect(normalizeRelPath('src/../../x')).toBeNull()
    expect(normalizeRelPath('./x')).toBeNull()
  })

  it('rejects any .git segment', () => {
    expect(normalizeRelPath('.git')).toBeNull()
    expect(normalizeRelPath('.git/config')).toBeNull()
    expect(normalizeRelPath('src/.git')).toBeNull()
  })

  it('rejects .git case-insensitively on macOS/Windows', () => {
    const ci = process.platform === 'darwin' || process.platform === 'win32'
    if (ci) {
      expect(normalizeRelPath('.GIT/config')).toBeNull()
      expect(normalizeRelPath('.Git')).toBeNull()
    } else {
      // On case-sensitive filesystems `.GIT` is a distinct, allowed directory.
      expect(normalizeRelPath('.GIT/config')).toBe('.GIT/config')
    }
  })

  it('rejects NUL bytes and non-strings', () => {
    expect(normalizeRelPath('a\0b')).toBeNull()
    expect(normalizeRelPath(42 as unknown)).toBeNull()
  })

  it('collapses redundant slashes', () => {
    expect(normalizeRelPath('src//a.txt')).toBe('src/a.txt')
  })
})

describe('safeProjectRoot', () => {
  it('realpaths an existing directory', async () => {
    expect(await safeProjectRoot(root)).toBe(root)
  })

  it('rejects files, missing paths, and bad input', async () => {
    expect(await safeProjectRoot(path.join(root, 'src', 'a.txt'))).toBeNull()
    expect(await safeProjectRoot(path.join(root, 'nope'))).toBeNull()
    expect(await safeProjectRoot('')).toBeNull()
    expect(await safeProjectRoot(123 as unknown)).toBeNull()
  })
})

describe('resolveInsideRoot', () => {
  it('resolves the root itself for empty relPath', async () => {
    expect(await resolveInsideRoot(root, '')).toBe(root)
  })

  it('resolves a nested existing file', async () => {
    expect(await resolveInsideRoot(root, 'src/a.txt', { mustExist: true })).toBe(
      path.join(root, 'src', 'a.txt')
    )
  })

  it('returns null for a missing file when mustExist', async () => {
    expect(await resolveInsideRoot(root, 'src/missing.txt', { mustExist: true })).toBeNull()
  })

  it('allows a missing target when not mustExist (create path)', async () => {
    expect(await resolveInsideRoot(root, 'src/new.txt')).toBe(path.join(root, 'src', 'new.txt'))
  })

  it('rejects traversal and .git', async () => {
    expect(await resolveInsideRoot(root, '../outside')).toBeNull()
    expect(await resolveInsideRoot(root, '.git/config')).toBeNull()
  })

  it('rejects a symlink whose target escapes the root', async () => {
    const outside = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dplex-out-'))
    try {
      await fs.promises.writeFile(path.join(outside, 'secret.txt'), 'nope')
      await fs.promises.symlink(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'))
      expect(await resolveInsideRoot(root, 'link.txt', { mustExist: true })).toBeNull()
    } finally {
      await fs.promises.rm(outside, { recursive: true, force: true })
    }
  })

  it('rejects a path under a symlinked parent escaping the root', async () => {
    const outside = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dplex-out-'))
    try {
      await fs.promises.symlink(outside, path.join(root, 'linkdir'), 'dir')
      expect(await resolveInsideRoot(root, 'linkdir/x.txt')).toBeNull()
    } finally {
      await fs.promises.rm(outside, { recursive: true, force: true })
    }
  })

  it('rejects a dangling symlink on the create path (would escape on write)', async () => {
    const outside = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dplex-out-'))
    try {
      // Symlink points outside the root to a target that does NOT exist, so
      // realpath fails. Writing through it would create a file outside the
      // project, so resolve must reject it even without mustExist.
      await fs.promises.symlink(path.join(outside, 'ghost.txt'), path.join(root, 'dangling.txt'))
      expect(await resolveInsideRoot(root, 'dangling.txt')).toBeNull()
      expect(await resolveInsideRoot(root, 'dangling.txt', { mustExist: true })).toBeNull()
    } finally {
      await fs.promises.rm(outside, { recursive: true, force: true })
    }
  })
})
