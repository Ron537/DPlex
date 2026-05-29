import * as os from 'os'
import * as path from 'path'
import * as fsp from 'fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CopilotProvider } from '../../src/main/services/providers/copilotProvider'
import * as processUtils from '../../src/main/services/providers/processUtils'

type ProviderInternals = {
  scanActiveSessions: () => Promise<Set<string>>
  getSessionDir: () => string
}
const internals = (p: CopilotProvider): ProviderInternals => p as unknown as ProviderInternals

// Use the real provider but redirect its session directory into a temp dir
// and stub the PID-liveness check so we control which lock files count.

describe('CopilotProvider.scanActiveSessions (Phase 1 mtime gate)', () => {
  let tmp: string
  let provider: CopilotProvider

  beforeEach(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'dplex-copilot-scan-'))
    provider = new CopilotProvider()
    // Redirect the session dir to our temp dir.
    internals(provider).getSessionDir = (): string => tmp
    // Treat every PID as alive so liveness is determined purely by the lock
    // file's presence — keeps the test independent of the runner's PIDs.
    vi.spyOn(processUtils, 'isProcessAlive').mockReturnValue(true)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fsp.rm(tmp, { recursive: true, force: true })
  })

  async function makeSession(
    id: string,
    opts: { lockPid?: number; ageMs?: number } = {}
  ): Promise<void> {
    const dir = path.join(tmp, id)
    await fsp.mkdir(dir, { recursive: true })
    if (opts.lockPid !== undefined) {
      await fsp.writeFile(path.join(dir, `inuse.${opts.lockPid}.lock`), '')
    }
    if (opts.ageMs !== undefined) {
      const when = new Date(Date.now() - opts.ageMs)
      await fsp.utimes(dir, when, when)
    }
  }

  it('detects sessions with a recent lock file', async () => {
    await makeSession('11111111-1111-1111-1111-111111111111', { lockPid: 12345 })
    const active = await internals(provider).scanActiveSessions()
    expect(active.has('11111111-1111-1111-1111-111111111111')).toBe(true)
  })

  it('skips dirs whose mtime is older than the scan window (avoids inner readdir)', async () => {
    // A lock file that *would* match — but the dir mtime is 30 days old, so
    // the gate should skip the inner readdir entirely. If the gate were
    // removed, the lock file would be seen and the session would be marked
    // active.
    const stale = '22222222-2222-2222-2222-222222222222'
    await makeSession(stale, {
      lockPid: 99999,
      ageMs: 30 * 24 * 60 * 60 * 1000
    })

    const active = await internals(provider).scanActiveSessions()
    expect(active.has(stale)).toBe(false)
  })

  it('still scans recent dirs even when others are stale', async () => {
    const recent = '33333333-3333-3333-3333-333333333333'
    const stale = '44444444-4444-4444-4444-444444444444'
    await makeSession(recent, { lockPid: 1234 })
    await makeSession(stale, {
      lockPid: 4321,
      ageMs: 60 * 24 * 60 * 60 * 1000
    })

    const active = await internals(provider).scanActiveSessions()
    expect(active.has(recent)).toBe(true)
    expect(active.has(stale)).toBe(false)
  })

  it('ignores entries whose id fails validation', async () => {
    await makeSession('../escape', { lockPid: 1234 })
    const active = await internals(provider).scanActiveSessions()
    expect(active.size).toBe(0)
  })
})
