import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp } from './support/electronApp'

test.describe('DPlex monkey tests', () => {
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

  test('survives randomized safe UI interactions without crashing', async () => {
    if (!window || !app) throw new Error('App window not available')
    const maybeClickByTitle = async (title: string): Promise<void> => {
      const button = window.getByTitle(title).first()
      if ((await button.count()) > 0) {
        await button.click({ timeout: 500 }).catch(() => {})
      }
    }

    const maybeClickByRole = async (name: string): Promise<void> => {
      const button = window.getByRole('button', { name, exact: true }).first()
      if ((await button.count()) > 0) {
        await button.click({ timeout: 500 }).catch(() => {})
      }
    }

    const safeActions: Array<() => Promise<void>> = [
      async () => {
        await maybeClickByRole('PROJECTS')
      },
      async () => {
        await maybeClickByRole('SESSIONS')
      },
      async () => {
        await maybeClickByTitle('Filter & group options')
      },
      async () => {
        await maybeClickByTitle('Refresh sessions')
      },
      async () => {
        await maybeClickByTitle('Split right')
      },
      async () => {
        await maybeClickByTitle('Split down')
      },
      async () => {
        await maybeClickByTitle('New terminal (default shell)')
      },
      async () => {
        await maybeClickByTitle('Settings (Ctrl+,)')
      },
      async () => {
        await window.keyboard.press('Escape')
      },
      async () => {
        await window.keyboard.press('Control+t')
      },
      async () => {
        await window.keyboard.press('Control+b')
      }
    ]

    for (let i = 0; i < 60; i++) {
      const action = safeActions[Math.floor(Math.random() * safeActions.length)]
      await action()
      await window.waitForTimeout(40)
    }

    await expect(window.getByText(/terminals? · \d+ groups?/)).toBeVisible()

    const isCrashed = await app.evaluate(async ({ app }) => !app.isReady())

    expect(isCrashed).toBe(false)
  })
})
