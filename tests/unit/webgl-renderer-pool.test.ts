import { describe, expect, it, vi } from 'vitest'

import {
  MAX_ATTACH_FAILURES,
  MAX_CONTEXT_LOSSES,
  WebglRendererPool,
  type WebglAddonLike
} from '../../src/renderer/src/services/webglRenderer'

// A stand-in for @xterm/addon-webgl's WebglAddon. Real WebGL2 contexts aren't
// available under jsdom, and the pool's contract (LRU capping, context-loss
// fallback, give-up budgets) is what actually needs covering.
class FakeAddon implements WebglAddonLike {
  disposed = false
  lossListener: (() => void) | null = null
  lossSubscriptionDisposed = false

  dispose(): void {
    this.disposed = true
  }

  onContextLoss(listener: () => void): { dispose(): void } {
    this.lossListener = listener
    return {
      dispose: () => {
        this.lossSubscriptionDisposed = true
      }
    }
  }

  /** Simulate the GPU dropping this addon's context. */
  loseContext(): void {
    this.lossListener?.()
  }
}

function makePool(
  maxContexts = 3,
  isPinned?: (terminalId: string) => boolean,
  onContextLost?: (terminalId: string) => void
): {
  pool: WebglRendererPool<FakeAddon>
  created: FakeAddon[]
  loaded: FakeAddon[]
} {
  const created: FakeAddon[] = []
  const loaded: FakeAddon[] = []
  const pool = new WebglRendererPool<FakeAddon>(
    () => {
      const addon = new FakeAddon()
      created.push(addon)
      return addon
    },
    maxContexts,
    isPinned,
    onContextLost
  )
  return { pool, created, loaded }
}

const load =
  (loaded: FakeAddon[]) =>
  (addon: FakeAddon): void => {
    loaded.push(addon)
  }

describe('WebglRendererPool attachment', () => {
  it('creates and loads an addon on first attach', () => {
    const { pool, created, loaded } = makePool()
    expect(pool.attach('t1', load(loaded))).toBe(true)
    expect(created).toHaveLength(1)
    expect(loaded).toEqual(created)
    expect(pool.hasContext('t1')).toBe(true)
  })

  it('is idempotent — re-attaching does not create a second context', () => {
    const { pool, created, loaded } = makePool()
    pool.attach('t1', load(loaded))
    pool.attach('t1', load(loaded))
    pool.attach('t1', load(loaded))
    expect(created).toHaveLength(1)
    expect(pool.size).toBe(1)
  })

  it('reports the number of live contexts', () => {
    const { pool, loaded } = makePool()
    pool.attach('a', load(loaded))
    pool.attach('b', load(loaded))
    expect(pool.size).toBe(2)
  })
})

// WebGL contexts are a scarce browser-wide resource and DPlex can have far more
// terminals than the browser will keep alive. The pool caps them itself so the
// browser never silently kills one behind our back.
describe('WebglRendererPool LRU capping', () => {
  it('never exceeds the context cap', () => {
    const { pool, loaded } = makePool(3)
    for (const id of ['a', 'b', 'c', 'd', 'e']) pool.attach(id, load(loaded))
    expect(pool.size).toBe(3)
  })

  it('evicts the least-recently-attached terminal and disposes its addon', () => {
    const { pool, created, loaded } = makePool(2)
    pool.attach('a', load(loaded))
    pool.attach('b', load(loaded))
    pool.attach('c', load(loaded))

    expect(pool.hasContext('a')).toBe(false)
    expect(pool.hasContext('b')).toBe(true)
    expect(pool.hasContext('c')).toBe(true)
    expect(created[0].disposed).toBe(true)
    expect(created[0].lossSubscriptionDisposed).toBe(true)
  })

  it('re-attaching refreshes recency so an in-use terminal is not evicted', () => {
    const { pool, loaded } = makePool(2)
    pool.attach('a', load(loaded))
    pool.attach('b', load(loaded))
    // Showing 'a' again makes 'b' the least recently used.
    pool.attach('a', load(loaded))
    pool.attach('c', load(loaded))

    expect(pool.hasContext('a')).toBe(true)
    expect(pool.hasContext('b')).toBe(false)
    expect(pool.hasContext('c')).toBe(true)
  })

  it('never evicts the terminal that was just attached', () => {
    const { pool, loaded } = makePool(1)
    pool.attach('a', load(loaded))
    pool.attach('b', load(loaded))
    expect(pool.hasContext('b')).toBe(true)
    expect(pool.size).toBe(1)
  })
})

