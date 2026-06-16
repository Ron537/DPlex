import { describe, expect, it } from 'vitest'
import { parseNameStatusZ, parsePorcelainV2 } from '../../src/main/services/diff/porcelainV2'

describe('parsePorcelainV2', () => {
  it('returns empty for empty input', () => {
    expect(parsePorcelainV2('')).toEqual([])
  })

  it('parses ordinary modified file', () => {
    // "1 .M N... 100644 100644 100644 <hH> <hI> src/foo.ts\0"
    const rec = '1 .M N... 100644 100644 100644 1111111 2222222 src/foo.ts'
    const out = parsePorcelainV2(rec + '\0')
    expect(out).toEqual([{ gitPath: 'src/foo.ts', headStatus: '.', wtStatus: 'M' }])
  })

  it('parses partially-staged file (XY=MM) as a single entry with both columns set', () => {
    const rec = '1 MM N... 100644 100644 100644 1111111 2222222 a.txt'
    const out = parsePorcelainV2(rec + '\0')
    // The renderer is responsible for showing this in BOTH Staged + Changes
    // sections — the parser surfaces both statuses on one row.
    expect(out).toEqual([{ gitPath: 'a.txt', headStatus: 'M', wtStatus: 'M' }])
  })

  it('parses added (staged-only) file', () => {
    const rec = '1 A. N... 000000 100644 100644 0000000 2222222 added.txt'
    const out = parsePorcelainV2(rec + '\0')
    expect(out).toEqual([{ gitPath: 'added.txt', headStatus: 'A', wtStatus: '.' }])
  })

  it('parses deleted (unstaged) file', () => {
    const rec = '1 .D N... 100644 100644 000000 1111111 0000000 gone.txt'
    const out = parsePorcelainV2(rec + '\0')
    expect(out).toEqual([{ gitPath: 'gone.txt', headStatus: '.', wtStatus: 'D' }])
  })

  it('parses rename with score (type-2, two NUL chunks)', () => {
    // "2 R. N... 100644 100644 100644 hH hI R100 newPath\0oldPath\0"
    const rec = '2 R. N... 100644 100644 100644 1111111 2222222 R100 src/new.ts'
    const out = parsePorcelainV2(rec + '\0' + 'src/old.ts\0')
    expect(out).toEqual([
      {
        gitPath: 'src/new.ts',
        oldGitPath: 'src/old.ts',
        headStatus: 'R',
        wtStatus: '.',
        similarity: 100
      }
    ])
  })

  it('parses copy with score', () => {
    const rec = '2 C. N... 100644 100644 100644 1111111 2222222 C075 dst.txt'
    const out = parsePorcelainV2(rec + '\0' + 'src.txt\0')
    expect(out).toEqual([
      {
        gitPath: 'dst.txt',
        oldGitPath: 'src.txt',
        headStatus: 'C',
        wtStatus: '.',
        similarity: 75
      }
    ])
  })

  it('parses untracked file', () => {
    const out = parsePorcelainV2('? new.txt\0')
    expect(out).toEqual([{ gitPath: 'new.txt', headStatus: '.', wtStatus: '?' }])
  })

  it('drops ignored entries', () => {
    const out = parsePorcelainV2('! node_modules/x\0')
    expect(out).toEqual([])
  })

  it('parses unmerged conflict and flags isConflict', () => {
    // "u UU N... <m1> <m2> <m3> <mW> <h1> <h2> <h3> conflicted.txt"
    const rec = 'u UU N... 100644 100644 100644 100644 1111111 2222222 3333333 conflicted.txt'
    const out = parsePorcelainV2(rec + '\0')
    expect(out).toEqual([
      {
        gitPath: 'conflicted.txt',
        headStatus: 'U',
        wtStatus: 'U',
        isConflict: true
      }
    ])
  })

  it('parses path containing spaces correctly (does not split on path)', () => {
    const rec = '1 .M N... 100644 100644 100644 1111111 2222222 my docs/file with spaces.md'
    const out = parsePorcelainV2(rec + '\0')
    expect(out[0].gitPath).toBe('my docs/file with spaces.md')
  })

  it('handles a stream with mixed records preserving order', () => {
    const stream =
      '1 .M N... 100644 100644 100644 a a a.ts\0' +
      '2 R. N... 100644 100644 100644 b b R100 new.ts\0old.ts\0' +
      '? untracked.ts\0' +
      '! ignored.ts\0'
    const out = parsePorcelainV2(stream)
    expect(out.map((f) => f.gitPath)).toEqual(['a.ts', 'new.ts', 'untracked.ts'])
    expect(out[1].oldGitPath).toBe('old.ts')
  })
})

describe('parseNameStatusZ (branch scope)', () => {
  it('returns empty for empty input', () => {
    expect(parseNameStatusZ('')).toEqual([])
  })

  it('parses ordinary modified entry', () => {
    const out = parseNameStatusZ('M\tsrc/foo.ts\0')
    expect(out).toEqual([{ gitPath: 'src/foo.ts', headStatus: 'M', wtStatus: '.' }])
  })

  it('parses added and deleted entries', () => {
    const out = parseNameStatusZ('A\tnew.txt\0D\tgone.txt\0')
    expect(out).toEqual([
      { gitPath: 'new.txt', headStatus: 'A', wtStatus: '.' },
      { gitPath: 'gone.txt', headStatus: 'D', wtStatus: '.' }
    ])
  })

  it('parses rename with score across three NUL chunks', () => {
    const out = parseNameStatusZ('R100\0src/old.ts\0src/new.ts\0')
    expect(out).toEqual([
      {
        gitPath: 'src/new.ts',
        oldGitPath: 'src/old.ts',
        headStatus: 'R',
        wtStatus: '.',
        similarity: 100
      }
    ])
  })

  it('parses copy with score', () => {
    const out = parseNameStatusZ('C75\0src/a.ts\0src/b.ts\0')
    expect(out[0]).toMatchObject({
      gitPath: 'src/b.ts',
      oldGitPath: 'src/a.ts',
      headStatus: 'C',
      similarity: 75
    })
  })

  it('handles path with spaces', () => {
    const out = parseNameStatusZ('M\tmy docs/file with spaces.md\0')
    expect(out[0].gitPath).toBe('my docs/file with spaces.md')
  })

  // Modern git (>= ~2.x) emits ordinary entries as `status\0path\0` (status
  // in its own NUL-separated chunk), not the legacy `status\tpath\0` form.
  it('parses ordinary entries in the modern NUL-separated form', () => {
    const out = parseNameStatusZ('M\0src/foo.ts\0A\0new.txt\0D\0gone.txt\0')
    expect(out).toEqual([
      { gitPath: 'src/foo.ts', headStatus: 'M', wtStatus: '.' },
      { gitPath: 'new.txt', headStatus: 'A', wtStatus: '.' },
      { gitPath: 'gone.txt', headStatus: 'D', wtStatus: '.' }
    ])
  })

  it('mixes modern ordinary entries with renames', () => {
    const out = parseNameStatusZ('M\0a.ts\0R100\0old.ts\0new.ts\0')
    expect(out).toEqual([
      { gitPath: 'a.ts', headStatus: 'M', wtStatus: '.' },
      {
        gitPath: 'new.ts',
        oldGitPath: 'old.ts',
        headStatus: 'R',
        wtStatus: '.',
        similarity: 100
      }
    ])
  })
})
