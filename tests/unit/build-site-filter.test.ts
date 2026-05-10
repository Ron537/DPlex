import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { makeGitignoreFilter } from '../../scripts/build-site.mjs'

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dplex-build-site-'))
  writeFileSync(
    join(root, '.gitignore'),
    [
      'node_modules',
      'dist',
      '_site',
      '.DS_Store',
      '*.log',
      'site/drafts/',
      '*.local'
    ].join('\n')
  )
  mkdirSync(join(root, 'site'), { recursive: true })
  return root
}

describe('makeGitignoreFilter', () => {
  it('always allows the root directory itself', () => {
    const root = fixture()
    try {
      const filter = makeGitignoreFilter(root)
      expect(filter(root)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('skips .DS_Store and Thumbs.db without needing .gitignore', () => {
    const root = mkdtempSync(join(tmpdir(), 'dplex-build-site-'))
    try {
      const filter = makeGitignoreFilter(root)
      expect(filter(resolve(root, 'site', '.DS_Store'))).toBe(false)
      expect(filter(resolve(root, 'site', 'Thumbs.db'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('skips files matched by repo .gitignore patterns', () => {
    const root = fixture()
    try {
      const filter = makeGitignoreFilter(root)
      expect(filter(resolve(root, 'site', 'drafts', 'wip.html'))).toBe(false)
      expect(filter(resolve(root, 'site', 'config.local'))).toBe(false)
      expect(filter(resolve(root, 'site', 'debug.log'))).toBe(false)
      expect(filter(resolve(root, '_site', 'index.html'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('allows files that are not gitignored', () => {
    const root = fixture()
    try {
      const filter = makeGitignoreFilter(root)
      expect(filter(resolve(root, 'site', 'index.html'))).toBe(true)
      expect(filter(resolve(root, 'site', 'assets', 'styles.css'))).toBe(true)
      expect(filter(resolve(root, 'site', 'assets', 'icon.svg'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('skips directories matched by a trailing-slash gitignore pattern', () => {
    const root = fixture()
    try {
      // Create the directory on disk so statSync works.
      mkdirSync(resolve(root, 'site', 'drafts'), { recursive: true })
      const filter = makeGitignoreFilter(root)
      expect(filter(resolve(root, 'site', 'drafts'))).toBe(false)
      expect(filter(resolve(root, 'site', 'drafts', 'wip.html'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('works without a .gitignore file (only the always-ignore set applies)', () => {
    const root = mkdtempSync(join(tmpdir(), 'dplex-build-site-'))
    try {
      const filter = makeGitignoreFilter(root)
      expect(filter(resolve(root, 'site', 'index.html'))).toBe(true)
      expect(filter(resolve(root, 'site', '.DS_Store'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
