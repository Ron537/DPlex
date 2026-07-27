import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp } from './support/electronApp'

// Regression guard for app-wide jank. Creating a WebGL context costs a few
// hundred milliseconds of synchronous native work (GPU-process handshake,
// shader compilation, glyph atlas), so a terminal that isn't rendering heavily
// must stay on xterm's DOM renderer. Attaching the GPU renderer to every
// terminal on sight made app startup and tab switches visibly stall.
test.describe('DPlex GPU renderer policy', () => {
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

  test('an idle terminal does not allocate a WebGL context', async () => {
    if (!window) throw new Error('Window not available')
    await window.waitForSelector('.xterm-screen', { timeout: 20_000 })

    const longTasks = await window.evaluate(async () => {
      const seen: number[] = []
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) seen.push(e.duration)
      }).observe({ entryTypes: ['longtask'] })
      await new Promise((resolve) => setTimeout(resolve, 4_000))
      return seen
    })

    // xterm only renders into a <canvas> under the WebGL renderer; the DOM
    // renderer emits rows of <span>.
    const canvases = await window.evaluate(
      () => document.querySelectorAll('.xterm-screen canvas').length
    )
    expect(canvases).toBe(0)

    // And nothing should have blocked the main thread long enough to be felt.
    expect(longTasks.filter((duration) => duration > 100)).toEqual([])
  })

  test('rapid switching between busy terminals does not freeze the UI', async () => {
    if (!window) throw new Error('Window not available')
    await window.waitForSelector('.xterm-screen', { timeout: 20_000 })
    await window.getByTitle('New terminal (default shell)').click()
    await window.waitForTimeout(2_000)

    // Fill both terminals deeply, the way a resumed AI session replays output.
    // This also pushes them past the render-load threshold, so the GPU-context
    // policy is exercised rather than bypassed.
    const blob = ('x'.repeat(78) + '\n').repeat(120)
    for (const key of ['Meta+1', 'Meta+2']) {
      await window.keyboard.press(key)
      await window.waitForTimeout(500)
      for (let i = 0; i < 30; i++) await window.keyboard.insertText(blob)
      await window.waitForTimeout(1_500)
    }

    await window.evaluate(() => {
      const seen: number[] = []
      ;(window as unknown as { __switchLongTasks: number[] }).__switchLongTasks = seen
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) seen.push(e.duration)
      }).observe({ entryTypes: ['longtask'] })
    })

    for (let i = 0; i < 20; i++) {
      await window.keyboard.press(i % 2 === 0 ? 'Meta+2' : 'Meta+1')
      await window.waitForTimeout(120)
    }
    await window.waitForTimeout(500)

    const longTasks = await window.evaluate(
      () => (window as unknown as { __switchLongTasks: number[] }).__switchLongTasks
    )

    // Flicking between two heavy sessions must not queue a GPU-context
    // creation for each tab passed through — each one is a few hundred
    // milliseconds of synchronous native work, i.e. a visible freeze.
    expect(longTasks.filter((duration) => duration > 200)).toEqual([])
  })
})
