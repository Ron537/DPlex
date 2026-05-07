/**
 * Demo GIF for the README hero.
 *
 * Walks the user through:
 *   1. Watching a live AI session
 *   2. Switching to Source Control via the activity bar
 *   3. Picking a different project from the dropdown
 *   4. Opening the Sessions panel, resuming a past session in one click
 *   5. Typing a follow-up prompt into the resumed session and watching
 *      Copilot respond — proof the resumed session is live
 *
 * Includes an injected SVG "cursor" that smoothly travels between
 * targets so the GIF reads as a guided tour rather than random clicks.
 *
 * Total length ≈ 14s @ 14 fps.
 */

import { _electron as electron, type Page } from 'playwright'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs/promises'
import { spawnSync, execFileSync } from 'child_process'
import ffmpegPath from 'ffmpeg-static'

const REPO = process.cwd()
const OUT = path.join(REPO, 'docs', 'assets')
const FRAMES_DIR = path.join(REPO, '.demo-frames')
const MAIN_ENTRY = path.join(REPO, 'out', 'main', 'index.js')
const FPS = 14
const FRAME_MS = Math.round(1000 / FPS)

const FAKE_PROJECTS = [
  { id: 'p-app', name: 'web-app' },
  { id: 'p-api', name: 'api-server' },
  { id: 'p-www', name: 'marketing-site' },
  { id: 'p-design', name: 'design-system' },
  { id: 'p-cli', name: 'cli-tool' }
]
const FAKE_WORKTREES = [
  { id: 'wt-app-feat', parentId: 'p-app', name: 'feat/dark-mode', branch: 'feat/dark-mode' },
  { id: 'wt-app-fix', parentId: 'p-app', name: 'fix/auth-bug', branch: 'fix/auth-bug' },
  { id: 'wt-api-search', parentId: 'p-api', name: 'feat/search-index', branch: 'feat/search-index' }
]

async function makeRepo(root: string, name: string, mods: string[]): Promise<string> {
  const dir = path.join(root, name)
  await fs.mkdir(dir, { recursive: true })
  const run = (args: string[]): void => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  run(['init', '-b', 'main'])
  run(['config', 'user.email', 'demo@dplex.dev'])
  run(['config', 'user.name', 'DPlex Demo'])
  run(['config', 'commit.gpgsign', 'false'])
  await fs.writeFile(path.join(dir, 'README.md'), `# ${name}\n\nDemo repo.\n`)
  run(['add', '.'])
  run(['commit', '-m', 'init'])
  for (const m of mods) {
    const full = path.join(dir, m)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, `// modified ${m}\nexport const value = 42\n`)
  }
  return dir
}

