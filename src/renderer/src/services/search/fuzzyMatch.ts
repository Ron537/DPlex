import type { MatchRange } from './types'

/** Result of a fuzzy match attempt.
 *  `score` is higher = better. `null` is returned when no match is possible. */
export interface FuzzyMatchResult {
  score: number
  /** Sorted, non-overlapping spans of matched characters in `text`. */
  ranges: MatchRange[]
}

/**
 * Subsequence-based fuzzy match. The query characters must appear in the
 * text in order, but not necessarily contiguously. Scoring rewards:
 * - prefix matches (text starts with query)
 * - exact substring matches
 * - consecutive matched characters
 * - matches at word boundaries (after space, /, -, _, .)
 * - early matches (closer to start of text)
 *
 * Case-insensitive.
 */
export function fuzzyMatch(text: string, query: string): FuzzyMatchResult | null {
  if (!query) {
    return { score: 0, ranges: [] }
  }
  if (!text) return null

  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()

  // Fast path: substring match — strongly preferred over a scattered subsequence.
  const idx = lowerText.indexOf(lowerQuery)
  if (idx !== -1) {
    let score = 1000 - idx // earlier is better
    if (idx === 0) score += 500 // prefix bonus
    if (isWordBoundary(lowerText, idx)) score += 100
    score += lowerQuery.length * 5 // longer match → higher score
    return {
      score,
      ranges: [{ start: idx, end: idx + lowerQuery.length }]
    }
  }

  // Subsequence match.
  const ranges: MatchRange[] = []
  let qi = 0
  let runStart = -1
  let consecutive = 0
  let score = 0
  for (let ti = 0; ti < lowerText.length && qi < lowerQuery.length; ti++) {
    if (lowerText[ti] === lowerQuery[qi]) {
      if (runStart === -1) runStart = ti
      consecutive++
      // Reward consecutive matches and word-boundary matches.
      score += 10
      score += consecutive * 5
      if (isWordBoundary(lowerText, ti)) score += 20
      qi++
    } else {
      if (runStart !== -1) {
        ranges.push({ start: runStart, end: ti })
        runStart = -1
      }
      consecutive = 0
      score -= 1 // small penalty per skipped char
    }
  }
  if (qi < lowerQuery.length) return null
  if (runStart !== -1) {
    // Trailing run — close it at the position just past the last matched char.
    // We tracked consecutive separately; runStart..(runStart + consecutive)
    // is the open run we never closed.
    ranges.push({ start: runStart, end: runStart + consecutive })
  }

  // Earlier matches are slightly preferred.
  if (ranges.length > 0) score += Math.max(0, 50 - ranges[0].start)

  return { score, ranges: mergeRanges(ranges) }
}

/**
 * Run fuzzy match across multiple candidate strings (e.g. label + keywords)
 * and return the best result. Ranges always refer to the **first** candidate
 * (the label) — keyword matches contribute to scoring only.
 */
export function fuzzyMatchAny(
  label: string,
  keywords: readonly string[] | undefined,
  query: string
): FuzzyMatchResult | null {
  const labelMatch = fuzzyMatch(label, query)
  if (labelMatch) return labelMatch
  if (!keywords || keywords.length === 0) return null
  for (const kw of keywords) {
    const m = fuzzyMatch(kw, query)
    if (m) {
      // Keyword-only matches don't produce label ranges (the label has no
      // matched chars). They still rank, but below any label match.
      return { score: m.score - 200, ranges: [] }
    }
  }
  return null
}

function isWordBoundary(text: string, idx: number): boolean {
  if (idx === 0) return true
  const prev = text.charCodeAt(idx - 1)
  // space, /, \, -, _, ., : — common separators in our domain (paths, ids).
  return (
    prev === 32 ||
    prev === 47 ||
    prev === 92 ||
    prev === 45 ||
    prev === 95 ||
    prev === 46 ||
    prev === 58
  )
}

function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  if (ranges.length <= 1) return ranges.map((r) => ({ ...r }))
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const out: MatchRange[] = [{ ...sorted[0] }]
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1]
    const cur = sorted[i]
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end)
    } else {
      out.push({ ...cur })
    }
  }
  return out
}
