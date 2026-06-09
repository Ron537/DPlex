import { describe, expect, it } from 'vitest'

import { parseLsofCwd } from '../../src/main/services/pidCwd'
import { pickInheritedCwd } from '../../src/renderer/src/utils/pickInheritedCwd'

describe('parseLsofCwd', () => {
  it('extracts the path from the cwd name field', () => {
    const stdout = 'p12345\nfcwd\nn/Users/me/projects/dplex\n'
    expect(parseLsofCwd(stdout)).toBe('/Users/me/projects/dplex')
  })

  it('returns the first name field when several lines are present', () => {
    const stdout = 'p12345\nn/Users/me/code\nn/Users/me/other\n'
    expect(parseLsofCwd(stdout)).toBe('/Users/me/code')
  })

  it('handles paths containing spaces', () => {
    const stdout = 'p999\nn/Users/me/My Projects/app\n'
    expect(parseLsofCwd(stdout)).toBe('/Users/me/My Projects/app')
  })

  it('returns null when there is no name field', () => {
    expect(parseLsofCwd('p12345\nfcwd\n')).toBeNull()
  })

  it('returns null for empty output', () => {
    expect(parseLsofCwd('')).toBeNull()
  })

  it('returns null when the name field is empty', () => {
    expect(parseLsofCwd('p12345\nn\n')).toBeNull()
  })
})

describe('pickInheritedCwd', () => {
  it('prefers the live process cwd above all', () => {
    expect(
      pickInheritedCwd({
        liveCwd: '/live/path',
        tabOwnPath: '/tab/path',
        projectPath: '/project/path'
      })
    ).toBe('/live/path')
  })

  it('falls back to the tab own path when there is no live cwd', () => {
    expect(
      pickInheritedCwd({
        liveCwd: null,
        tabOwnPath: '/tab/path',
        projectPath: '/project/path'
      })
    ).toBe('/tab/path')
  })

  it('falls back to the project root when only the project is known', () => {
    expect(
      pickInheritedCwd({
        liveCwd: null,
        tabOwnPath: undefined,
        projectPath: '/project/path'
      })
    ).toBe('/project/path')
  })

  it('returns undefined when no source applies (caller falls back to $HOME)', () => {
    expect(
      pickInheritedCwd({ liveCwd: null, tabOwnPath: undefined, projectPath: undefined })
    ).toBeUndefined()
  })

  it('treats an empty-string live cwd as absent and falls through', () => {
    expect(pickInheritedCwd({ liveCwd: '', tabOwnPath: '/tab/path', projectPath: undefined })).toBe(
      '/tab/path'
    )
  })
})
