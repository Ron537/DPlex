import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs/promises'
import { closeApp, launchApp } from './support/electronApp'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

/** Create a temp project directory with a small, deterministic file tree. */
async function makeProjectDir(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dplex-explorer-e2e-'))
  await fs.writeFile(path.join(root, 'README.md'), '# Hello\n')
  await fs.writeFile(path.join(root, 'notes.txt'), 'note one\n')
  await fs.mkdir(path.join(root, 'src'))
  await fs.writeFile(path.join(root, 'src', 'app.ts'), 'export const x = 1\n')
  return root
}

async function seedProjects(
  window: Page,
  projects: Array<{ id: string; name: string; path: string }>
): Promise<void> {
  await window.evaluate(async (payload) => {
    const withMeta = payload.map((p) => ({
      ...p,
      addedAt: new Date().toISOString(),
      pinned: false
    }))
    // @ts-expect-error: dplex is defined on the renderer window via preload
    await window.dplex.settings.merge({ projects: withMeta })
  }, projects)
  await window.reload()
  await window.waitForLoadState('domcontentloaded')
  if (projects[0]) {
    await window.getByText(projects[0].name).waitFor({ state: 'visible' })
  }
}

/** Seed + bind a project, then reveal the Explorer side panel. */
async function openExplorer(window: Page, projectPath: string): Promise<void> {
  await seedProjects(window, [{ id: 'p-explorer-e2e', name: 'explorer-proj', path: projectPath }])
  // Click the project to bind it as the active project.
  await window.getByText('explorer-proj').click()
  // Open the Explorer activity-bar item.
  await window.getByTestId('activity-bar-explorer').click()
  await expect(window.getByTestId('explorer-side-panel-view')).toBeVisible({ timeout: 5_000 })
}

function treeItem(window: Page, relPath: string): Locator {
  return window.locator(`[role="treeitem"][title="${relPath}"]`).first()
}

/** Open README.md as a persistent editor tab and wait for Monaco to mount. */
async function openReadmeEditor(window: Page): Promise<void> {
  const readme = treeItem(window, 'README.md')
  await expect(readme).toBeVisible({ timeout: 10_000 })
  await readme.dblclick()
  await expect(window.locator('.monaco-editor').first()).toBeVisible({ timeout: 20_000 })
}

/** Replace the active editor's content with the given text. */
async function replaceEditorContent(window: Page, text: string): Promise<void> {
  const editor = window.locator('.monaco-editor').first()
  await editor.click()
  await window.keyboard.press(`${MOD}+A`)
  await window.keyboard.type(text)
}

