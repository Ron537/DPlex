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
 * keeps footer actions in normal flow so they wrap rather than being clipped.
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

  test('card actions are visible at rest and keyboard management does not resume the space', async () => {
    if (!window) throw new Error('Window not available')
    const card = window.getByTestId('space-card-a')
    const resume = window.getByTestId('card-resume-a')
    await expect(card).toBeVisible()
    await window.mouse.move(0, 0)
    expect(await resume.evaluate((el) => el.checkVisibility({ checkOpacity: true }))).toBe(true)
    const rename = card.getByRole('button', { name: 'Rename Refactor auth' })
    const remove = card.getByRole('button', { name: 'Delete Refactor auth' })
    expect(await rename.evaluate((el) => el.checkVisibility({ checkOpacity: true }))).toBe(true)
    expect(await remove.evaluate((el) => el.checkVisibility({ checkOpacity: true }))).toBe(true)

    await window.keyboard.press('Tab')
    await card.focus()
    await expect(card).toHaveCSS('outline-style', 'solid')
    await expect(rename).toHaveCSS('opacity', '1')
    await rename.focus()
    await window.keyboard.press('Enter')
    await expect(
      window.getByPlaceholder('e.g. Ship OAuth, Fix flaky tests, Perf pass')
    ).toHaveValue('Refactor auth')
    await expect(window.getByTestId('space-switcher-button')).toHaveCount(0)
    await window.keyboard.press('Escape')
    await expect(card).toBeVisible()
  })

  test('workspace search and attention filters show matching spaces without switching', async () => {
    if (!window) throw new Error('Window not available')
    const search = window.getByRole('textbox', { name: 'Find a space' })
    await search.fill('  REFACTOR  ')
    await expect(window.getByTestId('space-card-a')).toBeVisible()
    await expect(window.locator('[data-testid^="space-card-"]')).toHaveCount(1)
    await search.fill('No such workspace')
    await expect(window.getByRole('status')).toContainText('No spaces match your search.')
    await window.getByRole('button', { name: 'Show all spaces' }).click()
    await expect(search).toHaveValue('')
    await expect(window.locator('[data-testid^="space-card-"]')).toHaveCount(6)
    await window.getByRole('button', { name: 'Needs attention 0', exact: true }).click()
    await expect(window.getByRole('status')).toContainText('No spaces need your attention.')
    await expect(window.getByTestId('space-switcher-button')).toHaveCount(0)
    await window.getByRole('button', { name: 'Show all spaces' }).click()
    await expect(window.getByTestId('space-card-a')).toBeVisible()
  })

  test('attention filter follows pending requests and excludes finished notifications', async () => {
    if (!window) throw new Error('Window not available')
    await window.evaluate(() => localStorage.setItem('dplex-demo', '1'))
    await window.reload()
    await expect(window.getByTestId('space-card-a')).toBeVisible()
    await window.evaluate(() => {
      const hatch = (
        window as unknown as {
          __dplex: {
            attentionStore: { setState: (state: { active: unknown[] }) => void }
          }
        }
      ).__dplex
      hatch.attentionStore.setState({
        active: [
          {
            compositeId: 'copilot-cli:sess-2',
            providerId: 'copilot-cli',
            sessionId: 'sess-2',
            displayName: 'Session 2',
            kind: 'waitingForApproval',
            createdAt: Date.now(),
            suppressed: false
          }
        ]
      })
    })
    const filter = window.getByRole('button', { name: 'Needs attention 1', exact: true })
    await filter.click()
    await expect(window.locator('[data-testid^="space-card-"]')).toHaveCount(1)
    await expect(window.getByTestId('space-card-a')).toBeVisible()
    await window.evaluate(() => {
      const hatch = (
        window as unknown as {
          __dplex: {
            attentionStore: {
              getState: () => { active: Array<Record<string, unknown>> }
              setState: (state: { active: unknown[] }) => void
            }
          }
        }
      ).__dplex
      hatch.attentionStore.setState({
        active: hatch.attentionStore
          .getState()
          .active.map((event) => ({ ...event, kind: 'finished' }))
      })
    })
    await expect(window.getByRole('status')).toContainText('No spaces need your attention.')
    await window.getByRole('button', { name: 'Show all spaces' }).click()
    await expect(window.getByTestId('space-card-a')).toContainText('1 done')
  })

  test('cards stay within a narrow workspace and respect reduced motion', async () => {
    if (!window || !app) throw new Error('Window not available')
    await window.emulateMedia({ reducedMotion: 'reduce' })
    await resize(app, 800, 600)
    // Widen the sidebar so the workspace is narrower than the usual card minimum.
    await window.evaluate(async () => {
      // @ts-expect-error: dplex is exposed by preload
      await window.dplex.settings.merge({ sidebarWidth: 480 })
    })
    await window.reload()
    const card = window.getByTestId('space-card-a')
    await expect(card).toBeVisible()
    await expect(card).toHaveCSS('animation-name', 'none')
    const bounds = await card.boundingBox()
    const viewportWidth = await window.evaluate(() => innerWidth)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewportWidth)
    const { overlaps, cards } = await measureLayout(window)
    expect(overlaps).toEqual([])
    expect(cards.filter((c) => c.resumeCut)).toEqual([])
    await card.scrollIntoViewIfNeeded()
    const before = await card.boundingBox()
    await card.hover()
    expect(await card.boundingBox()).toEqual(before)
  })
})
