import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp } from './support/electronApp'

/**
 * E2E coverage for the Spaces Overview grid layout.
 *
 * Regression guard for the card layout bugs seen on smaller screens:
 *   1. Cards overlapped each other — the grid doubled as a fixed-height scroll
 *      container, so `align-content: start` collapsed the auto row tracks to a
 *      sliver (each card's `overflow: hidden` zeroes its grid min-size) and the
 *      full-height cards spilled over one another.
 *   2. Cards in the same row rendered at different heights.
 *   3. The footer action buttons (Rename / Delete / Resume) were clipped by the
 *      card's `overflow: hidden` on narrow cards.
 *
 * The fix moves scrolling to a wrapper (the grid is now natural-height, so rows
 * size to content), restores per-row equal heights via the default stretch, and
 * renders the hover actions as a right-pinned overlay that never overflows.
 *
 * These tests assert, against the real rendered app, that no two cards overlap,
 * that every card's Resume button stays within the card bounds, and that cards
 * sharing a row have equal heights.
 */

type Tab = {
  id: string
  title: string
  kind: 'terminal'
  command: string
  sessionId: string
  providerId: string
}

function workspace(tabCount: number): Record<string, unknown> {
  if (tabCount === 0) {
    return { layout: { type: 'group' }, groups: [], activeGroupId: null }
  }
  const tabs: Tab[] = Array.from({ length: tabCount }, (_, i) => ({
    id: `t${i}`,
    title: `Session ${i}`,
    kind: 'terminal',
    command: 'copilot',
    sessionId: `sess-${i}`,
    providerId: 'copilot-cli'
  }))
  return {
    layout: { type: 'group', groupId: 'g1' },
    groups: [{ id: 'g1', tabs, activeTabId: 't0' }],
    activeGroupId: 'g1'
  }
}

function space(id: string, name: string, color: string, tabCount: number): Record<string, unknown> {
  const now = Date.now()
  return {
    id,
    name,
    color,
    projectIds: [],
    workspace: workspace(tabCount),
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now
  }
}

// Six background spaces with very different content volumes so the grid spans
// multiple rows and mixes tall/short cards — the exact conditions that produced
// the overlap + unequal-height + clipped-button bugs. No active space, so the
// app boots straight into the Overview.
const SEED_SPACES = {
  version: 1,
  activeSpaceId: null,
  spaces: [
    space('a', 'Refactor auth', '#8b5cf6', 3),
    space('b', 'Flaky CI', '#22d3ee', 0),
    space('c', 'Reading notes', '#f59e0b', 1),
    space('d', 'Release 2.0', '#3b82f6', 0),
    space('e', 'Perf pass', '#10b981', 0),
    space('f', 'Docs sweep', '#a855f7', 2)
  ]
}

type CardMetric = {
  id: string | null
  top: number
  bottom: number
  left: number
  right: number
  height: number
  resumeCut: boolean
}

type LayoutReport = {
  cards: CardMetric[]
  overlaps: string[]
  unequalRows: { top: number; heights: number[] }[]
}

async function measureLayout(window: Page): Promise<LayoutReport> {
  return window.evaluate(() => {
    const els = Array.from(
      document.querySelectorAll('[data-testid^="space-card-"]')
    ) as HTMLElement[]
    const cards = els.map((el) => {
      const r = el.getBoundingClientRect()
      const resume = el.querySelector('[data-testid^="card-resume-"]') as HTMLElement | null
      const rr = resume?.getBoundingClientRect()
      return {
        id: el.getAttribute('data-testid'),
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        left: Math.round(r.left),
        right: Math.round(r.right),
        height: Math.round(r.height),
        // The Resume button must stay within the card's box on every screen.
        resumeCut: rr ? rr.right > r.right + 0.5 || rr.left < r.left - 0.5 : false
      }
    })

    // True 2-D overlap: two cards overlap only if their boxes intersect on both
    // axes (same-row cards share a vertical band but are horizontally apart).
    const overlaps: string[] = []
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const a = cards[i]
        const b = cards[j]
        const v = a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5
        const h = a.left < b.right - 0.5 && b.left < a.right - 0.5
        if (v && h) overlaps.push(`${a.id} <> ${b.id}`)
      }
    }

    // Group cards by row (shared top) and flag rows whose cards differ in height.
    const rows = new Map<number, number[]>()
    for (const c of cards) {
      const key = Math.round(c.top / 6) * 6
      const arr = rows.get(key) ?? []
      arr.push(c.height)
      rows.set(key, arr)
    }
    const unequalRows: { top: number; heights: number[] }[] = []
    for (const [top, heights] of rows) {
      if (heights.length > 1 && Math.max(...heights) - Math.min(...heights) > 1) {
        unequalRows.push({ top, heights })
      }
    }

    return { cards, overlaps, unequalRows }
  })
}

async function resize(app: ElectronApplication, width: number, height: number): Promise<void> {
  await app.evaluate(
    async ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height)
    },
    { width, height }
  )
}

test.describe('Spaces Overview layout', () => {
  let app: ElectronApplication | undefined
  let window: Page | undefined
  let userDataDir: string | undefined

  test.beforeEach(async () => {
    const launched = await launchApp({ spaces: SEED_SPACES })
    app = launched.app
    window = launched.window
    userDataDir = launched.userDataDir
  })

  test.afterEach(async () => {
    await closeApp(app, userDataDir)
  })

  test('single-column: no overlap, no clipped buttons', async () => {
    if (!window || !app) throw new Error('Window not available')
    await expect(window.getByRole('heading', { name: 'Spaces' })).toBeVisible()

    await resize(app, 650, 720)
    await window.waitForTimeout(400)

    const { cards, overlaps } = await measureLayout(window)
    expect(cards.length).toBeGreaterThanOrEqual(6)
    expect(overlaps, `overlapping cards: ${overlaps.join(', ')}`).toEqual([])
    expect(cards.filter((c) => c.resumeCut).map((c) => c.id)).toEqual([])
    // Content-rich cards actually expand (the collapse bug rendered ~37px).
    expect(Math.max(...cards.map((c) => c.height))).toBeGreaterThan(150)
  })

  test('multi-column: no overlap, equal heights per row, no clipped buttons', async () => {
    if (!window || !app) throw new Error('Window not available')
    await expect(window.getByRole('heading', { name: 'Spaces' })).toBeVisible()

    await resize(app, 1000, 640)
    await window.waitForTimeout(400)

    const { cards, overlaps, unequalRows } = await measureLayout(window)
    expect(cards.length).toBeGreaterThanOrEqual(6)
    expect(overlaps, `overlapping cards: ${overlaps.join(', ')}`).toEqual([])
    expect(cards.filter((c) => c.resumeCut).map((c) => c.id)).toEqual([])
    expect(unequalRows, `rows with unequal card heights: ${JSON.stringify(unequalRows)}`).toEqual(
      []
    )
  })
})
