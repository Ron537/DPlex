import { execFileSync, spawn } from 'child_process'

/**
 * Cross-platform process utilities used by every provider that needs to kill
 * AI tool processes (e.g. closing or deleting an active session).
 *
 * On Windows, uses `taskkill /T /F` to terminate the child process tree —
 * Node child processes typically spawn the AI CLI as a subprocess.
 *
 * On Unix, prefers killing the process group (so orphaned children of a
 * `setsid`-spawned PTY also die), falling back to a single-PID signal when
 * the group kill fails.
 */
export function killProcess(pid: number, signal: NodeJS.Signals = 'SIGTERM'): boolean {
  if (process.platform === 'win32') {
    try {
      const result = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
      result.on('error', () => {
        // Ignore — process may already be gone
      })
      return true
    } catch {
      return false
    }
  }
  try {
    try {
      process.kill(-pid, signal)
    } catch {
      process.kill(pid, signal)
    }
    return true
  } catch {
    return false
  }
}

/** Returns true if a process with the given PID is still alive. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM means the process exists but we can't signal it (different user
    // or protected process). Treat as alive so we don't wrongly proceed to
    // destructive cleanup while something is still writing to the session.
    return (err as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

/**
 * Cache of `pid → start-time epoch ms`. Avoids repeated `ps` invocations
 * during bursts of registry lookups. Entries expire after 5s — short enough
 * that a freshly reused PID won't be matched, long enough to absorb the
 * read-heavy paths (UI hover, watcher debounce, attention store updates).
 *
 * The cache is keyed by PID alone (not by expected start time) because
 * the actual start time of a live PID is invariant — we only need to
 * cache "what does the OS say" once per short window.
 */
const startTimeCache = new Map<number, { value: number | null; expiresAt: number }>()
const START_TIME_CACHE_TTL_MS = 5_000

function readProcessStartMsUncached(pid: number): number | null {
  if (process.platform === 'win32') return null
  if (!Number.isInteger(pid) || pid <= 0) return null
  try {
    const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000
    }).trim()
    if (!out) return null
    const parsed = Date.parse(out)
    return Number.isFinite(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Returns the OS-reported start time of `pid` in epoch milliseconds, or
 * `null` if the process does not exist, the platform is unsupported
 * (Windows), or `ps` is unavailable. Cached for 5s per pid.
 */
export function getProcessStartTimeMs(pid: number): number | null {
  const now = Date.now()
  const cached = startTimeCache.get(pid)
  if (cached && cached.expiresAt > now) return cached.value
  const value = readProcessStartMsUncached(pid)
  startTimeCache.set(pid, { value, expiresAt: now + START_TIME_CACHE_TTL_MS })
  return value
}

/**
 * Verify that the live process at `pid` is the same one that wrote a
 * pidfile claiming to have started at `expectedStartMs` (epoch ms).
 *
 * Returns:
 *  - `true` if the OS-reported start time is within `toleranceMs` of the
 *    expected value (same process)
 *  - `false` if the times disagree by more than the tolerance — strong
 *    evidence the original process exited and the OS reused its PID
 *  - `null` when we cannot determine (Windows, missing/invalid expected,
 *    `ps` failed). Caller treats `null` as "alive" to preserve previous
 *    behaviour on platforms where we have no signal.
 *
 * Tolerance defaults to 10s because the pidfile's `startedAt` is recorded
 * a few hundred ms after `exec()` and we don't need millisecond accuracy
 * to defeat PID reuse — reused PIDs are minutes/hours apart in practice.
 */
export function verifyProcessIdentity(
  pid: number,
  expectedStartMs: number | undefined,
  toleranceMs = 10_000
): boolean | null {
  if (typeof expectedStartMs !== 'number' || !Number.isFinite(expectedStartMs)) return null
  const actual = getProcessStartTimeMs(pid)
  if (actual === null) return null
  return Math.abs(actual - expectedStartMs) <= toleranceMs
}

/** Wait until the given pids have all exited, or the timeout elapses. */
export async function waitForProcessesToExit(
  pids: number[],
  timeoutMs: number
): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (pids.every((pid) => !isProcessAlive(pid))) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return pids.every((pid) => !isProcessAlive(pid))
}
