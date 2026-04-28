/**
 * Build a unified diff patch suitable for `git apply` from a pair of
 * texts and a set of selected line ranges.
 *
 * Used for hunk-level Stage / Unstage / Discard / Revert operations.
 *
 * The renderer never builds patches — it only reports the user's selected
 * ranges (1-based, inclusive, in the *modified* text the user sees on the
 * right pane). Main constructs the patch, runs `git apply --check`, and
 * (only on success) applies it.
 *
 * Modify-only: ADDED / DELETED / RENAMED files are handled via full-file
 * SCM ops (`stageFile` / `discardFile` / etc.), not via hunk patches.
 *
 * Implementation note: we use `diffLines` directly (not `structuredPatch`)
 * so we can split changes into atomic blocks and emit only the blocks
 * overlapping the user's selection. `structuredPatch` with default
 * `context: 3` would merge blocks ≤6 lines apart, making per-line staging
 * impossible.
 */

import { diffLines } from 'diff'

export interface BuildHunkPatchInput {
  /** Repo-relative POSIX path used in `a/<path>` / `b/<path>` headers. */
  gitPath: string
  /** Pre-image text (left side). Must match the on-disk pre-image byte-for-byte. */
  oldText: string
  /** Post-image text (right side). */
  newText: string
  /** 1-based inclusive line ranges in `newText` selected by the user. */
  selection: Array<{ startLine: number; endLine: number }>
  /** "\n" | "\r\n" — preserved on output lines. */
  eol: '\n' | '\r\n'
}

export interface BuildHunkPatchResult {
  /** Unified diff text suitable for `git apply` (always uses LF newlines
   *  inside the patch envelope; content lines preserve their own EOL). */
  patch: string
  /** True when at least one block overlapped the selection. */
  hasContent: boolean
}

const CONTEXT_LINES = 3

/** Atomic change block — output of the diff walker. */
interface ChangeBlock {
  /** 1-based first line in oldText being removed (0 when no removals). */
  oldStart: number
  /** Lines being removed from oldText. */
  oldRemoved: string[]
  /** 1-based first line in newText being added (0 when no additions). */
  newStart: number
  /** Lines being added to newText. */
  newAdded: string[]
  /**
   * 1-based inclusive line range in newText that this block "occupies"
   * for selection-overlap purposes. For pure deletions (newAdded empty),
   * this is the single line in newText at the deletion's anchor.
   */
  selectionRange: { startLine: number; endLine: number }
}

/** Split text into lines INCLUDING their trailing newline (if any). */
function splitKeepEol(text: string): string[] {
  if (text.length === 0) return []
  const out: string[] = []
  let pos = 0
  while (pos < text.length) {
    const nl = text.indexOf('\n', pos)
    if (nl === -1) {
      out.push(text.slice(pos))
      break
    }
    out.push(text.slice(pos, nl + 1))
    pos = nl + 1
  }
  return out
}

/** Walk diffLines output and emit one `ChangeBlock` per contiguous change. */
function walkChangeBlocks(oldText: string, newText: string): ChangeBlock[] {
  const parts = diffLines(oldText, newText)
  const blocks: ChangeBlock[] = []
  let oldLine = 1
  let newLine = 1
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    const lines = splitKeepEol(p.value)
    const lineCount = lines.length
    if (!p.added && !p.removed) {
      oldLine += lineCount
      newLine += lineCount
      continue
    }
    // A change block is a removed run optionally followed by an added run
    // (or vice versa). Coalesce a remove+add or add+remove pair into one block.
    let oldStart = 0
    let newStart = 0
    let removed: string[] = []
    let added: string[] = []
    if (p.removed) {
      oldStart = oldLine
      removed = lines
      oldLine += lineCount
      const next = parts[i + 1]
      if (next?.added) {
        const nextLines = splitKeepEol(next.value)
        newStart = newLine
        added = nextLines
        newLine += nextLines.length
        i++ // consume the paired added segment
      }
    } else if (p.added) {
      newStart = newLine
      added = lines
      newLine += lineCount
    }
    const selStart = added.length > 0 ? newStart : Math.max(1, newLine)
    const selEnd = added.length > 0 ? newStart + added.length - 1 : selStart
    blocks.push({
      oldStart,
      oldRemoved: removed,
      newStart,
      newAdded: added,
      selectionRange: { startLine: selStart, endLine: selEnd }
    })
  }
  return blocks
}

