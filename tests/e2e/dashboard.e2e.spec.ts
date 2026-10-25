import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp } from './support/electronApp'
import type { DashboardMetrics } from '../../src/preload'

/**
 * E2E coverage for the Overview Dashboard tab: the activity-bar entry opens
 * (and focuses, never duplicates) a dashboard tab, and the core cards render.
 */
test.describe('DPlex dashboard', () => {
  let app: ElectronApplication | undefined
  let window: Page | undefined
  let userDataDir: string | undefined

  test.beforeEach(async () => {
    const launched = await launchApp()
    app = launched.app
    window = launched.window
    userDataDir = launched.userDataDir
  })

  test.afterEach(async () => {
    await closeApp(app, userDataDir)
  })

  test('activity-bar button opens and focuses a single dashboard tab', async () => {
    if (!window) throw new Error('Window not available')

    const button = window.getByTestId('activity-bar-dashboard')
    await expect(button).toBeVisible()

    await button.click()

    // The dashboard renders its "Overview" heading and key cards.
    await expect(window.getByRole('heading', { name: 'Overview' })).toBeVisible()
    await expect(window.getByText('Active now', { exact: true })).toBeVisible()
    await expect(window.getByText('Needs you', { exact: true })).toBeVisible()
    await expect(window.getByText('Status right now', { exact: true })).toBeVisible()

    // A dashboard tab now exists in the tab strip.
    const dashTabs = window.getByTestId('editor-tab-label').filter({ hasText: 'Dashboard' })
    await expect(dashTabs).toHaveCount(1)

    // Tier-1 housekeeping + cadence cards render.
    await expect(window.getByText('Oldest awaiting you', { exact: true })).toBeVisible()
    await expect(window.getByText('Stale sessions', { exact: true })).toBeVisible()
    await expect(window.getByText('Longest active', { exact: true })).toBeVisible()
    await expect(window.getByText('Uncommitted', { exact: true })).toBeVisible()
    await expect(window.getByText('Your cadence', { exact: true })).toBeVisible()
    await expect(window.getByText('Provider mix', { exact: true })).toBeVisible()

    // Clicking again focuses the existing tab rather than creating a second.
    await button.click()
    await expect(dashTabs).toHaveCount(1)
    await expect(window.getByRole('heading', { name: 'Overview' })).toBeVisible()
  })

  test('window selector switches the historical aggregation range', async () => {
    if (!window) throw new Error('Window not available')

    await window.getByTestId('activity-bar-dashboard').click()
    await expect(window.getByRole('heading', { name: 'Overview' })).toBeVisible()

    // Switching to the 7-day window updates the meta labels on the cards.
    await window.getByRole('button', { name: '7d', exact: true }).click()
    await expect(window.getByText('last 7 days · by provider')).toBeVisible()
  })

  test('clicking the Active now KPI reveals the Sessions sidebar with a status filter', async () => {
    if (!window) throw new Error('Window not available')

    await window.getByTestId('activity-bar-dashboard').click()
    await expect(window.getByRole('heading', { name: 'Overview' })).toBeVisible()

    // The KPI card is a button; clicking it should switch the sidebar to the
    // Sessions view (its search box becomes visible)…
    await window.getByText('Active now', { exact: true }).click()
    await expect(window.getByPlaceholder('Search sessions...')).toBeVisible()

    // …and the requested status filter must actually be applied — verifying the
    // request survives the panel not being mounted at click time (the filter
    // toggle reflects active filters via aria-pressed).
    await expect(window.getByTestId('sessions-filter-toggle')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  test('dense activity charts keep weekday labels readable', async () => {
    if (!window || !app) throw new Error('Window not available')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1000, 720))
    await window.getByTestId('activity-bar-dashboard').click()
    await window.getByRole('button', { name: '90d', exact: true }).click()
    await expect(window.getByText('last 90 days · by provider')).toBeVisible()
    const axis = window.getByTestId('activity-chart-axis')
    await expect(axis.locator('span > span').first()).toBeVisible()
    const report = await axis.evaluate((el) => {
      const labels = [...el.querySelectorAll<HTMLElement>(':scope > span > span')]
      return labels.map((label, i) => {
        const rect = label.getBoundingClientRect()
        const previous = labels[i - 1]?.getBoundingClientRect()
        return {
          clipped: getComputedStyle(label.parentElement!).overflowX === 'hidden',
          overlaps: previous ? previous.right > rect.left : false
        }
      })
    })
    expect(report.length).toBeGreaterThan(1)
    expect(report.every((label) => !label.clipped && !label.overlaps)).toBe(true)
  })

  test('mission-control panels fit a narrow split without pushing outside the workspace', async () => {
    if (!window || !app) throw new Error('Window not available')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1000, 720))
    await window.getByTestId('activity-bar-dashboard').click()
    await window.getByTitle('Split right', { exact: true }).first().click()
    const page = window.locator('.dplex-mission-page').first()
    await expect(page).toBeVisible()
    expect(await page.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
    const mainCards = page.locator('.dplex-mission-metrics > button')
    await expect(mainCards).toHaveCount(4)
    const rectangles = await mainCards.evaluateAll((elements) =>
      elements.map((el) => ({
        left: el.getBoundingClientRect().left,
        width: el.getBoundingClientRect().width
      }))
    )
    expect(new Set(rectangles.map((rect) => rect.left)).size).toBe(1)
    expect(rectangles.every((rect) => rect.width > 120)).toBe(true)
  })

  test('activity bars fill a tall card and resize correctly when cards stack', async () => {
    if (!window || !app) throw new Error('Window not available')
    await window.evaluate(() => localStorage.setItem('dplex-demo', '1'))
    await window.reload()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1400, 900))
    await window.getByTestId('activity-bar-dashboard').click()
    await expect(window.getByTestId('activity-chart-axis')).toBeVisible()
    await window.evaluate(() => {
      const store = (
        window as unknown as {
          __dplex: {
            dashboardStore: {
              getState: () => { metrics: DashboardMetrics | null }
              setState: (patch: { metrics: DashboardMetrics; dirty: boolean }) => void
            }
          }
        }
      ).__dplex.dashboardStore
      const metrics = store.getState().metrics
      if (!metrics) throw new Error('Dashboard metrics not loaded')
      store.setState({
        dirty: false,
        metrics: {
          ...metrics,
          overTime: [2, 4, 0].map((total, i) => ({
            dateMs: Date.now() - (2 - i) * 86_400_000,
            total,
            byProvider: { 'copilot-cli': total / 2, 'claude-code': total / 2 }
          })),
          providerSplit: [
            { providerId: 'copilot-cli', sessions: 3 },
            { providerId: 'claude-code', sessions: 3 }
          ],
          topRepos: Array.from({ length: 8 }, (_, i) => ({
            repo: `chart-layout-repo-${i}`,
            cwd: null,
            sessions: 8 - i,
            messages: 0,
            toolCalls: 0,
            lastActiveMs: Date.now(),
            branches: ['main']
          }))
        }
      })
    })

    const card = window.locator('.dplex-dashboard-card').filter({
      has: window.getByRole('heading', { name: 'Session activity', exact: true })
    })
    const measure = (): Promise<{ height: number; barHeights: number[]; bottomGap: number }> =>
      card.evaluate((el) => {
        const chart = el.lastElementChild!.firstElementChild!
        const plot = chart.firstElementChild!
        const bars = plot.querySelectorAll<HTMLElement>('[data-activity-bar]')
        const legend = chart.lastElementChild!
        const style = getComputedStyle(el)
        return {
          height: plot.getBoundingClientRect().height,
          barHeights: [...bars].map((bar) => bar.getBoundingClientRect().height),
          bottomGap:
            el.getBoundingClientRect().bottom -
            parseFloat(style.paddingBottom) -
            parseFloat(style.borderBottomWidth) -
            legend.getBoundingClientRect().bottom
        }
      })
    await card.scrollIntoViewIfNeeded()
    await expect.poll(async () => (await measure()).height).toBeGreaterThan(300)
    const wide = await measure()
    expect(Math.abs(wide.bottomGap)).toBeLessThanOrEqual(2)
    expect(wide.barHeights[0]).toBeCloseTo(wide.height / 2, 0)
    expect(wide.barHeights[1]).toBeCloseTo(wide.height, 0)
    expect(wide.barHeights[2]).toBe(0)
    await card.screenshot({ path: test.info().outputPath('activity-chart-wide.png') })

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(800, 900))
    await expect.poll(async () => (await measure()).height).toBeLessThan(wide.height)
    const narrow = await measure()
    expect(narrow.height).toBeGreaterThanOrEqual(150)
    expect(Math.abs(narrow.bottomGap)).toBeLessThanOrEqual(2)
    expect(narrow.barHeights[0]).toBeCloseTo(narrow.height / 2, 0)
    expect(narrow.barHeights[1]).toBeCloseTo(narrow.height, 0)
    await card.screenshot({ path: test.info().outputPath('activity-chart-narrow.png') })
  })
})
