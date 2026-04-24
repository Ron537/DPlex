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
    await expect(window.getByRole('button', { name: 'Projects', exact: true })).toBeVisible()
    await expect(window.getByPlaceholder('Search projects...')).toBeVisible()
    await expect(window.getByText(/terminals? · \d+ groups?/)).toBeVisible()
  })

  test('opens settings and navigates tabs', async () => {
    if (!window) throw new Error('Window not available')
    await window.getByTitle('Settings', { exact: true }).click()
    await expect(window.getByText('Settings')).toBeVisible()

    await window.getByRole('button', { name: 'Notifications' }).click()
    await expect(window.getByText('Enable notifications')).toBeVisible()

    await window.getByRole('button', { name: 'Shortcuts' }).click()
    await expect(window.getByText('General')).toBeVisible()

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