function blockOverlaps(
  block: ChangeBlock,
  selection: Array<{ startLine: number; endLine: number }>
): boolean {
  const { startLine, endLine } = block.selectionRange
  for (const sel of selection) {
    if (sel.endLine >= startLine && sel.startLine <= endLine) return true
  }
  return false
}

/**
 * Build a unified-diff patch text containing only blocks that overlap the
 * user's selection. Emits one `@@` hunk per (group of mergeable) blocks.
 * Adjacent selected blocks within `2*CONTEXT_LINES` of each other share a
 * single hunk so context lines aren't duplicated.
 */
export function buildHunkPatch(input: BuildHunkPatchInput): BuildHunkPatchResult {
  const { gitPath, oldText, newText, selection } = input
  const oldLines = splitKeepEol(oldText)
  const newLines = splitKeepEol(newText)

  const allBlocks = walkChangeBlocks(oldText, newText)
  const selected = allBlocks.filter((b) => blockOverlaps(b, selection))
  if (selected.length === 0) return { patch: '', hasContent: false }

  // Merge adjacent selected blocks whose context windows overlap.
  type Group = { blocks: ChangeBlock[] }
  const groups: Group[] = []
  for (const b of selected) {
    const last = groups[groups.length - 1]
    if (last) {
      const prev = last.blocks[last.blocks.length - 1]
      const prevOldEnd = prev.oldStart + prev.oldRemoved.length - 1 // 0 for pure-add → not great but works
      const prevAnchorOld = Math.max(prev.oldStart, prevOldEnd, prev.oldStart)
      const gap = b.oldStart > 0 && prevAnchorOld > 0 ? b.oldStart - prevAnchorOld - 1 : Infinity
      if (gap >= 0 && gap <= 2 * CONTEXT_LINES) {
        last.blocks.push(b)
        continue
      }
    }
    groups.push({ blocks: [b] })
  }

  const out: string[] = []
  out.push(`diff --git a/${gitPath} b/${gitPath}`)
  out.push(`--- a/${gitPath}`)
  out.push(`+++ b/${gitPath}`)

  for (const g of groups) {
    emitHunkForGroup(out, g.blocks, oldLines, newLines)
  }
  return { patch: out.join('\n') + '\n', hasContent: true }
}

/**
 * Emit one `@@ ... @@` hunk for a group of (possibly multiple) selected
 * change blocks, with shared context lines.
 *
 * For each selected block we already know its old/new line positions; we
 * compute the union range, expand by CONTEXT_LINES on each side (clamped
 * to file bounds), then walk old/new in lockstep emitting:
 *   - " line"  for unchanged context (drawn from oldLines, identical to new)
 *   - "-line"  for removed
 *   - "+line"  for added
 */
