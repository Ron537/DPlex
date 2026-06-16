import { describe, expect, it } from 'vitest'
import {
  computeGraphLayout,
  LANE_COLOR_COUNT
} from '../../src/renderer/src/components/git/commitGraphLayout'
import type { CommitGraphEntry } from '../../src/preload'

/** Minimal commit factory — only sha + parents matter for layout. */
function c(sha: string, parents: string[] = []): CommitGraphEntry {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    parents,
    subject: sha,
    authorName: 'test',
    authorEmail: 't@t.t',
    authorDate: 0,
    refs: []
  }
}

describe('computeGraphLayout', () => {
  it('returns empty layout for no commits', () => {
    const layout = computeGraphLayout([])
    expect(layout.rows).toEqual([])
    expect(layout.maxColumns).toBe(0)
  })

  it('lays a linear history in a single column', () => {
    // a -> b -> c (a is newest, c is root)
    const layout = computeGraphLayout([c('a', ['b']), c('b', ['c']), c('c', [])])
    expect(layout.maxColumns).toBe(1)
    for (const row of layout.rows) {
      expect(row.nodeColumn).toBe(0)
    }
    // First commit (tip): no merge-in, one branch-out continuing to its parent.
    expect(layout.rows[0].mergeIns).toEqual([])
    expect(layout.rows[0].branchOuts).toEqual([{ toColumn: 0, color: 0 }])
    // Middle commit: incoming from column 0, outgoing to column 0.
    expect(layout.rows[1].mergeIns).toEqual([{ fromColumn: 0, color: 0 }])
    expect(layout.rows[1].branchOuts).toEqual([{ toColumn: 0, color: 0 }])
    // Root commit: incoming only, no branch-out.
    expect(layout.rows[2].mergeIns).toEqual([{ fromColumn: 0, color: 0 }])
    expect(layout.rows[2].branchOuts).toEqual([])
    // Every row occupies exactly one column → compact per-row gutter.
    for (const row of layout.rows) {
      expect(row.columns).toBe(1)
    }
  })

  it('sets per-row columns to the widest lane each row touches', () => {
    //   a (parent c)
    //   b (parent c)   -- second tip in a new lane
    //   c (root)
    const layout = computeGraphLayout([c('a', ['c']), c('b', ['c']), c('c', [])])
    // Row a only uses column 0 so far → 1 column.
    expect(layout.rows[0].columns).toBe(1)
    // Row b adds lane 1 (its node) while lane 0 passes through → 2 columns.
    expect(layout.rows[1].columns).toBe(2)
    // Row c is reached by both lanes (merge-ins at col 0 and 1) → 2 columns.
    expect(layout.rows[2].columns).toBe(2)
  })

  it('opens a second lane for a fork and keeps both as through-lines', () => {
    //   a (parent c)
    //   b (parent c)   -- b is a separate tip
    //   c (root)
    // a and b both descend from c. Display order a, b, c.
    const layout = computeGraphLayout([c('a', ['c']), c('b', ['c']), c('c', [])])
    expect(layout.maxColumns).toBe(2)
    // a opens lane 0 waiting for c; b is a fresh tip in lane 1 waiting for c.
    expect(layout.rows[0].nodeColumn).toBe(0)
    expect(layout.rows[1].nodeColumn).toBe(1)
    // Row b should carry a through-line for lane 0 (a's lane, still waiting c).
    expect(layout.rows[1].through).toContainEqual({ fromColumn: 0, toColumn: 0, color: 0 })
    // c is reached by both lanes -> two merge-ins, node in the leftmost (0).
    expect(layout.rows[2].nodeColumn).toBe(0)
    expect(layout.rows[2].mergeIns).toEqual(
      expect.arrayContaining([
        { fromColumn: 0, color: expect.any(Number) },
        { fromColumn: 1, color: expect.any(Number) }
      ])
    )
    expect(layout.rows[2].mergeIns).toHaveLength(2)
  })

  it('handles a merge commit with two distinct parents', () => {
    //   m  (merge of a and b)
    //   a  (parent base)
    //   b  (parent base)
    //   base (root)
    const layout = computeGraphLayout([
      c('m', ['a', 'b']),
      c('a', ['base']),
      c('b', ['base']),
      c('base', [])
    ])
    // m is a tip in lane 0; first parent a stays lane 0, second parent b opens lane 1.
    expect(layout.rows[0].nodeColumn).toBe(0)
    expect(layout.rows[0].branchOuts).toEqual([
      { toColumn: 0, color: expect.any(Number) },
      { toColumn: 1, color: expect.any(Number) }
    ])
    // base is the shared parent reached by both lanes -> two merge-ins.
    const baseRow = layout.rows[3]
    expect(baseRow.sha).toBe('base')
    expect(baseRow.mergeIns).toHaveLength(2)
    expect(baseRow.branchOuts).toEqual([])
  })

  it('handles an octopus merge (3 parents) opening multiple lanes', () => {
    const layout = computeGraphLayout([
      c('m', ['p1', 'p2', 'p3']),
      c('p1', []),
      c('p2', []),
      c('p3', [])
    ])
    expect(layout.rows[0].branchOuts).toHaveLength(3)
    expect(layout.maxColumns).toBeGreaterThanOrEqual(3)
  })

  it('supports multiple independent roots', () => {
    const layout = computeGraphLayout([c('a', []), c('b', [])])
    // Two unrelated tips/roots, each its own node, no parents.
    expect(layout.rows[0].branchOuts).toEqual([])
    expect(layout.rows[1].branchOuts).toEqual([])
  })

  it('keeps color indices within the palette range', () => {
    const commits: CommitGraphEntry[] = []
    for (let i = 0; i < 50; i++) {
      commits.push(c(`t${i}`, []))
    }
    const layout = computeGraphLayout(commits)
    for (const row of layout.rows) {
      expect(row.nodeColor).toBeGreaterThanOrEqual(0)
      expect(row.nodeColor).toBeLessThan(LANE_COLOR_COUNT)
    }
  })
})
