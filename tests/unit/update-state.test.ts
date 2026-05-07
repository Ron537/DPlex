import { describe, expect, it } from 'vitest'
import {
  initialState,
  reduce,
  shouldSkipPeriodicCheck
} from '../../src/main/services/updateState'
import type { InstallMode } from '../../src/preload/updateTypes'

const FAKE_NOW = 1_700_000_000_000
const opts = (mode: InstallMode): { installMode: InstallMode; now: () => number } => ({
  installMode: mode,
  now: () => FAKE_NOW
})

describe('updateState reducer', () => {
  it('initial state derives capabilities from install mode', () => {
    const auto = initialState('autoInstall')
    expect(auto.status).toBe('idle')
    expect(auto.canCheck).toBe(true)
    expect(auto.canInstall).toBe(false)
    expect(auto.canOpenDownload).toBe(false)

    const manual = initialState('manualDownload')
    expect(manual.canCheck).toBe(true)

    const unsupported = initialState('unsupported')
    expect(unsupported.status).toBe('unsupported')
    expect(unsupported.canCheck).toBe(false)
  })

  it('autoInstall: full happy path', () => {
    let s = initialState('autoInstall')
    s = reduce(s, { type: 'check-started' }, opts('autoInstall'))
    expect(s.status).toBe('checking')
    expect(s.canCheck).toBe(false)

    s = reduce(s, { type: 'available', version: '1.2.0' }, opts('autoInstall'))
    expect(s.status).toBe('available')
    expect(s.version).toBe('1.2.0')
    expect(s.canInstall).toBe(false)

    s = reduce(s, { type: 'download-progress', percent: 42 }, opts('autoInstall'))
    expect(s.status).toBe('downloading')
    expect(s.downloadProgress).toBe(42)

    s = reduce(s, { type: 'downloaded', version: '1.2.0' }, opts('autoInstall'))
    expect(s.status).toBe('downloaded')
    expect(s.canInstall).toBe(true)
    expect(s.canOpenDownload).toBe(false)

    s = reduce(s, { type: 'install-started' }, opts('autoInstall'))
    expect(s.status).toBe('installing')
    expect(s.canInstall).toBe(false)
    expect(s.canCheck).toBe(false)
  })

  it('manualDownload: stays on `available` and surfaces openDownload', () => {
    let s = initialState('manualDownload')
    s = reduce(
      s,
      { type: 'available', version: '0.11.0', releaseUrl: 'https://example.test' },
      opts('manualDownload')
    )
    expect(s.status).toBe('available')
    expect(s.releaseUrl).toBe('https://example.test')
    expect(s.canOpenDownload).toBe(true)
    expect(s.canInstall).toBe(false)
  })

  it('install-started ignored unless status is downloaded + autoInstall', () => {
    let s = initialState('autoInstall')
    s = reduce(s, { type: 'available', version: '2.0.0' }, opts('autoInstall'))
    const before = s
    s = reduce(s, { type: 'install-started' }, opts('autoInstall'))
    expect(s).toBe(before)

    let m = initialState('manualDownload')
    m = reduce(m, { type: 'downloaded', version: '2.0.0' }, opts('manualDownload'))
    const beforeM = m
    m = reduce(m, { type: 'install-started' }, opts('manualDownload'))
    expect(m).toBe(beforeM)
  })

  it('check-started does not regress from terminal-pending states', () => {
    let s = initialState('autoInstall')
    s = reduce(s, { type: 'downloaded', version: '3.0.0' }, opts('autoInstall'))
    const beforeDl = s

    s = reduce(s, { type: 'check-started' }, opts('autoInstall'))
    expect(s).toBe(beforeDl)
    expect(s.status).toBe('downloaded')

    s = reduce(s, { type: 'check-finished-no-update' }, opts('autoInstall'))
    expect(s.status).toBe('downloaded')
  })

  it('error sets status=error and clears progress for transient states', () => {
    let s = initialState('autoInstall')
    s = reduce(s, { type: 'check-started' }, opts('autoInstall'))
    s = reduce(s, { type: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' }, opts('autoInstall'))
    expect(s.status).toBe('error')
    expect(s.error).toBe('net::ERR_INTERNET_DISCONNECTED')
    expect(s.lastChecked).toBe(FAKE_NOW)
    expect(s.canCheck).toBe(true)
  })

  it('error during downloaded keeps the downloaded state but records the error', () => {
    let s = initialState('autoInstall')
    s = reduce(s, { type: 'downloaded', version: '4.0.0' }, opts('autoInstall'))
    s = reduce(s, { type: 'error', message: 'install failed' }, opts('autoInstall'))
    expect(s.status).toBe('downloaded')
    expect(s.error).toBe('install failed')
    expect(s.canInstall).toBe(true)
  })

  it('error is cleared on a successful subsequent check', () => {
    let s = initialState('autoInstall')
    s = reduce(s, { type: 'check-started' }, opts('autoInstall'))
    s = reduce(s, { type: 'error', message: 'transient' }, opts('autoInstall'))
    s = reduce(s, { type: 'check-started' }, opts('autoInstall'))
    expect(s.error).toBeUndefined()

    s = reduce(s, { type: 'check-finished-no-update' }, opts('autoInstall'))
    expect(s.error).toBeUndefined()
    expect(s.status).toBe('up-to-date')
  })

  it('unsupported install mode ignores all transitions except error', () => {
    let s = initialState('unsupported')
    s = reduce(s, { type: 'check-started' }, opts('unsupported'))
    expect(s.status).toBe('unsupported')

    s = reduce(s, { type: 'available', version: 'x' }, opts('unsupported'))
    expect(s.status).toBe('unsupported')

    s = reduce(s, { type: 'error', message: 'broke' }, opts('unsupported'))
    // error still updates lastChecked + error message even on unsupported,
    // because we surface failures consistently.
    expect(s.error).toBe('broke')
  })

  it('download progress clamps to 0-100 and rounds', () => {
    let s = initialState('autoInstall')
    s = reduce(s, { type: 'download-progress', percent: -3 }, opts('autoInstall'))
    expect(s.downloadProgress).toBe(0)

    s = reduce(s, { type: 'download-progress', percent: 250 }, opts('autoInstall'))
    expect(s.downloadProgress).toBe(100)

    s = reduce(s, { type: 'download-progress', percent: 42.6 }, opts('autoInstall'))
    expect(s.downloadProgress).toBe(43)

    s = reduce(s, { type: 'download-progress', percent: NaN }, opts('autoInstall'))
    expect(s.downloadProgress).toBe(0)
  })

  it('shouldSkipPeriodicCheck guards correctly', () => {
    expect(shouldSkipPeriodicCheck('idle')).toBe(false)
    expect(shouldSkipPeriodicCheck('up-to-date')).toBe(false)
    expect(shouldSkipPeriodicCheck('error')).toBe(false)
    expect(shouldSkipPeriodicCheck('checking')).toBe(true)
    expect(shouldSkipPeriodicCheck('downloading')).toBe(true)
    expect(shouldSkipPeriodicCheck('downloaded')).toBe(true)
    expect(shouldSkipPeriodicCheck('installing')).toBe(true)
    expect(shouldSkipPeriodicCheck('unsupported')).toBe(true)
  })

  it('late `available` for the same version does not regress downloaded', () => {
    let s = initialState('autoInstall')
    s = reduce(s, { type: 'downloaded', version: '5.0.0' }, opts('autoInstall'))
    const before = s
    s = reduce(s, { type: 'available', version: '5.0.0' }, opts('autoInstall'))
    expect(s).toBe(before)
    expect(s.canInstall).toBe(true)
  })

  it('late `available` for a *newer* version does refresh', () => {
    let s = initialState('autoInstall')
    s = reduce(s, { type: 'downloaded', version: '5.0.0' }, opts('autoInstall'))
    s = reduce(s, { type: 'available', version: '5.1.0' }, opts('autoInstall'))
    expect(s.status).toBe('available')
    expect(s.version).toBe('5.1.0')
  })

  it('`available` is ignored entirely while installing', () => {
    let s = initialState('autoInstall')
    s = reduce(s, { type: 'downloaded', version: '6.0.0' }, opts('autoInstall'))
    s = reduce(s, { type: 'install-started' }, opts('autoInstall'))
    const before = s
    s = reduce(s, { type: 'available', version: '6.1.0' }, opts('autoInstall'))
    expect(s).toBe(before)
    expect(s.status).toBe('installing')
  })

  it('late download-progress does not regress downloaded or installing', () => {
    let s = initialState('autoInstall')
    s = reduce(s, { type: 'downloaded', version: '7.0.0' }, opts('autoInstall'))
    const beforeDl = s
    s = reduce(s, { type: 'download-progress', percent: 50 }, opts('autoInstall'))
    expect(s).toBe(beforeDl)
    expect(s.status).toBe('downloaded')

    s = reduce(s, { type: 'install-started' }, opts('autoInstall'))
    const beforeInst = s
    s = reduce(s, { type: 'download-progress', percent: 90 }, opts('autoInstall'))
    expect(s).toBe(beforeInst)
    expect(s.status).toBe('installing')
  })

  it('late `downloaded` does not undo installing', () => {
    let s = initialState('autoInstall')
    s = reduce(s, { type: 'downloaded', version: '8.0.0' }, opts('autoInstall'))
    s = reduce(s, { type: 'install-started' }, opts('autoInstall'))
    const before = s
    s = reduce(s, { type: 'downloaded', version: '8.0.0' }, opts('autoInstall'))
    expect(s).toBe(before)
    expect(s.status).toBe('installing')
  })
})