// A lost context can't be revived — the addon must be dropped so xterm falls
// back to its DOM renderer, and the terminal re-acquires one when next shown.
describe('WebglRendererPool context loss', () => {
  it('drops the addon when the context is lost', () => {
    const { pool, created, loaded } = makePool()
    pool.attach('t1', load(loaded))
    created[0].loseContext()

    expect(pool.hasContext('t1')).toBe(false)
    expect(created[0].disposed).toBe(true)
  })

  it('re-acquires a fresh context on the next attach', () => {
    const { pool, created, loaded } = makePool()
    pool.attach('t1', load(loaded))
    created[0].loseContext()
    expect(pool.attach('t1', load(loaded))).toBe(true)
    expect(created).toHaveLength(2)
  })

  it('gives up on a terminal after repeated losses', () => {
    const { pool, created, loaded } = makePool()
    for (let i = 0; i < MAX_CONTEXT_LOSSES; i++) {
      pool.attach('t1', load(loaded))
      created[created.length - 1].loseContext()
    }
    expect(pool.attach('t1', load(loaded))).toBe(false)
    expect(created).toHaveLength(MAX_CONTEXT_LOSSES)
  })

  it('does not disable WebGL globally — losses are normal driver behavior', () => {
    const { pool, created, loaded } = makePool()
    for (let i = 0; i < MAX_CONTEXT_LOSSES; i++) {
      pool.attach('t1', load(loaded))
      created[created.length - 1].loseContext()
    }
    expect(pool.isUnavailable).toBe(false)
    expect(pool.attach('other', load(loaded))).toBe(true)
  })
})

describe('WebglRendererPool attach failures', () => {
  it('returns false and disposes the addon when loading throws', () => {
    const created: FakeAddon[] = []
    const pool = new WebglRendererPool<FakeAddon>(() => {
      const addon = new FakeAddon()
      created.push(addon)
      return addon
    })
    const boom = (): void => {
      throw new Error('WebGL2 not supported')
    }
    expect(pool.attach('t1', boom)).toBe(false)
    expect(created[0].disposed).toBe(true)
    expect(pool.hasContext('t1')).toBe(false)
  })

  it('tolerates a transient failure without writing off WebGL', () => {
    const { pool, loaded } = makePool()
    const boom = (): void => {
      throw new Error('element detached')
    }
    pool.attach('t1', boom)
    expect(pool.isUnavailable).toBe(false)
    expect(pool.attach('t2', load(loaded))).toBe(true)
  })

  it('stops retrying once failures indicate WebGL is unavailable', () => {
    const { pool, loaded } = makePool()
    const boom = (): void => {
      throw new Error('WebGL2 not supported')
    }
    for (let i = 0; i < MAX_ATTACH_FAILURES; i++) pool.attach(`t${i}`, boom)
    expect(pool.isUnavailable).toBe(true)
    expect(pool.attach('fresh', load(loaded))).toBe(false)
  })

  it('survives a throwing addon factory', () => {
    const pool = new WebglRendererPool<FakeAddon>(() => {
      throw new Error('no constructor')
    })
    expect(() => pool.attach('t1', vi.fn())).not.toThrow()
    expect(pool.attach('t1', vi.fn())).toBe(false)
  })
})

describe('WebglRendererPool release and forget', () => {
  it('release disposes both the addon and its loss subscription', () => {
    const { pool, created, loaded } = makePool()
    pool.attach('t1', load(loaded))
    pool.release('t1')
    expect(created[0].disposed).toBe(true)
    expect(created[0].lossSubscriptionDisposed).toBe(true)
    expect(pool.size).toBe(0)
  })

  it('release is safe for an unknown terminal', () => {
    const { pool } = makePool()
    expect(() => pool.release('nope')).not.toThrow()
  })

  it('isolates a throwing dispose so the context is still dropped', () => {
    const pool = new WebglRendererPool<FakeAddon>(() => {
      const addon = new FakeAddon()
      addon.dispose = (): void => {
        throw new Error('dispose boom')
      }
      return addon
    })
    pool.attach('t1', vi.fn())
    expect(() => pool.release('t1')).not.toThrow()
    expect(pool.hasContext('t1')).toBe(false)
  })

  it('forget clears the failure budget so a reused id starts fresh', () => {
    const { pool, created, loaded } = makePool()
    for (let i = 0; i < MAX_CONTEXT_LOSSES; i++) {
      pool.attach('t1', load(loaded))
      created[created.length - 1].loseContext()
    }
    expect(pool.attach('t1', load(loaded))).toBe(false)
    pool.forget('t1')
    expect(pool.attach('t1', load(loaded))).toBe(true)
  })

  it('forget releases a live context', () => {
    const { pool, created, loaded } = makePool()
    pool.attach('t1', load(loaded))
    pool.forget('t1')
    expect(created[0].disposed).toBe(true)
    expect(pool.size).toBe(0)
  })
})

