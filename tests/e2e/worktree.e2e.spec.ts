import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp } from './support/electronApp'

test.describe('DPlex worktree settings', () => {
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

  test('Worktrees tab in Settings shows defaults form and persists changes', async () => {
    if (!window) throw new Error('Window not available')

    await window.getByTitle('Settings', { exact: true }).click()
    // Modal opens directly into Appearance after the visual refresh.
    await expect(window.getByRole('heading', { name: 'Appearance' })).toBeVisible()

    await window.getByRole('button', { name: 'Worktrees' }).click()

    // Defaults form fields render.
    await expect(window.getByText('Location pattern')).toBeVisible()
    await expect(window.getByText('Env files to copy')).toBeVisible()
    await expect(window.getByText('Setup script')).toBeVisible()
    await expect(window.getByText('After creation')).toBeVisible()

    // Edit the location pattern; debounced settings save should leave the value
    // in the input.
    const locationInput = window.locator('input[placeholder*="{project}"]').first()
    await locationInput.fill('../wt/{project}-{branch}')
    await expect(locationInput).toHaveValue('../wt/{project}-{branch}')

    // Reopen the Settings modal — debounced persisted value should reload.
    await window.keyboard.press('Escape')
    await expect(window.getByText('Enable notifications')).toHaveCount(0)

    // Allow the debounced settings save (~250ms) to flush.
    await window.waitForTimeout(500)

    await window.getByTitle('Settings', { exact: true }).click()
    await window.getByRole('button', { name: 'Worktrees' }).click()
    const reloaded = window.locator('input[placeholder*="{project}"]').first()
    await expect(reloaded).toHaveValue('../wt/{project}-{branch}')

    // Escape closes the modal.
    await window.keyboard.press('Escape')
    await expect(window.getByText('Location pattern')).toHaveCount(0)
  })
})
