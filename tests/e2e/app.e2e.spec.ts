import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp } from './support/electronApp'

test.describe('DPlex Electron app', () => {
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

  test('renders main layout and status controls', async () => {
    if (!window) throw new Error('Window not available')
    await expect(window.getByText('DPlex')).toBeVisible()
    await expect(window.getByRole('tab', { name: 'Projects' })).toBeVisible()
    await expect(window.getByPlaceholder('Search projects...')).toBeVisible()
    await expect(window.getByText(/terminals? · \d+ groups?/)).toBeVisible()
  })

  test('opens settings and navigates tabs', async () => {
    if (!window) throw new Error('Window not available')
    await window.getByTitle('Settings', { exact: true }).click()
    // After the visual refresh the modal opens directly into the
    // Appearance tab — no longer a "Settings" wordmark in the header.
    await expect(window.getByRole('heading', { name: 'Appearance' })).toBeVisible()

    await window.getByRole('button', { name: 'Notifications' }).click()
    await expect(window.getByText('Enable notifications')).toBeVisible()

    await window.getByRole('button', { name: 'Shortcuts' }).click()
    // The Shortcuts pane has a "General" section heading rendered as <h4>;
    // disambiguate from the left-rail "General" group label (<h3>).
    await expect(window.locator('h4').filter({ hasText: 'General' })).toBeVisible()

    await window.keyboard.press('Escape')
    await expect(window.getByText('Enable notifications')).toHaveCount(0)
  })

  test('creates a terminal and splits groups', async () => {
    if (!window) throw new Error('Window not available')
    await window.getByTitle('New terminal (default shell)').click()
    await expect(window.getByText(/2 terminals? · 1 groups?/)).toBeVisible()

    const splitButtonsBefore = await window.getByTitle('Split right').count()
    await window.getByTitle('Split right').first().click()
    await expect(window.getByTitle('Split right')).toHaveCount(splitButtonsBefore + 1)
  })
})
