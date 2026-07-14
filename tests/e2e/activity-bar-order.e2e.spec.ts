import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp } from './support/electronApp'

/** Vertical position (top edge) of an activity-bar view button. */
async function topOf(window: Page, id: string): Promise<number> {
  const box = await window.getByTestId(`activity-bar-${id}`).boundingBox()
  if (!box) throw new Error(`activity-bar-${id} not visible`)
  return box.y
}

test.describe('DPlex activity bar ordering', () => {
  let app: ElectronApplication | undefined
  let window: Page | undefined
  let userDataDir: string | undefined

  test.afterEach(async () => {
    await closeApp(app, userDataDir)
    app = window = userDataDir = undefined
  })

  test('Spaces leads the rail by default and view icons are draggable', async () => {
    const launched = await launchApp()
    app = launched.app
    window = launched.window
    userDataDir = launched.userDataDir

    const spaces = window.getByTestId('activity-bar-spaces')
    await expect(spaces).toBeVisible()

    // Spaces sits above Projects in the default order.
    expect(await topOf(window, 'spaces')).toBeLessThan(await topOf(window, 'projects'))

    // Each view icon exposes the drag-to-reorder affordance.
    await expect(spaces).toHaveAttribute('draggable', 'true')
  })

  test('honors a persisted custom order on boot', async () => {
    const launched = await launchApp({
      settings: {
        activityBarOrder: ['projects', 'spaces', 'sessions', 'explorer', 'git', 'search']
      }
    })
    app = launched.app
    window = launched.window
    userDataDir = launched.userDataDir

    await expect(window.getByTestId('activity-bar-projects')).toBeVisible()
    // Custom order flips Projects above Spaces.
    expect(await topOf(window, 'projects')).toBeLessThan(await topOf(window, 'spaces'))
  })

  test('a reordered rail persists across reloads', async () => {
    const launched = await launchApp()
    app = launched.app
    window = launched.window
    userDataDir = launched.userDataDir

    await expect(window.getByTestId('activity-bar-spaces')).toBeVisible()
    // Spaces starts on top.
    expect(await topOf(window, 'spaces')).toBeLessThan(await topOf(window, 'search'))

    // Persist a new order (what a drop of Spaces to the bottom writes), then
    // reload to prove it is read back from disk on boot.
    await window.evaluate(async () => {
      // @ts-expect-error: dplex is defined on the renderer window via preload
      await window.dplex.settings.merge({
        activityBarOrder: ['projects', 'sessions', 'explorer', 'git', 'search', 'spaces']
      })
    })
    await window.reload()
    await window.waitForLoadState('domcontentloaded')
    await expect(window.getByTestId('activity-bar-spaces')).toBeVisible()

    // Spaces is now last — below Search.
    expect(await topOf(window, 'spaces')).toBeGreaterThan(await topOf(window, 'search'))
  })

  test('context menu Move up reorders and persists', async () => {
    const launched = await launchApp()
    app = launched.app
    window = launched.window
    userDataDir = launched.userDataDir

    await expect(window.getByTestId('activity-bar-spaces')).toBeVisible()
    // Default: Spaces above Projects.
    expect(await topOf(window, 'spaces')).toBeLessThan(await topOf(window, 'projects'))

    // Right-click Projects → Move up (an accessible alternative to drag).
    await window.getByTestId('activity-bar-projects').click({ button: 'right' })
    await window.getByRole('button', { name: 'Move up' }).click()

    // Projects now leads the rail.
    expect(await topOf(window, 'projects')).toBeLessThan(await topOf(window, 'spaces'))

    // ...and the new order survives a reload.
    await window.reload()
    await window.waitForLoadState('domcontentloaded')
    await expect(window.getByTestId('activity-bar-projects')).toBeVisible()
    expect(await topOf(window, 'projects')).toBeLessThan(await topOf(window, 'spaces'))
  })

  test('Move up is disabled for the item already on top', async () => {
    const launched = await launchApp()
    app = launched.app
    window = launched.window
    userDataDir = launched.userDataDir

    await expect(window.getByTestId('activity-bar-spaces')).toBeVisible()
    // Spaces leads by default → its Move up is disabled.
    await window.getByTestId('activity-bar-spaces').click({ button: 'right' })
    await expect(window.getByRole('button', { name: 'Move up' })).toBeDisabled()
    await expect(window.getByRole('button', { name: 'Move down' })).toBeEnabled()
  })
})
