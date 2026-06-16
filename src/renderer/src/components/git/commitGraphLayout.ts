/**
 * Pure swim-lane layout for the commit graph. Mirrors the approach used by
 * VSCode / common git-graph renderers: lanes are columns; each commit sits in
 * a lane, merges terminate INTO the node, and parents branch OUT of it.
 *
 * No React / DOM / git dependencies — trivially unit-testable. The renderer
 * maps the integer `color` indices onto CSS colors (so theming stays in the
 * view layer and lane colors can adapt to light/dark).
 *
 * Input commits MUST be in display order (reverse-chronological, as produced
 * by `git log --date-order`): a child always appears before its parents.
 */

import type { CommitGraphEntry } from '../../../../preload'

/** Number of distinct lane colors. The renderer supplies the actual palette. */
export const LANE_COLOR_COUNT = 8

/** A lane passing the full height of a row's cell without touching the node. */
export interface ThroughLine {
  /** Column at the top boundary of the cell. */
  fromColumn: number
  /** Column at the bottom boundary of the cell. */
  toColumn: number
  /** Palette color index. */
  color: number
}

/** A line from a top-boundary column into the commit node (a merge-in). */
export interface MergeIn {
  fromColumn: number
  color: number
}

/** A line from the commit node out to a bottom-boundary column (a parent). */
export interface BranchOut {
  toColumn: number
  color: number
}

/** Fully-resolved layout for a single commit row. */
export interface GraphCommitRow {
  sha: string
  /** Column the commit's node is drawn in. */
  nodeColumn: number
  /** Palette color index for the node + its first-parent lane. */
  nodeColor: number
  /** Lanes that bypass the node (drawn as full-height curves). */
  through: ThroughLine[]
  /** Lines entering the node from above (the node's own incoming + merges). */
  mergeIns: MergeIn[]
  /** Lines leaving the node downward (one per parent). */
  branchOuts: BranchOut[]
  /** Number of lane columns this row actually occupies (node + any lanes
   *  passing through / merging / branching). Drives a per-row gutter width so
   *  single-lane commits keep their text close to the line instead of being
   *  pushed right by the graph's widest row. */
  columns: number
}

export interface GraphLayout {
  rows: GraphCommitRow[]
  /** Max number of columns used by any row — drives the gutter width. */
  maxColumns: number
}

interface Lane {
  /** SHA this lane is currently waiting to reach as we scan downward. */
  sha: string
  color: number
}

/**
 * Compute the swim-lane layout for an ordered list of commits.
 */
export function computeGraphLayout(commits: CommitGraphEntry[]): GraphLayout {
  const rows: GraphCommitRow[] = []
  // Lanes entering the current row from above. `null` = empty column.
  const lanes: (Lane | null)[] = []
  let nextColor = 0
  const newColor = (): number => {
    const c = nextColor % LANE_COLOR_COUNT
    nextColor++
    return c
  }
  const firstNull = (arr: (Lane | null)[]): number => {
    const idx = arr.indexOf(null)
    return idx === -1 ? arr.length : idx
  }

  let maxColumns = 0

  for (const commit of commits) {
    // Snapshot the incoming lane state (top boundary of this cell).
    const topLanes = lanes.slice()

    // Which lanes were waiting for this commit? They all converge on the node.
    const matching: number[] = []
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i]?.sha === commit.sha) matching.push(i)
    }

    let nodeColumn: number
    let nodeColor: number
    if (matching.length > 0) {
      nodeColumn = matching[0]
      nodeColor = lanes[nodeColumn]!.color
    } else {
      // A branch tip nothing points at yet — open a fresh lane for it.
      nodeColumn = firstNull(lanes)
      nodeColor = newColor()
      if (nodeColumn === lanes.length) lanes.push(null)
    }

    // Free the extra converging lanes (merges terminating at the node).
    for (let k = 1; k < matching.length; k++) {
      lanes[matching[k]] = null
    }

    const parents = commit.parents
    const branchOuts: BranchOut[] = []

    if (parents.length === 0) {
      // Root / parentless: the node's lane ends here.
      lanes[nodeColumn] = null
    } else {
      // First parent continues the node's lane + color.
      lanes[nodeColumn] = { sha: parents[0], color: nodeColor }
      branchOuts.push({ toColumn: nodeColumn, color: nodeColor })

      // Additional parents (merge) open new lanes — unless that parent is
      // already expected by an existing lane (shared history), in which case
      // we branch into that lane instead of duplicating it.
      for (let p = 1; p < parents.length; p++) {
        const psha = parents[p]
        const existing = lanes.findIndex((l) => l?.sha === psha)
        if (existing !== -1) {
          branchOuts.push({ toColumn: existing, color: lanes[existing]!.color })
          continue
        }
        const col = firstNull(lanes)
        if (col === lanes.length) lanes.push(null)
        const color = newColor()
        lanes[col] = { sha: psha, color }
        branchOuts.push({ toColumn: col, color })
      }
    }

    // Trim trailing empty lanes so the gutter doesn't grow unbounded.
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()

    // Merge-ins: every converging top lane draws a line into the node.
    const mergeIns: MergeIn[] = matching.map((col) => ({
      fromColumn: col,
      color: topLanes[col]!.color
    }))

    // Through lanes: any top lane NOT converging on this node continues
    // straight down at the same column (columns are stable for survivors).
    const through: ThroughLine[] = []
    for (let i = 0; i < topLanes.length; i++) {
      const top = topLanes[i]
      if (!top) continue
      if (matching.includes(i)) continue // handled by mergeIns
      through.push({ fromColumn: i, toColumn: i, color: top.color })
    }

    // Widest column this row actually draws into — used for a per-row gutter
    // width so single-lane rows don't inherit the graph's global width.
    let rowMax = nodeColumn
    for (const t of through) rowMax = Math.max(rowMax, t.fromColumn, t.toColumn)
    for (const m of mergeIns) rowMax = Math.max(rowMax, m.fromColumn)
    for (const b of branchOuts) rowMax = Math.max(rowMax, b.toColumn)

    rows.push({
      sha: commit.sha,
      nodeColumn,
      nodeColor,
      through,
      mergeIns,
      branchOuts,
      columns: rowMax + 1
    })
    maxColumns = Math.max(maxColumns, topLanes.length, lanes.length, nodeColumn + 1)
  }

  return { rows, maxColumns }
}
