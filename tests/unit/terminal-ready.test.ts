import { describe, expect, it, vi } from 'vitest'

import {
  subscribeTerminalReady,
  markTerminalReady,
  registerExitHandler,
  fireExitHandler,
  cancelExitHandler,
  registerDestroyCleanup,
  destroyTerminal
} from '../../src/renderer/src/services/terminalRegistry'

// These cover the readiness-subscription mechanism that replaced the single
// bound onReady callback. The old design notified only the first mount, so a
// terminal remounted mid-startup (a Space switch) could hang on
// "Starting terminal…" forever. The subscription model must notify whatever
// hook is currently mounted, keyed by the stable terminalId.
describe('terminalRegistry ready subscriptions', () => {
  it('notifies a subscriber when the terminal is marked ready', () => {
    const cb = vi.fn()
    const off = subscribeTerminalReady('ready-1', cb)
    markTerminalReady('ready-1')
    expect(cb).toHaveBeenCalledTimes(1)
    off()
  })

  it('notifies the CURRENT subscriber after a prior one unsubscribed (remount)', () => {
    const first = vi.fn()
    const second = vi.fn()
    // First mount subscribes, then unmounts (unsubscribes) before the first byte.
    const offFirst = subscribeTerminalReady('ready-2', first)
    offFirst()
    // A remount subscribes; it must be the one notified — the core bug fix.
    const offSecond = subscribeTerminalReady('ready-2', second)
    markTerminalReady('ready-2')
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    offSecond()
  })

  it('supports multiple concurrent subscribers for one terminal', () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = subscribeTerminalReady('ready-3', a)
    const offB = subscribeTerminalReady('ready-3', b)
    markTerminalReady('ready-3')
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    offA()
    offB()
  })

  it('stops notifying a subscriber after it unsubscribes', () => {
    const cb = vi.fn()
    const off = subscribeTerminalReady('ready-4', cb)
    off()
    markTerminalReady('ready-4')
    expect(cb).not.toHaveBeenCalled()
  })

  it('is idempotent — repeated marks re-notify live subscribers', () => {
    const cb = vi.fn()
    const off = subscribeTerminalReady('ready-5', cb)
    markTerminalReady('ready-5')
    markTerminalReady('ready-5')
    expect(cb).toHaveBeenCalledTimes(2)
    off()
  })

  it('is safe to mark ready with no subscribers', () => {
    expect(() => markTerminalReady('ready-none')).not.toThrow()
  })

  it('isolates a throwing subscriber so siblings still fire', () => {
    const boom = vi.fn(() => {
      throw new Error('boom')
    })
    const ok = vi.fn()
    const offBoom = subscribeTerminalReady('ready-6', boom)
    const offOk = subscribeTerminalReady('ready-6', ok)
    expect(() => markTerminalReady('ready-6')).not.toThrow()
    expect(ok).toHaveBeenCalledTimes(1)
    offBoom()
    offOk()
  })
})

// Pending exit handlers let a caller (e.g. the worktree setup-script flow) react
// to a terminal's PTY exit before a hook mounts. cancelExitHandler discards one
// WITHOUT firing it — used on deliberate teardown (a Space is deleted) so a
// setup script's afterCreate action never runs for a Space that no longer exists.
describe('terminalRegistry exit handlers', () => {
  it('fires a registered handler once, then clears it', () => {
    const cb = vi.fn()
    registerExitHandler('exit-1', cb)
    fireExitHandler('exit-1', 0)
    fireExitHandler('exit-1', 0)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith(0)
  })

  it('cancelExitHandler discards a pending handler WITHOUT firing it', () => {
    const cb = vi.fn()
    registerExitHandler('exit-2', cb)
    cancelExitHandler('exit-2')
    // A subsequent exit (e.g. destroyTerminal's synthetic fire) must be a no-op.
    fireExitHandler('exit-2', -1)
    expect(cb).not.toHaveBeenCalled()
  })

  it('cancelExitHandler is safe when no handler is registered', () => {
    expect(() => cancelExitHandler('exit-none')).not.toThrow()
  })
})

// Destroy cleanups ALWAYS run when a terminal is destroyed — even when the exit
// handler was cancelled for deliberate teardown (e.g. a Space deleted mid-setup).
// This is what stops a setup script's temp file leaking on the delete path,
// which matters most on Windows where %TEMP% is not auto-reaped.
describe('terminalRegistry destroy cleanups', () => {
  it('fires a registered cleanup on destroy, exactly once', () => {
    const cleanup = vi.fn()
    registerDestroyCleanup('destroy-1', cleanup)
    // No registry entry for this id → destroyTerminal takes the no-entry branch,
    // which still fires the cleanup (no window/PTY access on that path).
    destroyTerminal('destroy-1')
    destroyTerminal('destroy-1')
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('runs the cleanup even after the exit handler was cancelled (no temp-file leak)', () => {
    const cleanup = vi.fn()
    const exit = vi.fn()
    registerDestroyCleanup('destroy-2', cleanup)
    registerExitHandler('destroy-2', exit)
    // Deliberate teardown discards the deferred afterCreate work…
    cancelExitHandler('destroy-2')
    destroyTerminal('destroy-2')
    // …but the resource-releasing cleanup must still run.
    expect(exit).not.toHaveBeenCalled()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('unregister fn prevents a stale cleanup from firing', () => {
    const cleanup = vi.fn()
    const off = registerDestroyCleanup('destroy-3', cleanup)
    off()
    destroyTerminal('destroy-3')
    expect(cleanup).not.toHaveBeenCalled()
  })

  it('isolates a throwing cleanup (destroy still completes)', () => {
    const throwing = vi.fn(() => {
      throw new Error('cleanup boom')
    })
    registerDestroyCleanup('destroy-4', throwing)
    expect(() => destroyTerminal('destroy-4')).not.toThrow()
    expect(throwing).toHaveBeenCalledTimes(1)
  })
})
