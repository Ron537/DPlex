import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  listDir,
  readFile,
  writeFile,
  createFile,
  createDir,
  rename,
  deletePath,
  MAX_CONTENT_BYTES
} from '../../src/main/services/fsExplorer/fsService'

let root = ''

beforeEach(async () => {
  const base = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dplex-fs-'))
  root = await fs.promises.realpath(base)
  await fs.promises.mkdir(path.join(root, 'src'))
  await fs.promises.mkdir(path.join(root, '.git'))
  await fs.promises.writeFile(path.join(root, 'README.md'), 'readme')
  await fs.promises.writeFile(path.join(root, 'src', 'a.txt'), 'aaa')
})

afterEach(async () => {
  if (root) await fs.promises.rm(root, { recursive: true, force: true })
})

describe('listDir', () => {
  it('lists root entries dirs-first and omits .git', async () => {
    const res = await listDir(root, '')
    expect(res.ok).toBe(true)
    const names = res.entries.map((e) => e.name)
    expect(names).not.toContain('.git')
    expect(names).toEqual(['src', 'README.md'])
    expect(res.entries[0].type).toBe('dir')
  })

  it('returns relPath relative to root', async () => {
    const res = await listDir(root, 'src')
    expect(res.entries.map((e) => e.relPath)).toEqual(['src/a.txt'])
  })

  it('fails for a non-directory', async () => {
    const res = await listDir(root, 'README.md')
    expect(res.ok).toBe(false)
    expect(res.code).toBe('NOT_A_DIRECTORY')
  })
})

describe('readFile', () => {
  it('reads text with eol detection', async () => {
    const res = await readFile(root, 'README.md')
    expect(res.ok).toBe(true)
    expect(res.content).toBe('readme')
    expect(res.eol).toBe('\n')
    expect(res.isBinary).toBe(false)
  })

  it('detects CRLF', async () => {
    await fs.promises.writeFile(path.join(root, 'crlf.txt'), 'a\r\nb')
    const res = await readFile(root, 'crlf.txt')
    expect(res.eol).toBe('\r\n')
  })

  it('treats a lone CR (no LF) as LF, not CRLF', async () => {
    await fs.promises.writeFile(path.join(root, 'cr.txt'), 'a\rb\nc')
    const res = await readFile(root, 'cr.txt')
    expect(res.eol).toBe('\n')
  })

  it('flags binary files', async () => {
    await fs.promises.writeFile(path.join(root, 'bin'), Buffer.from([1, 2, 0, 3]))
    const res = await readFile(root, 'bin')
    expect(res.ok).toBe(true)
    expect(res.isBinary).toBe(true)
    expect(res.content).toBe('')
  })

  it('flags oversize files as truncated', async () => {
    const big = Buffer.alloc(MAX_CONTENT_BYTES + 10, 0x61)
    await fs.promises.writeFile(path.join(root, 'big.txt'), big)
    const res = await readFile(root, 'big.txt')
    expect(res.truncated).toBe(true)
    expect(res.content).toBe('')
  })

  it('returns an error for a missing file', async () => {
    const res = await readFile(root, 'nope.txt')
    expect(res.ok).toBe(false)
    expect(res.code).toBe('INVALID_INPUT')
  })
})

describe('writeFile', () => {
  it('writes and normalizes to requested eol', async () => {
    const res = await writeFile(root, 'src/a.txt', 'x\ny', '\r\n')
    expect(res.ok).toBe(true)
    const raw = await fs.promises.readFile(path.join(root, 'src', 'a.txt'), 'utf8')
    expect(raw).toBe('x\r\ny')
  })

  it('honors optimistic mtime check', async () => {
    const read = await readFile(root, 'src/a.txt')
    const ok = await writeFile(root, 'src/a.txt', 'updated', '\n', read.mtimeMs)
    expect(ok.ok).toBe(true)
    // A stale mtime far in the past is rejected.
    const stale = await writeFile(root, 'src/a.txt', 'again', '\n', 1)
    expect(stale.ok).toBe(false)
    expect(stale.code).toBe('STALE_FILE')
  })

  it('rejects bad eol input', async () => {
    const res = await writeFile(root, 'src/a.txt', 'x', '\t' as unknown as '\n')
    expect(res.ok).toBe(false)
    expect(res.code).toBe('INVALID_INPUT')
  })
})

describe('createFile / createDir', () => {
  it('creates a new file and refuses collisions', async () => {
    const a = await createFile(root, 'src/new.txt')
    expect(a.ok).toBe(true)
    expect(a.relPath).toBe('src/new.txt')
    const b = await createFile(root, 'src/new.txt')
    expect(b.ok).toBe(false)
    expect(b.code).toBe('EXISTS')
  })

  it('creates a new directory and refuses collisions', async () => {
    const a = await createDir(root, 'pkg')
    expect(a.ok).toBe(true)
    const b = await createDir(root, 'pkg')
    expect(b.ok).toBe(false)
    expect(b.code).toBe('EXISTS')
  })

  it('refuses to create at root', async () => {
    expect((await createFile(root, '')).ok).toBe(false)
    expect((await createDir(root, '')).ok).toBe(false)
  })

  it('creates missing parent directories for a new file', async () => {
    const res = await createFile(root, 'deep/nested/leaf.txt')
    expect(res.ok).toBe(true)
    expect(fs.existsSync(path.join(root, 'deep', 'nested', 'leaf.txt'))).toBe(true)
  })
})

describe('rename', () => {
  it('renames a file', async () => {
    const res = await rename(root, 'src/a.txt', 'src/b.txt')
    expect(res.ok).toBe(true)
    expect(res.relPath).toBe('src/b.txt')
    expect(fs.existsSync(path.join(root, 'src', 'b.txt'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'src', 'a.txt'))).toBe(false)
  })

  it('refuses to overwrite an existing destination', async () => {
    const res = await rename(root, 'src/a.txt', 'README.md')
    expect(res.ok).toBe(false)
    expect(res.code).toBe('EXISTS')
  })
})

describe('deletePath', () => {
  it('deletes a file', async () => {
    const res = await deletePath(root, 'src/a.txt')
    expect(res.ok).toBe(true)
    expect(fs.existsSync(path.join(root, 'src', 'a.txt'))).toBe(false)
  })

  it('deletes a directory recursively', async () => {
    const res = await deletePath(root, 'src')
    expect(res.ok).toBe(true)
    expect(fs.existsSync(path.join(root, 'src'))).toBe(false)
  })

  it('returns an error for a missing path', async () => {
    const res = await deletePath(root, 'gone')
    expect(res.ok).toBe(false)
    expect(res.code).toBe('INVALID_INPUT')
  })

  it('refuses to delete the root', async () => {
    const res = await deletePath(root, '')
    expect(res.ok).toBe(false)
    expect(res.code).toBe('INVALID_INPUT')
  })
})