test.describe('DPlex file explorer', () => {
  let app: ElectronApplication | undefined
  let window: Page | undefined
  let userDataDir: string | undefined
  let projectPath: string | undefined

  async function launch(settings?: Record<string, unknown>): Promise<Page> {
    const launched = await launchApp({ settings })
    app = launched.app
    window = launched.window
    userDataDir = launched.userDataDir
    return window
  }

  test.beforeEach(async () => {
    projectPath = await makeProjectDir()
  })

  test.afterEach(async () => {
    await closeApp(app, userDataDir)
    app = undefined
    userDataDir = undefined
    if (projectPath) {
      await fs.rm(projectPath, { recursive: true, force: true })
      projectPath = undefined
    }
  })

  test('lists project files and supports preview vs persist tabs', async () => {
    const win = await launch()
    if (!projectPath) throw new Error('Project not available')
    await openExplorer(win, projectPath)

    // Root entries are listed.
    await expect(treeItem(win, 'README.md')).toBeVisible({ timeout: 10_000 })
    await expect(treeItem(win, 'notes.txt')).toBeVisible()
    await expect(treeItem(win, 'src')).toBeVisible()

    // Single-click opens a preview tab (italic title).
    await treeItem(win, 'README.md').click()
    const previewTab = win.getByTestId('editor-tab-label').filter({ hasText: 'README.md' }).first()
    await expect(previewTab).toBeVisible({ timeout: 10_000 })
    await expect(previewTab).toHaveCSS('font-style', 'italic')

    // Double-click promotes the preview tab to permanent (italic disappears).
    await treeItem(win, 'README.md').dblclick()
    await expect(previewTab).toHaveCSS('font-style', 'normal', { timeout: 5_000 })
  })

  test('expands a directory to reveal nested files', async () => {
    const win = await launch()
    if (!projectPath) throw new Error('Project not available')
    await openExplorer(win, projectPath)

    const srcDir = treeItem(win, 'src')
    await expect(srcDir).toBeVisible({ timeout: 10_000 })
    await srcDir.click()
    await expect(treeItem(win, 'src/app.ts')).toBeVisible({ timeout: 10_000 })
  })

  test('creates a new file from the toolbar', async () => {
    const win = await launch()
    if (!projectPath) throw new Error('Project not available')
    await openExplorer(win, projectPath)

    await win.getByTestId('explorer-new-file').click()
    const input = win.locator('[role="tree"] input[type="text"]').first()
    await expect(input).toBeVisible({ timeout: 5_000 })
    await input.fill('created.md')
    await input.press('Enter')

    await expect(treeItem(win, 'created.md')).toBeVisible({ timeout: 10_000 })
    await expect
      .poll(
        async () => {
          try {
            await fs.access(path.join(projectPath!, 'created.md'))
            return true
          } catch {
            return false
          }
        },
        { timeout: 10_000 }
      )
      .toBe(true)
  })

  test('deletes a file via the context menu', async () => {
    const win = await launch()
    if (!projectPath) throw new Error('Project not available')
    await openExplorer(win, projectPath)

    const notes = treeItem(win, 'notes.txt')
    await expect(notes).toBeVisible({ timeout: 10_000 })
    await notes.click({ button: 'right' })

    await win.getByRole('button', { name: 'Delete' }).click()
    await win.getByTestId('explorer-confirm-delete').click()

    await expect(treeItem(win, 'notes.txt')).toHaveCount(0, { timeout: 10_000 })
    await expect
      .poll(
        async () => {
          try {
            await fs.access(path.join(projectPath!, 'notes.txt'))
            return true
          } catch {
            return false
          }
        },
        { timeout: 10_000 }
      )
      .toBe(false)
  })

  test('edits and saves a file with Cmd/Ctrl+S in manual mode', async () => {
    const win = await launch({ editorAutoSave: 'manual' })
    if (!projectPath) throw new Error('Project not available')
    await openExplorer(win, projectPath)
    await openReadmeEditor(win)

    await replaceEditorContent(win, 'EDITED_BY_E2E\n')

    // Dirty indicator appears on the Save button.
    await expect(win.getByText('Save •')).toBeVisible({ timeout: 5_000 })

    await win.keyboard.press(`${MOD}+S`)

    await expect
      .poll(() => fs.readFile(path.join(projectPath!, 'README.md'), 'utf8'), { timeout: 10_000 })
      .toContain('EDITED_BY_E2E')
    // Dirty indicator clears once saved.
    await expect(win.getByText('Save •')).toHaveCount(0, { timeout: 5_000 })
  })

  test('auto-saves on change when enabled', async () => {
    const win = await launch({ editorAutoSave: 'onChange' })
    if (!projectPath) throw new Error('Project not available')
    await openExplorer(win, projectPath)
    await openReadmeEditor(win)

    await replaceEditorContent(win, 'AUTO_SAVED_E2E\n')

    // No explicit save — debounced auto-save writes to disk.
    await expect
      .poll(() => fs.readFile(path.join(projectPath!, 'README.md'), 'utf8'), { timeout: 10_000 })
      .toContain('AUTO_SAVED_E2E')
  })

  test('prompts to save a dirty tab when closing', async () => {
    const win = await launch({ editorAutoSave: 'manual' })
    if (!projectPath) throw new Error('Project not available')
    await openExplorer(win, projectPath)
    await openReadmeEditor(win)

    await replaceEditorContent(win, 'CLOSE_SAVE_E2E\n')
    await expect(win.getByText('Save •')).toBeVisible({ timeout: 5_000 })

    // Close the dirty tab via its close button → confirm modal appears.
    const tab = win.getByTestId('editor-tab-label').filter({ hasText: 'README.md' }).first()
    await tab.hover()
    await tab.locator('xpath=following-sibling::button[1]').click()

    await expect(win.getByTestId('close-confirm-save')).toBeVisible({ timeout: 5_000 })
    await win.getByTestId('close-confirm-save').click()

    await expect
      .poll(() => fs.readFile(path.join(projectPath!, 'README.md'), 'utf8'), { timeout: 10_000 })
      .toContain('CLOSE_SAVE_E2E')
    await expect(tab).toHaveCount(0, { timeout: 5_000 })
  })
})
