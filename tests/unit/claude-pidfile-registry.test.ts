import * as os from 'os'
import * as path from 'path'
import * as fsp from 'fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClaudePidfileRegistry } from '../../src/main/services/providers/claudePidfileRegistry'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function writePidfile(
  dir: string,
  pid: number,
  data: Record<string, unknown>
): Promise<void> {
  await fsp.writeFile(path.join(dir, `${pid}.json`), JSON.stringify(data), 'utf-8')
}

describe('claudePidfileRegistry', () => {
  let tmpDir: string
  let registry: ClaudePidfileRegistry

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dplex-claude-pidfile-'))
    registry = new ClaudePidfileRegistry(tmpDir)
  })

  afterEach(async () => {
    registry.stop()
    await fsp.rm(tmpDir, { recursive: true, force: true })
  })

  it('indexes existing pidfiles by sessionId and pid on start', async () => {
    const myPid = process.pid
    await writePidfile(tmpDir, myPid, {
      pid: myPid,
      sessionId: 'sess-A',
      cwd: '/Users/me/repo',
      status: 'busy',
      detail: 'Bash · ls -la'
    })

    await registry.start()

    const byId = registry.getBySessionId('sess-A')
    expect(byId).not.toBeNull()
    expect(byId?.pid).toBe(myPid)
    expect(byId?.detail).toBe('Bash · ls -la')

    const byPid = registry.getByPid(myPid)
    expect(byPid?.sessionId).toBe('sess-A')

    const byCwd = registry.getByCwd('/Users/me/repo')
    expect(byCwd?.sessionId).toBe('sess-A')
  })

  it('filters out pidfiles whose process is dead', async () => {
    // Use an unlikely-to-exist PID.
    const deadPid = 999999
    await writePidfile(tmpDir, deadPid, {
      pid: deadPid,
      sessionId: 'sess-dead',
      cwd: '/x'
    })
    await registry.start()
    expect(registry.getBySessionId('sess-dead')).toBeNull()
    expect(registry.listSnapshots()).toEqual([])
  })

  it('rejects malformed pidfiles (missing sessionId or cwd)', async () => {
    await writePidfile(tmpDir, process.pid, { pid: process.pid })
    await registry.start()
    expect(registry.listSnapshots()).toEqual([])
  })

  it('notifies subscribers when a pidfile is added', async () => {
    const events: number[] = []
    registry.subscribe((snaps) => events.push(snaps.length))

    // Initial subscribe pushes empty/current state — no snapshots yet.
    await sleep(50)

    await writePidfile(tmpDir, process.pid, {
      pid: process.pid,
      sessionId: 'sess-B',
      cwd: '/repo',
      status: 'idle'
    })

    // Wait for fs.watch debounce + processing.
    await sleep(500)

    expect(registry.getBySessionId('sess-B')).not.toBeNull()
    expect(events.some((n) => n === 1)).toBe(true)
  })

  it('removes snapshots when pidfile is unlinked', async () => {
    await writePidfile(tmpDir, process.pid, {
      pid: process.pid,
      sessionId: 'sess-C',
      cwd: '/r'
    })
    await registry.start()
    expect(registry.getBySessionId('sess-C')).not.toBeNull()

    await fsp.unlink(path.join(tmpDir, `${process.pid}.json`))
    await sleep(500)

    expect(registry.getBySessionId('sess-C')).toBeNull()
  })

  it('subscribe refcount: stops watcher only after last unsubscribe', async () => {
    const off1 = registry.subscribe(() => {})
    const off2 = registry.subscribe(() => {})
    await sleep(50)

    off1()
    await writePidfile(tmpDir, process.pid, {
      pid: process.pid,
      sessionId: 'sess-D',
      cwd: '/r'
    })
    await sleep(500)
    // Still watching because off2 is alive.
    expect(registry.getBySessionId('sess-D')).not.toBeNull()

    off2()
    // After last unsubscribe, registry stops & clears.
    expect(registry.getBySessionId('sess-D')).toBeNull()
  })

  it('rejects pidfiles whose startedAt mismatches the live PID start time (PID reuse)', async () => {
    // Skip on Windows where start-time verification is unavailable.
    if (process.platform === 'win32') return

    // process.pid is alive, but we claim it started at epoch 0 — forcing
    // the identity check to fail and prove the snapshot is treated as stale.
    await writePidfile(tmpDir, process.pid, {
      pid: process.pid,
      sessionId: 'sess-stale',
      cwd: '/r',
      startedAt: 1
    })
    await registry.start()

    expect(registry.getBySessionId('sess-stale')).toBeNull()
    expect(registry.getByPid(process.pid)).toBeNull()
    expect(registry.getByCwd('/r')).toBeNull()
    expect(registry.listSnapshots()).toEqual([])
  })

  it('accepts pidfiles whose startedAt matches the live PID start time', async () => {
    // Skip on Windows where start-time verification is unavailable.
    if (process.platform === 'win32') return

    const { getProcessStartTimeMs } = await import('../../src/main/services/providers/processUtils')
    const actualStart = getProcessStartTimeMs(process.pid)
    if (actualStart === null) return // ps unavailable; behaviour preserved

    await writePidfile(tmpDir, process.pid, {
      pid: process.pid,
      sessionId: 'sess-fresh',
      cwd: '/r',
      startedAt: actualStart
    })
    await registry.start()

    expect(registry.getBySessionId('sess-fresh')?.sessionId).toBe('sess-fresh')
  })
})