function fakeSessions(projectPaths: Record<string, string>): unknown[] {
  const provs = ['copilot-cli', 'claude-code']
  const summaries = [
    'Implement dark-mode toggle and persist preference in localStorage',
    'Refactor SidePanel to use unified header layout',
    'Add full-text search index over product catalog',
    'Investigate flaky e2e test in CI runner',
    'Wire OAuth flow with PKCE and refresh-token rotation',
    'Migrate Zustand stores to v5 with subscribeWithSelector'
  ]
  const out: unknown[] = []
  let i = 0
  for (const pid of Object.keys(projectPaths)) {
    for (let k = 0; k < 2; k++) {
      const isActive = i < 4
      const minutesAgo = isActive ? 1 + i * 4 : 60 + i * 47
      const created = new Date(Date.now() - minutesAgo * 60_000)
      out.push({
        id: `sess-${pid}-${k}`,
        displayName: summaries[i % summaries.length],
        summary: summaries[i % summaries.length],
        status: isActive ? 'active' : 'idle',
        aiTool: provs[i % provs.length],
        createdAt: created,
        updatedAt: created,
        cwd: projectPaths[pid],
        branch: 'main',
        messageCount: 8 + i,
        lastActivityTime: created.getTime()
      })
      i++
    }
  }
  return out
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function captureFrames(window: Page, frames: number, prefix: string): Promise<void> {
  for (let i = 0; i < frames; i++) {
    const file = path.join(FRAMES_DIR, `${prefix}-${String(i).padStart(4, '0')}.png`)
    await window.screenshot({ path: file })
    await sleep(FRAME_MS)
  }
}

// ── Cursor overlay helpers ─────────────────────────────────────────────
async function injectCursor(window: Page): Promise<void> {
  await window.evaluate(() => {
    if (document.getElementById('__demo-cursor')) return
    const el = document.createElement('div')
    el.id = '__demo-cursor'
    el.style.cssText = [
      'position: fixed',
      'pointer-events: none',
      'z-index: 999999',
      'left: 40px',
      'top: 40px',
      'transform: translate(0,0)',
      'transition: transform 380ms cubic-bezier(0.4, 0, 0.2, 1)',
      'will-change: transform'
    ].join(';')
    el.innerHTML =
      '<svg viewBox="0 0 24 24" width="22" height="22" style="filter: drop-shadow(0 2px 5px rgba(0,0,0,0.55))">' +
      '<path fill="#ffffff" stroke="#0c0d10" stroke-width="1.2" stroke-linejoin="round"' +
      ' d="M4 2 L20 12 L12.5 13.5 L16.5 22 L13 23 L9 14.5 L3.5 18 Z"/></svg>'
    document.body.appendChild(el)
  })
}

// Cursor tip offset — empirically calibrated so the tip lands right on
// the click target. Increase to push the cursor further up and left.
const CURSOR_TIP_X = 30
const CURSOR_TIP_Y = 28

async function moveCursorTo(window: Page, x: number, y: number, dwellMs = 420): Promise<void> {
  const tx = x - CURSOR_TIP_X
  const ty = y - CURSOR_TIP_Y
  await window.evaluate(
    ({ x, y }) => {
      const el = document.getElementById('__demo-cursor') as HTMLElement | null
      if (!el) return
      el.style.transform = 'translate(' + x + 'px,' + y + 'px)'
    },
    { x: tx, y: ty }
  )
  await sleep(dwellMs)
}

async function clickRipple(window: Page, x: number, y: number): Promise<void> {
  await window.evaluate(
    ({ x, y }) => {
      const ripple = document.createElement('div')
      ripple.style.cssText = [
        'position: fixed',
        'pointer-events: none',
        'z-index: 999998',
        'left: ' + (x - 12) + 'px',
        'top: ' + (y - 12) + 'px',
        'width: 24px',
        'height: 24px',
        'border-radius: 50%',
        'border: 2px solid rgba(59, 130, 246, 0.9)',
        'transform: scale(0.4)',
        'opacity: 1',
        'transition: transform 420ms ease-out, opacity 420ms ease-out'
      ].join(';')
      document.body.appendChild(ripple)
      requestAnimationFrame(() => {
        ripple.style.transform = 'scale(2.4)'
        ripple.style.opacity = '0'
      })
      setTimeout(() => ripple.remove(), 600)
    },
    { x, y }
  )
}

async function cursorClick(window: Page, selector: string, opts?: { dwell?: number }): Promise<void> {
  const handle = window.locator(selector).first()
  const box = await handle.boundingBox()
  if (!box) return
  const tx = box.x + box.width / 2
  const ty = box.y + box.height / 2
  await moveCursorTo(window, tx, ty, opts?.dwell ?? 420)
  await clickRipple(window, tx, ty)
  await sleep(180)
  await handle.click().catch(() => undefined)
}

async function cursorClickTestId(window: Page, testid: string, opts?: { dwell?: number }): Promise<void> {
  await cursorClick(window, '[data-testid="' + testid + '"]', opts)
}

// Type a string into the active xterm one character at a time so the GIF
// reads as live typing. Captures a frame every few chars so the typing
// animation actually appears in the output.
async function typeIntoActiveTerminal(
  window: Page,
  text: string,
  prefix: string,
  charDelayMs = 65
): Promise<void> {
  let frameIdx = 0
  let sinceLastShot = 0
  for (const ch of text) {
    await window.evaluate((c) => {
      // @ts-expect-error injected
      const groups = window.__dplex.terminalStore.getState().groups
      // @ts-expect-error injected
      const activeGroupId = window.__dplex.terminalStore.getState().activeGroupId
      const g = groups.find((x: { id: string }) => x.id === activeGroupId) ?? groups[0]
      if (!g) return
      const tabId = g.activeTabId
      // @ts-expect-error injected
      const entry = window.__dplex.terminalRegistry.getTerminalEntry(tabId)
      if (!entry?.term) return
      entry.term.write(c)
    }, ch)
    sinceLastShot += charDelayMs
    if (sinceLastShot >= FRAME_MS) {
      sinceLastShot -= FRAME_MS
      const file = path.join(FRAMES_DIR, `${prefix}-${String(frameIdx).padStart(4, '0')}.png`)
      await window.screenshot({ path: file })
      frameIdx++
    } else {
      await sleep(charDelayMs)
    }
  }
}

async function paintInitialSession(window: Page): Promise<void> {
  await window.evaluate(() => {
    // @ts-expect-error injected
    const groups = window.__dplex.terminalStore.getState().groups
    if (!groups[0] || !groups[0].tabs[0]) return
    const tabId = groups[0].tabs[0].id
    // @ts-expect-error injected
    const entry = window.__dplex.terminalRegistry.getTerminalEntry(tabId)
    if (!entry?.term) return
    const t = entry.term
    const ESC = '\x1b'
    const RESET = `${ESC}[0m`
    const DIM = `${ESC}[2m`
    const BOLD = `${ESC}[1m`
    const CYAN = `${ESC}[36m`
    const GREEN = `${ESC}[32m`
    const BLUE = `${ESC}[34m`
    const YELLOW = `${ESC}[33m`
    const MAGENTA = `${ESC}[35m`
    t.write(
      [
        `${ESC}[3J${ESC}[2J${ESC}[H`,
        `${DIM}~/code/web-app  ${CYAN}feat/dark-mode${RESET}`,
        `${DIM}$${RESET} copilot --resume=8c4a2f`,
        ``,
        `${BOLD}${MAGENTA}● ${BOLD}Implement a system-aware dark mode toggle${RESET}`,
        `${DIM}  Resumed · 24 messages · 6 tool calls${RESET}`,
        ``,
        `${BLUE}${BOLD}You${RESET}`,
        `${DIM}  Add a dark-mode toggle that follows the OS preference${RESET}`,
        `${DIM}  by default but lets the user override it.${RESET}`,
        ``,
        `${GREEN}${BOLD}● Copilot${RESET}`,
        `  I'll add a ThemeProvider that watches \`prefers-color-scheme\``,
        `  and exposes a toggle.`,
        ``,
        `  ${YELLOW}▸${RESET} ${DIM}create${RESET} src/ThemeProvider.tsx`,
        `  ${GREEN}✓${RESET} ${DIM}48 lines${RESET}`,
        ``,
        `  ${YELLOW}▸${RESET} ${DIM}edit${RESET} src/Header.tsx`,
        `  ${GREEN}✓${RESET} ${DIM}+12 −1${RESET}`,
        ``,
        `  ${YELLOW}▸${RESET} ${DIM}run${RESET} npm test`,
        `  ${GREEN}✓${RESET} ${DIM}9 passed${RESET}`,
        ``,
        `  Done. Header has a sun/moon toggle, ThemeProvider syncs with`,
        `  the OS via ${CYAN}matchMedia${RESET}, and the choice persists.`,
        ``,
        `${BLUE}${BOLD}You${RESET} ${DIM}▏${RESET}`
      ].join('\r\n')
    )
  })
}

async function main(): Promise<void> {
  await fs.mkdir(OUT, { recursive: true })
  await fs.rm(FRAMES_DIR, { recursive: true, force: true })
  await fs.mkdir(FRAMES_DIR, { recursive: true })

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dplex-demo-'))
  const projectPaths: Record<string, string> = {}
  for (const p of FAKE_PROJECTS) {
    const mods =
      p.id === 'p-app'
        ? ['src/App.tsx', 'src/Header.tsx', 'src/ThemeProvider.tsx']
        : p.id === 'p-api'
          ? ['src/handlers/auth.ts', 'src/handlers/refresh.ts', 'src/middleware/session.ts', 'src/types.ts']
          : ['src/index.ts']
    projectPaths[p.id] = await makeRepo(root, p.name, mods)
  }
  for (const w of FAKE_WORKTREES) {
    const parentDir = projectPaths[w.parentId]
    const wtDir = path.join(parentDir, '..', `${path.basename(parentDir)}-${w.branch.replace(/\//g, '-')}`)
    execFileSync('git', ['worktree', 'add', '-b', w.branch, wtDir, 'main'], {
      cwd: parentDir,
      stdio: 'ignore'
    })
    await fs.writeFile(path.join(wtDir, 'NOTES.md'), '# work in progress\n')
    projectPaths[w.id] = wtDir
  }

  const seeded: unknown[] = []
  for (const p of FAKE_PROJECTS) {
    seeded.push({
      id: p.id,
      name: p.name,
      path: projectPaths[p.id],
      addedAt: new Date().toISOString(),
      pinned: p.id === 'p-app' || p.id === 'p-api'
    })
  }
  for (const w of FAKE_WORKTREES) {
    const parent = FAKE_PROJECTS.find((x) => x.id === w.parentId)!
    seeded.push({
      id: w.id,
      name: w.name,
      path: projectPaths[w.id],
      addedAt: new Date().toISOString(),
      parentProjectId: parent.id,
      parentRepoName: parent.name,
      parentRepoPath: projectPaths[parent.id],
      createdByDplexWorktree: true
    })
  }

  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dplex-demo-ud-'))
  await fs.writeFile(
    path.join(userDataDir, 'settings.json'),
    JSON.stringify({
      sidebarVisible: true,
      sidebarPanelCollapsed: false,
      sidebarActiveTab: 'projects',
      sidebarWidth: 280,
      theme: 'dark',
      projectPanelShowFooter: true,
      projects: seeded
    })
  )
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DPLEX_E2E: '1',
    HOME: userDataDir,
    XDG_CONFIG_HOME: userDataDir,
    XDG_DATA_HOME: userDataDir,
    XDG_STATE_HOME: userDataDir
  }

  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.evaluate(() => localStorage.setItem('dplex-demo', '1'))
  await window.reload()
  await window.waitForLoadState('domcontentloaded')
  await window.waitForFunction(
    // @ts-expect-error injected
    () => Boolean(window.__dplex?.projectStore)
  )
  await window.setViewportSize({ width: 1280, height: 800 })
  await sleep(2500)

  await window.evaluate((sessions) => {
    // @ts-expect-error injected
    window.__dplex.sessionStore.setState({ sessions, loading: false })
    // @ts-expect-error injected
    window.__dplex.projectStore.setState({
      // Only expand the project we're actively demoing — keeps the panel
      // visually quiet so the eye lands on the selected row.
      expandedProjectIds: new Set(['p-app']),
      activeProjectId: 'p-app',
      lastExpandedProjectId: 'p-app'
    })
  }, fakeSessions(projectPaths))
  await sleep(700)

  await paintInitialSession(window)
  await sleep(900)

  await injectCursor(window)
  // Park cursor at a neutral starting spot.
  await moveCursorTo(window, 640, 400, 100)

  // ── 1. Hold on Projects view ──────────────────────────────────────────
  await captureFrames(window, 18, 'a-projects')

  // ── 2. Move cursor to Source Control activity item, click ─────────────
  // Capture frames during the cursor move + transition + hold.
  const srcCtrlBox = await window.getByTestId('activity-bar-git').boundingBox()
  if (srcCtrlBox) {
    const tx = srcCtrlBox.x + srcCtrlBox.width / 2
    const ty = srcCtrlBox.y + srcCtrlBox.height / 2
    await moveCursorTo(window, tx, ty, 0)
    await captureFrames(window, 5, 'b-cursor-to-git') // CSS transition (~380ms) → ~5 frames
    await clickRipple(window, tx, ty)
    await window.getByTestId('activity-bar-git').click()
  }
  await captureFrames(window, 18, 'c-git-view')

  // ── 3. Open the project picker ────────────────────────────────────────
  // Cosmetic path override JUST FOR THE DROPDOWN — the picker shows
  // project.path. Replace temp dir prefixes with friendly `~/Code/<name>`
  // so the visible rows don't leak `/var/folders/...`. We restore real
  // paths before clicking a row so the git store can still bind.
  await window.evaluate(() => {
    // @ts-expect-error injected
    const ps = window.__dplex.projectStore.getState()
    // @ts-expect-error injected
    window.__dplex_real_paths = ps.projects.map((p: { id: string; path: string }) => [p.id, p.path])
    const next = ps.projects.map((p: { id: string; path: string; name: string; parentProjectId?: string; parentRepoName?: string }) => ({
      ...p,
      path: p.parentProjectId
        ? '~/Code/' + (p.parentRepoName ?? 'project') + '/.worktrees/' + p.name
        : '~/Code/' + p.name
    }))
    // @ts-expect-error injected
    window.__dplex.projectStore.setState({ projects: next })
  })
  const pickerBox = await window.getByTestId('git-project-picker-trigger').boundingBox()
  if (pickerBox) {
    const tx = pickerBox.x + pickerBox.width / 2
    const ty = pickerBox.y + pickerBox.height / 2
    await moveCursorTo(window, tx, ty, 0)
    await captureFrames(window, 5, 'd-cursor-to-picker')
    await clickRipple(window, tx, ty)
    await window.getByTestId('git-project-picker-trigger').click()
  }
  await captureFrames(window, 14, 'e-picker-open')

  // ── 4. Select api-server from the dropdown ────────────────────────────
  // Restore the real on-disk paths first so the git store can bind to the
  // newly-active project. The dropdown is about to close anyway.
  await window.evaluate(() => {
    // @ts-expect-error injected
    const real: Array<[string, string]> = window.__dplex_real_paths ?? []
    if (!real.length) return
    const map = new Map(real)
    // @ts-expect-error injected
    const ps = window.__dplex.projectStore.getState()
    const next = ps.projects.map((p: { id: string; path: string }) => ({
      ...p,
      path: map.get(p.id) ?? p.path
    }))
    // @ts-expect-error injected
    window.__dplex.projectStore.setState({ projects: next })
  })
  const apiRow = window.locator('[data-project-id="p-api"]').first()
  const apiBox = await apiRow.boundingBox()
  if (apiBox) {
    const tx = apiBox.x + apiBox.width / 2
    const ty = apiBox.y + apiBox.height / 2
    await moveCursorTo(window, tx, ty, 0)
    await captureFrames(window, 5, 'f-cursor-to-api')
    await clickRipple(window, tx, ty)
    await apiRow.click()
  }
  // Wait a bit longer so the gitPanelStore has time to bind + fetch the
  // newly-selected repo's changes before we capture frames.
  await sleep(1200)
  await captureFrames(window, 18, 'g-api-changes')

  // ── 5. Open the Sessions panel ────────────────────────────────────────
  // Tells the user "this is where every past AI session lives, even
  // ones from yesterday." We move the cursor to the activity-bar
  // Sessions icon and click; the SessionList already has fakeSessions
  // seeded into it, so the panel populates immediately.
  const sessionsBox = await window.getByTestId('activity-bar-sessions').boundingBox()
  if (sessionsBox) {
    const tx = sessionsBox.x + sessionsBox.width / 2
    const ty = sessionsBox.y + sessionsBox.height / 2
    await moveCursorTo(window, tx, ty, 0)
    await captureFrames(window, 5, 'h-cursor-to-sessions')
    await clickRipple(window, tx, ty)
    await window.getByTestId('activity-bar-sessions').click()
  }
  await captureFrames(window, 14, 'i-sessions-panel')

  // ── 6. Hover a past session and "click" to resume ─────────────────────
  // The fake providers don't ship real resume commands, so a bare click
  // wouldn't open a tab. We move the cursor to the row (with ripple) for
  // narrative, then programmatically create the resumed tab via
  // terminalStore + paint AI-session content into it. This faithfully
  // mirrors what handleResume does in production.
  const RESUMED_SUMMARY = 'Wire OAuth flow with PKCE and refresh-token rotation'
  const sessionRow = window.locator(`text=${RESUMED_SUMMARY}`).first()
  const rowBox = await sessionRow.boundingBox().catch(() => null)
  if (rowBox) {
    const tx = rowBox.x + rowBox.width / 2
    const ty = rowBox.y + rowBox.height / 2
    await moveCursorTo(window, tx, ty, 0)
    await captureFrames(window, 5, 'j-cursor-to-session-row')
    await clickRipple(window, tx, ty)
  }

  const resumedTabId = (await window.evaluate((title) => {
    // @ts-expect-error injected
    const ts = window.__dplex.terminalStore
    const id = ts.getState().activeGroupId
    if (!id) return null
    return ts.getState().createTerminal(id, title, undefined, undefined, undefined, 'copilot-cli')
  }, `↻ ${RESUMED_SUMMARY}`)) as string | null
  await sleep(450)

  // Paint a "session resumed" banner into the new tab so viewers
  // immediately see this is a different session than the one on the left.
  if (resumedTabId) {
    await window.evaluate((tabId) => {
      // @ts-expect-error injected
      const entry = window.__dplex.terminalRegistry.getTerminalEntry(tabId)
      if (!entry?.term) return
      const ESC = '\x1b'
      const RESET = `${ESC}[0m`
      const DIM = `${ESC}[2m`
      const BOLD = `${ESC}[1m`
      const CYAN = `${ESC}[36m`
      const GREEN = `${ESC}[32m`
      const MAGENTA = `${ESC}[35m`
      entry.term.write(
        [
          `${ESC}[3J${ESC}[2J${ESC}[H`,
          `${DIM}~/code/api-server  ${CYAN}main${RESET}`,
          `${DIM}$${RESET} copilot --resume=4f1e9c`,
          ``,
          `${BOLD}${MAGENTA}● ${BOLD}Wire OAuth flow with PKCE${RESET}`,
          `${DIM}  Resumed · 17 messages · 4 tool calls${RESET}`,
          ``,
          `${GREEN}${BOLD}● Copilot${RESET}`,
          `  Session restored. Where were we?`,
          ``,
          `${DIM}  Last edit: src/handlers/auth.ts (+34 −12)${RESET}`,
          `${DIM}  Pending: rotate refresh tokens on /token endpoint${RESET}`,
          ``
        ].join('\r\n')
      )
    }, resumedTabId)
  }
  await captureFrames(window, 12, 'k-resumed-tab')

  // ── 7. Talk with the resumed session — type a prompt + stream reply ───
  // Demonstrates the resumed session is alive and interactive, not a
  // static screenshot. We type into the now-active resumed tab and
  // stream a short Copilot response.
  await typeIntoActiveTerminal(
    window,
    'rotate the refresh token on /token and add a unit test\r\n',
    'm-typing',
    45
  )
  await sleep(140)
  await window.evaluate(() => {
    // @ts-expect-error injected
    const groups = window.__dplex.terminalStore.getState().groups
    // @ts-expect-error injected
    const activeGroupId = window.__dplex.terminalStore.getState().activeGroupId
    const g = groups.find((x: { id: string }) => x.id === activeGroupId) ?? groups[0]
    if (!g) return
    // @ts-expect-error injected
    const entry = window.__dplex.terminalRegistry.getTerminalEntry(g.activeTabId)
    if (!entry?.term) return
    const ESC = '\x1b'
    const RESET = `${ESC}[0m`
    const DIM = `${ESC}[2m`
    const BOLD = `${ESC}[1m`
    const GREEN = `${ESC}[32m`
    const YELLOW = `${ESC}[33m`
    entry.term.write(
      [
        ``,
        `${GREEN}${BOLD}● Copilot${RESET}`,
        `  On it — adding rotation + a unit test.`,
        ``,
        `  ${YELLOW}▸${RESET} ${DIM}edit${RESET} src/handlers/refresh.ts`,
        `  ${GREEN}✓${RESET} ${DIM}+22 −4${RESET}`,
        ``,
        `  ${YELLOW}▸${RESET} ${DIM}create${RESET} src/handlers/refresh.test.ts`,
        `  ${GREEN}✓${RESET} ${DIM}38 lines${RESET}`,
        ``,
        `  ${YELLOW}▸${RESET} ${DIM}run${RESET} npm test -- refresh`,
        `  ${GREEN}✓${RESET} ${DIM}5 passed${RESET}`,
        ``
      ].join('\r\n')
    )
  })
  await captureFrames(window, 18, 'n-chat-response')

  // ── 8. End frame — let it breathe ─────────────────────────────────────
  await captureFrames(window, 10, 'z-end')

  await app.close()
  await fs.rm(userDataDir, { recursive: true, force: true })
  await fs.rm(root, { recursive: true, force: true })

  // ── Encode GIF with ffmpeg-static ─────────────────────────────────────
  if (!ffmpegPath) {
    console.error('ffmpeg-static did not provide a binary')
    process.exit(1)
  }
  const gifOut = path.join(OUT, 'demo.gif')
  spawnSync(
    ffmpegPath,
    [
      '-y',
      '-framerate', String(FPS),
      '-pattern_type', 'glob',
      '-i', path.join(FRAMES_DIR, '*.png'),
      '-vf',
      'scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=5',
      '-loop', '0',
      gifOut
    ],
    { stdio: 'inherit' }
  )

  await fs.rm(FRAMES_DIR, { recursive: true, force: true })
  console.log(`\nDone. GIF: ${gifOut}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