function emitHunkForGroup(
  out: string[],
  blocks: ChangeBlock[],
  oldLines: string[],
  newLines: string[]
): void {
  // Determine the OLD-text span this hunk covers.
  let oldFrom = Number.POSITIVE_INFINITY
  let oldTo = 0
  let newFrom = Number.POSITIVE_INFINITY
  let newTo = 0
  for (const b of blocks) {
    if (b.oldRemoved.length > 0) {
      oldFrom = Math.min(oldFrom, b.oldStart)
      oldTo = Math.max(oldTo, b.oldStart + b.oldRemoved.length - 1)
    }
    if (b.newAdded.length > 0) {
      newFrom = Math.min(newFrom, b.newStart)
      newTo = Math.max(newTo, b.newStart + b.newAdded.length - 1)
    }
  }
  // Pure-add hunks have no oldRemoved span — anchor on the line in OLD
  // immediately before the insertion point (derived from selectionRange).
  if (oldFrom === Number.POSITIVE_INFINITY) {
    // For pure-adds, blocks[0].newStart is the new-line where we insert;
    // the corresponding old-line position is newStart - (added before this point).
    // Approximate: use first selectionRange.startLine - 1 in old (= newStart-1).
    const anchor = Math.max(1, blocks[0].newStart)
    oldFrom = anchor
    oldTo = anchor - 1 // empty span
  }
  if (newFrom === Number.POSITIVE_INFINITY) {
    // Pure-delete: anchor in newText where the deletion would go.
    const newAnchor = blocks[0].selectionRange.startLine
    newFrom = newAnchor
    newTo = newAnchor - 1
  }

  // Expand by context, clamped to file bounds.
  const ctxOldStart = Math.max(1, oldFrom - CONTEXT_LINES)
  const ctxOldEnd = Math.min(oldLines.length, oldTo + CONTEXT_LINES)
  const ctxNewStart = Math.max(1, newFrom - CONTEXT_LINES)
  const ctxNewEnd = Math.min(newLines.length, newTo + CONTEXT_LINES)

  const oldHunkLines = ctxOldEnd >= ctxOldStart ? ctxOldEnd - ctxOldStart + 1 : 0
  const newHunkLines = ctxNewEnd >= ctxNewStart ? ctxNewEnd - ctxNewStart + 1 : 0

  out.push(formatHunkHeader(ctxOldStart, oldHunkLines, ctxNewStart, newHunkLines))

  // Walk in old/new lockstep within [ctxOldStart..ctxOldEnd] / [ctxNewStart..ctxNewEnd].
  // Build a sorted list of block boundaries to know when to switch from
  // context to remove/add segments.
  const sortedBlocks = blocks.slice().sort((a, b) => {
    const aOld = a.oldRemoved.length > 0 ? a.oldStart : a.newStart
    const bOld = b.oldRemoved.length > 0 ? b.oldStart : b.newStart
    return aOld - bOld
  })

  let oldCursor = ctxOldStart
  let newCursor = ctxNewStart
  for (const b of sortedBlocks) {
    // Pre-block context: emit lines from oldCursor up to b.oldStart-1 (or
    // for pure-adds, up to b.newStart-1's mirror in oldText).
    const blockOldStart = b.oldRemoved.length > 0 ? b.oldStart : b.oldStart // 0 for pure-add
    const blockNewStart = b.newAdded.length > 0 ? b.newStart : b.newStart
    if (b.oldRemoved.length > 0) {
      while (oldCursor < blockOldStart) {
        // Context: line is unchanged, emit from oldLines.
        emitLine(out, ' ', oldLines[oldCursor - 1])
        oldCursor++
        newCursor++
      }
    } else {
      // Pure-add: walk old/new context together until newCursor === blockNewStart.
      while (newCursor < blockNewStart && oldCursor <= ctxOldEnd) {
        emitLine(out, ' ', oldLines[oldCursor - 1])
        oldCursor++
        newCursor++
      }
    }
    // Removed lines.
    for (const removed of b.oldRemoved) {
      emitLine(out, '-', removed)
      oldCursor++
    }
    // Added lines.
    for (const added of b.newAdded) {
      emitLine(out, '+', added)
      newCursor++
    }
  }
  // Trailing context.
  while (oldCursor <= ctxOldEnd) {
    emitLine(out, ' ', oldLines[oldCursor - 1])
    oldCursor++
    newCursor++
  }
}

/**
 * Emit a single patch line plus the `\ No newline at end of file` sentinel
 * when the source line lacks a trailing newline. Only the LAST line of the
 * old or new text can lack a newline (per `splitKeepEol`), so this check
 * is sufficient — `git apply --check` would otherwise reject the patch
 * for files that don't end in `\n`.
 */
function emitLine(out: string[], prefix: ' ' | '-' | '+', line: string): void {
  out.push(prefix + stripEol(line))
  if (!line.endsWith('\n')) {
    out.push('\\ No newline at end of file')
  }
}

function stripEol(line: string): string {
  // `git apply` matches patch content against file bytes byte-for-byte
  // (minus the trailing `\n` which is the patch's line separator). For
  // CRLF source files, the `\r` must remain on the line so the patch
  // body reads " L1\r\n L2\r\n" — matching `L1\r`, `L2\r` in the source.
  if (line.endsWith('\n')) return line.slice(0, -1)
  return line
}

function formatHunkHeader(
  oldStart: number,
  oldLines: number,
  newStart: number,
  newLines: number
): string {
  // For empty old/new spans, git expects start=oldStart-1 with count=0
  // (the line *before* which insertions go). Our oldStart is already the
  // pre-context start, but if the hunk is purely additive at file start,
  // oldLines may be 0 and oldStart should be 0 too (per unified-diff spec).
  const oldRange =
    oldLines === 0
      ? `${Math.max(0, oldStart - 1)},0`
      : oldLines === 1
        ? `${oldStart}`
        : `${oldStart},${oldLines}`
  const newRange =
    newLines === 0
      ? `${Math.max(0, newStart - 1)},0`
      : newLines === 1
        ? `${newStart}`
        : `${newStart},${newLines}`
  return `@@ -${oldRange} +${newRange} @@`
}