describe('WebglRendererPool pinned terminals', () => {
  it('evicts unpinned terminals before pinned ones, even if the pinned one is older', () => {
    const pinned = new Set(['t1'])
    const { pool, created, loaded } = makePool(2, (id) => pinned.has(id))

    pool.attach('t1', load(loaded)) // pinned, oldest
    pool.attach('t2', load(loaded)) // unpinned
    pool.attach('t3', load(loaded)) // overflows the cap of 2

    // Plain LRU would drop t1; the pin predicate must spare it and drop t2.
    expect(pool.hasContext('t1')).toBe(true)
    expect(pool.hasContext('t2')).toBe(false)
    expect(pool.hasContext('t3')).toBe(true)
    expect(created[1]?.disposed).toBe(true)
  })

  it('falls back to evicting pinned terminals when every candidate is pinned', () => {
    const { pool, created, loaded } = makePool(2, () => true)

    pool.attach('t1', load(loaded))
    pool.attach('t2', load(loaded))
    pool.attach('t3', load(loaded))

    // The cap is a hard limit — with nothing unpinned to give up, the least
    // recently used pinned context goes rather than exceeding the browser's
    // WebGL context budget.
    expect(pool.size).toBe(2)
    expect(pool.hasContext('t1')).toBe(false)
    expect(created[0]?.disposed).toBe(true)
    expect(pool.hasContext('t2')).toBe(true)
    expect(pool.hasContext('t3')).toBe(true)
  })

  it('treats a re-attach as recent use when choosing an unpinned victim', () => {
    const pinned = new Set<string>()
    const { pool, loaded } = makePool(2, (id) => pinned.has(id))

    pool.attach('t1', load(loaded))
    pool.attach('t2', load(loaded))
    pool.attach('t1', load(loaded)) // refresh recency of t1
    pool.attach('t3', load(loaded))

    expect(pool.hasContext('t2')).toBe(false)
    expect(pool.hasContext('t1')).toBe(true)
    expect(pool.hasContext('t3')).toBe(true)
  })
})

describe('WebglRendererPool attach-failure budget', () => {
  it('resets the failure count after a successful attach so transient errors do not latch', () => {
    const { pool } = makePool()
    const boom = (): void => {
      throw new Error('transient WebGL failure')
    }
    const ok = (): void => {}

    // Fail just short of the global give-up threshold...
    for (let i = 0; i < MAX_ATTACH_FAILURES - 1; i++) {
      expect(pool.attach(`bad${i}`, boom)).toBe(false)
    }
    expect(pool.isUnavailable).toBe(false)

    // ...then succeed, which should clear the tally.
    expect(pool.attach('good', ok)).toBe(true)

    // A fresh run of failures must now be needed to disable WebGL globally.
    for (let i = 0; i < MAX_ATTACH_FAILURES - 1; i++) {
      expect(pool.attach(`later${i}`, boom)).toBe(false)
      expect(pool.isUnavailable).toBe(false)
    }
    expect(pool.attach('final', boom)).toBe(false)
    expect(pool.isUnavailable).toBe(true)
  })
})

describe('WebglRendererPool context-loss notification', () => {
  it('tells the owner when a terminal falls back to the DOM renderer', () => {
    const lost: string[] = []
    const { pool, created, loaded } = makePool(3, undefined, (id) => lost.push(id))
    pool.attach('a', load(loaded))
    expect(lost).toEqual([])

    created[0].loseContext()

    // Without this the terminal stays on the slow DOM renderer until the user
    // happens to switch away and back — on the very pane they're watching.
    expect(lost).toEqual(['a'])
    expect(pool.hasContext('a')).toBe(false)
  })

  it('does not report deliberate evictions as context loss', () => {
    const lost: string[] = []
    const { pool, loaded } = makePool(1, undefined, (id) => lost.push(id))
    pool.attach('a', load(loaded))
    pool.attach('b', load(loaded))

    expect(pool.hasContext('a')).toBe(false)
    expect(lost).toEqual([])
  })

  it('does not report an explicit release as context loss', () => {
    const lost: string[] = []
    const { pool, loaded } = makePool(3, undefined, (id) => lost.push(id))
    pool.attach('a', load(loaded))
    pool.forget('a')
    expect(lost).toEqual([])
  })
})
