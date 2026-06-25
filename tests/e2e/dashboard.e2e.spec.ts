import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp } from './support/electronApp'

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
})
