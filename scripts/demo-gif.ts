/**
 * Demo GIF for the README hero.
 *
 * A realistic end-to-end workflow — one feature ("Ship OAuth login") that
 * spans two projects, run across parallel AI sessions inside a Space:
 *   1. Skim the Projects panel.
 *   2. Step back to the Spaces overview (mission control).
 *   3. Create a new space for the feature, bound to api-server + web-app.
 *   4. Start a session for api-server and give it a prompt.
 *   5. Start a second session for web-app, split the two vertically,
 *      and prompt the second agent while the first keeps working.
 *   6. From the Sessions panel, resume a related past session into the
 *      same space and give it another prompt — three agents in flight.
 *   7. Open the Overview dashboard and slowly scroll every metric.
 *   8. Open the Git panel, open a side-by-side diff, and scroll it.
 *
 * Includes an injected SVG "cursor" that smoothly travels between
 * targets so the GIF reads as a guided tour rather than random clicks.
 */

import { _electron as electron, type Page } from 'playwright'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs/promises'
import { spawnSync, execFileSync } from 'child_process'
import ffmpegPath from 'ffmpeg-static'
import { gifskiPath } from 'gifski-command'
import {
  PROJECT_COLORS,
  DEMO_PROJECT_IDS,
  buildDashboardMetrics,
  buildDemoSpaces,
  buildDemoSpaceAttention
} from './demo-fixtures'

const REPO = process.cwd()
const OUT = path.join(REPO, 'docs', 'assets')
const FRAMES_DIR = path.join(REPO, '.demo-frames')
const MAIN_ENTRY = path.join(REPO, 'out', 'main', 'index.js')

// Fail loudly if an external encoder (ffmpeg/gifski) can't be spawned or exits
// non-zero. Without this the script would delete the captured frames and print
// "Done" even when demo.mp4/demo.gif were never written.
function assertEncodeOk(label: string, res: ReturnType<typeof spawnSync>): void {
  if (res.error) {
    throw new Error(`${label} failed to start: ${res.error.message}`)
  }
  if (res.signal) {
    throw new Error(`${label} was killed by signal ${res.signal}`)
  }
  if (res.status !== 0) {
    throw new Error(`${label} exited with status ${res.status}`)
  }
}

// Capture/playback rate. Full-window Electron screenshots at 2× are slow
// (~115ms each on this host), so the real capture rate tops out near ~8–9fps.
// Assembling faster than that plays every wall-clock animation (cursor caret,
// attention pulse, CSS transitions) sped up — the old 30fps encode ran ~3.5×
// too fast. So we encode at the *measured* effective fps (see CAP_FRAMES/CAP_MS)
// for true real-time playback, and use a low nominal FPS purely as the frame
// budget: scene durations are authored as counts at BASE_FPS and scaled by
// FPS/BASE_FPS, so a smaller FPS captures fewer frames → shorter final video at
// the same real-time speed.
const BASE_FPS = 14
const FPS = 10
const FRAME_MS = Math.round(1000 / FPS)

// Rolling measurement of real per-frame wall time (screenshot + pacing sleep),
// used to encode at the true effective fps so animations play at natural speed.
let CAP_FRAMES = 0
let CAP_MS = 0
function recordFrameTime(ms: number): void {
  CAP_FRAMES++
  CAP_MS += ms
}
function effectiveFps(): number {
  if (CAP_FRAMES === 0 || CAP_MS === 0) return FPS
  const fps = (CAP_FRAMES * 1000) / CAP_MS
  // Clamp to a sane band so a few slow/fast outliers can't wreck the timeline.
  return Math.max(6, Math.min(15, Math.round(fps * 10) / 10))
}

// Supersample factor: the window is sized DPR× and the renderer zoomed by DPR
// so screenshots come out at DPR× the design resolution, then the encoders
// downscale with lanczos — the classic trick for crisp text in a small demo.
// 1.5× (vs 2×) keeps text crisp when downscaled to 1000px while cutting the
// per-frame pixel count to ~56%, so full-window PNG screenshots encode fast
// enough to sustain the FRAME_MS pacing at FPS=10 → smoother real-time motion.
const DPR = 1.5
// Final asset width (downscaled from the 2× capture). The README displays at
// 900px, so a 1000px asset stays crisp on HiDPI screens.
const OUT_WIDTH = 1000

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

interface FileSpec {
  rel: string
  before: string
  after: string
}

/**
 * Rich before/after for the api-server token endpoint — the file we open in
 * the side-by-side diff scene. Long enough to scroll, with a mix of edits and
 * additions so both gutters (red/green) are populated.
 */
const TOKEN_BEFORE = `import { createHash, randomBytes } from 'crypto'
import { signJwt } from './jwt'
import { getSession } from '../db/sessions'

export interface TokenRequest {
  grantType: string
  code?: string
  refreshToken?: string
}

// Exchange an authorization code for an access token.
export async function exchangeToken(req: TokenRequest) {
  if (req.grantType === 'authorization_code') {
    const session = await lookupCode(req.code)
    if (!session) {
      throw new Error('invalid_grant')
    }
    return issueAccessToken(session.userId)
  }
  throw new Error('unsupported_grant_type')
}

async function lookupCode(code?: string) {
  if (!code) return null
  return getSession(code)
}

function issueAccessToken(userId: string) {
  return {
    accessToken: signJwt({ sub: userId }, { expiresIn: '15m' }),
    tokenType: 'Bearer',
    expiresIn: 900
  }
}
`
const TOKEN_AFTER = `import { createHash, randomBytes } from 'crypto'
import { signJwt } from './jwt'
import { getSession } from '../db/sessions'
import { rotateRefreshToken } from './refresh'

export interface TokenRequest {
  grantType: string
  code?: string
  codeVerifier?: string
  refreshToken?: string
}

// Exchange an authorization code (or refresh token) for an access token.
export async function exchangeToken(req: TokenRequest) {
  if (req.grantType === 'authorization_code') {
    const session = await lookupCode(req.code)
    if (!session) {
      throw new Error('invalid_grant')
    }
    verifyPkce(session.codeChallenge, req.codeVerifier)
    return issueAccessToken(session.userId)
  }
  if (req.grantType === 'refresh_token') {
    const rotated = await rotateRefreshToken(req.refreshToken)
    return issueAccessToken(rotated.userId, rotated.refreshToken)
  }
  throw new Error('unsupported_grant_type')
}

// Verify the PKCE code_verifier against the stored S256 challenge.
function verifyPkce(challenge: string, verifier?: string) {
  if (!verifier) throw new Error('invalid_request')
  const hash = createHash('sha256').update(verifier).digest('base64url')
  if (hash !== challenge) {
    throw new Error('invalid_grant')
  }
}

async function lookupCode(code?: string) {
  if (!code) return null
  return getSession(code)
}

function issueAccessToken(userId: string, refreshToken?: string) {
  return {
    accessToken: signJwt({ sub: userId }, { expiresIn: '15m' }),
    refreshToken: refreshToken ?? randomBytes(32).toString('base64url'),
    tokenType: 'Bearer',
    expiresIn: 900
  }
}
`

const LOGIN_BEFORE = `import { useState } from 'react'
import { login } from '../api/auth'

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const onSubmit = async () => {
    await login(email, password)
  }

  return (
    <form onSubmit={onSubmit}>
      <input value={email} onChange={(e) => setEmail(e.target.value)} />
      <input value={password} onChange={(e) => setPassword(e.target.value)} />
      <button type="submit">Sign in</button>
    </form>
  )
}
`
const LOGIN_AFTER = `import { useState } from 'react'
import { login } from '../api/auth'
import { validateEmail } from '../utils/validate'

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async () => {
    if (!validateEmail(email)) {
      setError('Enter a valid email address')
      return
    }
    setError(null)
    await login(email, password)
  }

  return (
    <form onSubmit={onSubmit}>
      <input value={email} onChange={(e) => setEmail(e.target.value)} />
      <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" />
      {error && <p className="error">{error}</p>}
      <button type="submit">Sign in</button>
    </form>
  )
}
`

function simpleMod(rel: string, extra: string): FileSpec {
  const before = `// ${rel}\nexport const value = 42\n`
  return { rel, before, after: `${before}${extra}\n` }
}

const PROJECT_FILES: Record<string, FileSpec[]> = {
  'p-api': [
    { rel: 'src/auth/token.ts', before: TOKEN_BEFORE, after: TOKEN_AFTER },
    simpleMod('src/auth/refresh.ts', 'export const rotate = (t: string) => t'),
    simpleMod('src/middleware/authenticate.ts', 'export const scheme = "Bearer"')
  ],
  'p-app': [
    { rel: 'src/components/LoginForm.tsx', before: LOGIN_BEFORE, after: LOGIN_AFTER },
    simpleMod('src/api/auth.ts', 'export const withPkce = true')
  ],
  'p-www': [simpleMod('src/index.ts', 'export const rev = 2')],
  'p-design': [simpleMod('src/index.ts', 'export const rev = 2')],
  'p-cli': [simpleMod('src/index.ts', 'export const rev = 2')]
}

async function makeRepo(root: string, name: string, files: FileSpec[]): Promise<string> {
  const dir = path.join(root, name)
  await fs.mkdir(dir, { recursive: true })
  const run = (args: string[]): void => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  run(['init', '-b', 'main'])
  run(['config', 'user.email', 'demo@dplex.dev'])
  run(['config', 'user.name', 'DPlex Demo'])
  run(['config', 'commit.gpgsign', 'false'])
  await fs.writeFile(path.join(dir, 'README.md'), `# ${name}\n\nDemo repo.\n`)
  // Commit the ORIGINAL content so the working-tree edits below show up as
  // tracked modifications (real before/after) rather than untracked new files
  // — a new file forces the diff to inline view and shows only additions.
  for (const f of files) {
    const full = path.join(dir, f.rel)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, f.before)
  }
  run(['add', '.'])
  run(['commit', '-m', 'init'])
  for (const f of files) {
    await fs.writeFile(path.join(dir, f.rel), f.after)
  }
  return dir
}

function fakeSessions(projectPaths: Record<string, string>): unknown[] {
  const provs = ['copilot-cli', 'claude-code']
  const summaries = [
    'Add OAuth callback route and token exchange',
    'Wire refresh-token rotation into the /token endpoint',
    'Build the sign-in form with inline validation',
    'Investigate flaky e2e test in CI runner',
    'Migrate session store to encrypted cookies',
    'Add rate limiting to the auth endpoints'
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
  // `frames` is authored at BASE_FPS; scale it to the real capture rate so the
  // scene keeps the same wall-clock duration at the higher fps.
  const count = Math.max(1, Math.round((frames * FPS) / BASE_FPS))
  for (let i = 0; i < count; i++) {
    const started = Date.now()
    const file = path.join(FRAMES_DIR, `${prefix}-${String(i).padStart(4, '0')}.png`)
    await window.screenshot({ path: file })
    // Compensate for screenshot latency so frame spacing targets FRAME_MS
    // rather than (FRAME_MS + screenshot time) — keeps motion evenly paced.
    const rest = FRAME_MS - (Date.now() - started)
    if (rest > 0) await sleep(rest)
    recordFrameTime(Date.now() - started)
  }
}

// ── Smooth scrolling ───────────────────────────────────────────────────
// Locate a scrollable element and stash it (plus its max scrollTop) on the
// page so `frameScroll` can drive it. `region` optionally constrains the
// search to a screen area (e.g. the left sidebar) so we pick the right
// scroller when several exist. Returns false if none was found.
async function prepareScroller(
  window: Page,
  opts: { anchorText?: string; maxLeft?: number; minHeight?: number }
): Promise<boolean> {
  return window.evaluate(({ anchorText, maxLeft, minHeight }) => {
    let scroller: HTMLElement | null = null
    if (anchorText) {
      const all = Array.from(document.querySelectorAll('h1, h2'))
      const anchor = all.find((h) => h.textContent && h.textContent.trim() === anchorText)
      let el: HTMLElement | null = anchor ? (anchor.parentElement as HTMLElement | null) : null
      while (el) {
        const oy = getComputedStyle(el).overflowY
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 8) {
          scroller = el
          break
        }
        el = el.parentElement
      }
    } else {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
        const oy = getComputedStyle(el).overflowY
        if (!(oy === 'auto' || oy === 'scroll')) continue
        if (el.scrollHeight <= el.clientHeight + 8) continue
        const r = el.getBoundingClientRect()
        if (maxLeft != null && r.left >= maxLeft) continue
        if (minHeight != null && r.height < minHeight) continue
        if (r.width < 80) continue
        scroller = el
        break
      }
    }
    const w = window as unknown as { __scroller?: HTMLElement | null; __scrollMax?: number }
    w.__scroller = scroller
    w.__scrollMax = scroller ? scroller.scrollHeight - scroller.clientHeight : 0
    return !!scroller
  }, opts)
}

// Drive the prepared scroller from `from`→`to` (fractions of max scrollTop)
// tied to the capture loop, so scrolling is frame-locked (no static tail from
// screenshot latency) and evenly paced. `ease` applies an ease-in-out curve.
async function frameScroll(
  window: Page,
  prefix: string,
  opts: { from: number; to: number; steps: number; ease?: boolean }
): Promise<void> {
  const { from, to, steps, ease } = opts
  for (let i = 1; i <= steps; i++) {
    const p = i / steps
    const curve = ease ? -(Math.cos(Math.PI * p) - 1) / 2 : p
    const frac = from + (to - from) * curve
    await window.evaluate((f) => {
      const w = window as unknown as { __scroller?: HTMLElement | null; __scrollMax?: number }
      if (w.__scroller) w.__scroller.scrollTop = (w.__scrollMax ?? 0) * f
    }, frac)
    await captureFrames(window, 1, `${prefix}-${String(i).padStart(3, '0')}`)
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
      'transition: transform 130ms cubic-bezier(0.4, 0, 0.2, 1)',
      'will-change: transform'
    ].join(';')
    el.innerHTML =
      '<svg viewBox="0 0 24 24" width="22" height="22" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4))">' +
      '<path fill="#000000" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"' +
      ' d="M4 2 L4 19.6 L8.7 15.4 L11.6 21.9 L14.1 20.8 L11.2 14.4 L17.6 14.4 Z"/></svg>'
    document.body.appendChild(el)
  })
}

// Cursor tip offset — empirically calibrated so the tip lands right on
// the click target. Increase to push the cursor further up and left.
const CURSOR_TIP_X = 30
const CURSOR_TIP_Y = 28

// Tracked logical cursor position (layout px), so travels can interpolate from
// where the cursor actually is. Seeded to the initial park position.
let cursorX = 640
let cursorY = 400

async function moveCursorTo(window: Page, x: number, y: number, dwellMs = 420): Promise<void> {
  cursorX = x
  cursorY = y
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

// Frame-locked, ease-in-out cursor travel. Instead of firing a blind CSS
// transition and hoping the slow screenshots sample it, we set an evenly-eased
// position *per captured frame* — so every frame is a distinct point on the
// path (no static tail) and the motion reads smooth. The step count scales
// with distance (~110px/frame) so visual speed stays uniform and short hops
// stay quick.
async function gestureMove(window: Page, x: number, y: number, prefix: string): Promise<void> {
  const sx = cursorX
  const sy = cursorY
  const dx = x - sx
  const dy = y - sy
  const dist = Math.hypot(dx, dy)
  const steps = Math.max(3, Math.min(8, Math.round(dist / 110)))
  for (let i = 1; i <= steps; i++) {
    const p = i / steps
    const eased = -(Math.cos(Math.PI * p) - 1) / 2
    const px = sx + dx * eased - CURSOR_TIP_X
    const py = sy + dy * eased - CURSOR_TIP_Y
    await window.evaluate(
      ({ px, py }) => {
        const el = document.getElementById('__demo-cursor') as HTMLElement | null
        if (el) el.style.transform = 'translate(' + px + 'px,' + py + 'px)'
      },
      { px, py }
    )
    await captureFrames(window, 1, `${prefix}-${String(i).padStart(2, '0')}`)
  }
  cursorX = x
  cursorY = y
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

// Move the cursor onto a located element with a smooth frame-locked travel,
// fire the ripple, hold briefly so the click reads, then click. Returns false
// if the element has no box (off-screen / not mounted) so callers can fall back.
async function gestureClick(
  window: Page,
  locator: ReturnType<Page['locator']>,
  prefix: string,
  opts?: { moveFrames?: number; holdFrames?: number; click?: boolean }
): Promise<boolean> {
  const box = await locator.boundingBox().catch(() => null)
  if (!box) return false
  const tx = box.x + box.width / 2
  const ty = box.y + box.height / 2
  await gestureMove(window, tx, ty, `${prefix}-move`)
  // Ripple + a short hold so the click itself registers to the eye.
  // The `-tap` suffix sorts after `-move` lexicographically, preserving order.
  await clickRipple(window, tx, ty)
  await captureFrames(window, opts?.holdFrames ?? 3, `${prefix}-tap`)
  if (opts?.click !== false) await locator.click().catch(() => undefined)
  return true
}

async function gestureClickTestId(
  window: Page,
  testid: string,
  prefix: string,
  opts?: { moveFrames?: number; holdFrames?: number; click?: boolean }
): Promise<boolean> {
  return gestureClick(window, window.getByTestId(testid), prefix, opts)
}

// ── Caption overlay ────────────────────────────────────────────────────
// A plain subtitle bar — like the captions on a video — that names the current
// page and what we're doing. Injected as a fixed overlay (so it never scrolls
// with content) and pinned to the bottom centre, subtitle-style, for every
// scene. It reads as a *video subtitle*, not part of the app: a solid dark strip
// with plain white text, sitting outside the app's own chrome. It fades/rises in
// on entry; `captionOut` fades it back out and — key point — captures those
// frames so the exit actually plays in the final video instead of being cut
// instantly.
async function showCaption(window: Page, label: string, text: string): Promise<void> {
  await window.evaluate(
    ({ label, text }) => {
      let el = document.getElementById('__demo-caption') as HTMLElement | null
      if (!el) {
        el = document.createElement('div')
        el.id = '__demo-caption'
        document.body.appendChild(el)
      }
      // Rise in from below; the exit reverses this. All captions sit at the
      // bottom centre like subtitles, so the travel direction is always down.
      const dir = 1
      el.style.position = 'fixed'
      el.style.zIndex = '999990'
      el.style.pointerEvents = 'none'
      el.style.left = '50%'
      el.style.right = 'auto'
      el.style.top = 'auto'
      el.style.bottom = '58px'
      el.dataset.dir = String(dir)
      // Start hidden and offset, then animate to resting place.
      el.style.transition = 'opacity 300ms ease, transform 340ms cubic-bezier(0.16, 1, 0.3, 1)'
      el.style.opacity = '0'
      el.style.transform = 'translate(-50%,' + 10 * dir + 'px)'
      // Plain subtitle strip: solid dark bar, white text, centred. The page name
      // leads in bold so it's easy to follow which screen we're on.
      const bar =
        'max-width:680px;padding:9px 20px;text-align:center;' +
        'background:rgba(12,14,18,0.86);' +
        'border:1px solid rgba(255,255,255,0.10);border-radius:9px;' +
        'box-shadow:0 10px 30px rgba(0,0,0,0.5);' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
        'font-size:15px;line-height:1.4;color:rgba(255,255,255,0.92)'
      const lead = 'font-weight:700;color:#ffffff'
      el.innerHTML =
        '<div style="' +
        bar +
        '"><span style="' +
        lead +
        '">' +
        label +
        '</span>&nbsp;&mdash;&nbsp;' +
        text +
        '</div>'
      requestAnimationFrame(() => {
        el.style.opacity = '1'
        el.style.transform = 'translate(-50%, 0)'
      })
    },
    { label, text }
  )
}

// Fade the subtitle back out (and let it settle toward its edge) while *capturing
// the frames* so the exit plays in the video rather than snapping off. Clears the
// bar afterward. No-op if no caption is showing.
async function captionOut(window: Page, prefix: string, frames = 4): Promise<void> {
  const has = await window.evaluate(() => {
    const el = document.getElementById('__demo-caption') as HTMLElement | null
    if (!el) return false
    const dir = Number(el.dataset.dir || '1')
    el.style.opacity = '0'
    el.style.transform = 'translate(-50%,' + 10 * dir + 'px)'
    return true
  })
  if (!has) return
  await captureFrames(window, frames, prefix)
  await window.evaluate(() => {
    const el = document.getElementById('__demo-caption') as HTMLElement | null
    if (el) el.innerHTML = ''
  })
}

// ── Terminal painting helpers ──────────────────────────────────────────
const ESC = '\x1b'
const ANSI = {
  reset: `${ESC}[0m`,
  dim: `${ESC}[2m`,
  bold: `${ESC}[1m`,
  cyan: `${ESC}[36m`,
  green: `${ESC}[32m`,
  blue: `${ESC}[34m`,
  yellow: `${ESC}[33m`,
  magenta: `${ESC}[35m`,
  red: `${ESC}[31m`,
  clear: `${ESC}[3J${ESC}[2J${ESC}[H`
}

async function writeTerminal(window: Page, tabId: string, text: string): Promise<void> {
  await window.evaluate(
    ({ tabId, text }) => {
      // @ts-expect-error injected
      const entry = window.__dplex.terminalRegistry.getTerminalEntry(tabId)
      if (entry?.term) entry.term.write(text)
    },
    { tabId, text }
  )
}

// Cosmetic: replace a session tab's on-disk cwd (a `/var/folders/...` temp dir)
// with a friendly `~/code/<name>` for the breadcrumb. Safe — the PTY has
// already spawned against the real path by the time this runs; only the header
// display reads `tab.cwd`.
async function patchTabCwd(window: Page, tabId: string, friendly: string): Promise<void> {
  await window.evaluate(
    ({ tabId, friendly }) => {
      // @ts-expect-error injected
      const ts = window.__dplex.terminalStore
      const st = ts.getState()
      ts.setState({
        groups: st.groups.map((g: { tabs: Array<{ id: string }> }) => ({
          ...g,
          tabs: g.tabs.map((t: { id: string }) => (t.id === tabId ? { ...t, cwd: friendly } : t))
        }))
      })
    },
    { tabId, friendly }
  )
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
  let lastShotAt = Date.now()
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
      recordFrameTime(Date.now() - lastShotAt)
      lastShotAt = Date.now()
    } else {
      await sleep(charDelayMs)
    }
  }
}

// Type into the currently-focused DOM input (e.g. the space-name field) one
// character at a time, capturing frames so the typing animation shows.
async function typeIntoInput(
  window: Page,
  text: string,
  prefix: string,
  charDelayMs = 70
): Promise<void> {
  let frameIdx = 0
  let sinceLastShot = 0
  let lastShotAt = Date.now()
  for (const ch of text) {
    await window.keyboard.type(ch)
    sinceLastShot += charDelayMs
    if (sinceLastShot >= FRAME_MS) {
      sinceLastShot -= FRAME_MS
      const file = path.join(FRAMES_DIR, `${prefix}-${String(frameIdx).padStart(4, '0')}.png`)
      await window.screenshot({ path: file })
      frameIdx++
      recordFrameTime(Date.now() - lastShotAt)
      lastShotAt = Date.now()
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
        `${DIM}~/code/web-app  ${CYAN}main${RESET}`,
        `${DIM}$${RESET} copilot`,
        ``,
        `${BOLD}${MAGENTA}● ${BOLD}Polish the marketing hero section${RESET}`,
        `${DIM}  12 messages · 3 tool calls${RESET}`,
        ``,
        `${BLUE}${BOLD}You${RESET}`,
        `${DIM}  Tighten the hero copy and make the CTA button${RESET}`,
        `${DIM}  responsive on small screens.${RESET}`,
        ``,
        `${GREEN}${BOLD}● Copilot${RESET}`,
        `  Updated the hero and made the CTA wrap gracefully`,
        `  under 380px.`,
        ``,
        `  ${YELLOW}▸${RESET} ${DIM}edit${RESET} src/Hero.tsx`,
        `  ${GREEN}✓${RESET} ${DIM}+18 −6${RESET}`,
        ``,
        `  ${YELLOW}▸${RESET} ${DIM}run${RESET} npm test`,
        `  ${GREEN}✓${RESET} ${DIM}14 passed${RESET}`,
        ``,
        `  Done — the hero reads tighter and the CTA no longer`,
        `  overflows on mobile.`,
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

  // Root the fabricated repos at a clean, deterministic path so any UI that
  // surfaces the absolute repo path (e.g. the diff breadcrumb) reads
  // professionally instead of leaking an opaque OS temp path like
  // /var/folders/…/T/dplex-demo-XXXX. On Windows there's no /tmp, so fall
  // back to the OS temp dir there.
  const root =
    process.platform === 'win32'
      ? path.join(os.tmpdir(), 'dplex-demo', 'code')
      : '/tmp/dplex-demo/code'
  await fs.rm(root, { recursive: true, force: true })
  await fs.mkdir(root, { recursive: true })
  const projectPaths: Record<string, string> = {}
  for (const p of FAKE_PROJECTS) {
    projectPaths[p.id] = await makeRepo(root, p.name, PROJECT_FILES[p.id] ?? [])
  }
  for (const w of FAKE_WORKTREES) {
    const parentDir = projectPaths[w.parentId]
    const wtDir = path.join(
      parentDir,
      '..',
      `${path.basename(parentDir)}-${w.branch.replace(/\//g, '-')}`
    )
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
      pinned: p.id === 'p-app' || p.id === 'p-api',
      tabColor: PROJECT_COLORS[p.id]
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
  // Supersample: size the window to DPR× the design resolution and zoom the
  // renderer by DPR. The layout viewport stays 1280×800 (identical to the
  // calibrated design, so all cursor/boundingBox math is unchanged) while the
  // backing store — and thus every screenshot — renders at 2×. The encoders
  // downscale with lanczos for crisp text.
  await window.setViewportSize({ width: 1280 * DPR, height: 800 * DPR })
  await app.evaluate(({ BrowserWindow }, dpr) => {
    BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(dpr)
  }, DPR)
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

  // Bind the seeded projects to the active Space so the switcher reads
  // "5 proj" instead of "0 proj" — a pure state patch (no workspace
  // reconstruction), safely a no-op if the default space isn't up yet.
  // Also seed a few *background* spaces so the switcher dropdown shows off
  // the Spaces feature (multiple workspaces to jump between).
  await window.evaluate(
    ({ projectIds, extraSpaces }) => {
      // @ts-expect-error injected
      const ss = window.__dplex.spaceStore.getState()
      if (!ss.activeSpaceId) return
      const patched = ss.spaces.map((s: { id: string; projectIds: string[] }) =>
        s.id === ss.activeSpaceId ? { ...s, projectIds } : s
      )
      // @ts-expect-error injected
      window.__dplex.spaceStore.setState({ spaces: [...patched, ...extraSpaces] })
    },
    { projectIds: DEMO_PROJECT_IDS, extraSpaces: buildDemoSpaces() }
  )
  await sleep(150)

  // Seed attention so the background spaces' sessions read as genuinely live
  // (pulsing status dots + a rolled-up "needs you" tag) on the overview cards.
  await window.evaluate((active) => {
    // @ts-expect-error injected
    window.__dplex.attentionStore.setState({ active })
  }, buildDemoSpaceAttention())
  await sleep(150)

  await paintInitialSession(window)
  await sleep(900)

  // Open straight into the Spaces overview (mission control) so the demo starts
  // there rather than inside an already-open session. sendToBackground() clears
  // the active space (activeSpaceId → null), which is exactly the overview view.
  await window.evaluate(() => {
    // @ts-expect-error injected
    window.__dplex.spaceStore.getState().sendToBackground()
  })
  await sleep(500)

  await injectCursor(window)
  // Park cursor at a neutral starting spot.
  await moveCursorTo(window, 640, 400, 100)

  // ── 1. Spaces overview — mission control (opening shot) ───────────────
  // The app was put into overview mode during setup, so the very first thing
  // the viewer sees is mission control rather than an already-open session.
  await sleep(350)
  await showCaption(window, 'Spaces overview', 'Mission control for every multi-repo feature.')
  await captureFrames(window, 20, '01-overview')
  await captionOut(window, '01z-overview-out')

  // ── 2. Projects — skim the list ───────────────────────────────────────
  // Expand every project so the panel has enough content to scroll, then
  // gently wheel down and back so it reads as "looking over my work".
  await window.evaluate(
    (ids) => {
      // @ts-expect-error injected
      window.__dplex.projectStore.setState({ expandedProjectIds: new Set(ids) })
    },
    FAKE_PROJECTS.map((p) => p.id)
  )
  await sleep(350)
  await showCaption(window, 'Your projects', 'Every repo you work in, one click away.')
  await captureFrames(window, 9, '02-projects')

  // Move the visible cursor onto the project panel before skimming, so the
  // scroll clearly reads as "looking over my projects" with the pointer there.
  await moveCursorTo(window, 150, 300, 200)
  await window.mouse.move(150, 300)
  await captureFrames(window, 4, '02b-projects-hover')
  // Smoothly scroll the project list down and back up (frame-locked + eased so
  // it reads as a natural glance, not a robotic step-scroll).
  const gotProjScroller = await prepareScroller(window, { maxLeft: 300, minHeight: 200 })
  if (gotProjScroller) {
    await frameScroll(window, '03-projects-down', { from: 0, to: 0.6, steps: 15, ease: true })
    await captureFrames(window, 4, '03b-projects-rest')
    await frameScroll(window, '04-projects-up', { from: 0.6, to: 0, steps: 12, ease: true })
  }
  await captureFrames(window, 4, '05-projects-top')
  await captionOut(window, '05z-projects-out')

  // ── 3. Create a new space for the feature ─────────────────────────────
  const OAUTH_SPACE = 'Ship OAuth login'
  const OAUTH_PROJECTS = ['p-api', 'p-app']
  await gestureClickTestId(window, 'overview-new-space', '08-new-space')
  await sleep(500)
  await showCaption(window, 'New space', 'Group the repos a single feature spans.')
  await captureFrames(window, 8, '09-modal')

  // Name — focus the field then type it out.
  await gestureClick(window, window.getByPlaceholder(/Ship OAuth/i), '10-name-focus', {
    click: true
  })
  await typeIntoInput(window, OAUTH_SPACE, '11-name-type')
  await captureFrames(window, 4, '12-name-done')

  // Bind the two projects the feature spans.
  await gestureClick(
    window,
    window.locator('button[aria-selected]', { hasText: 'api-server' }).first(),
    '13-pick-api'
  )
  await captureFrames(window, 3, '14-picked-api')
  await gestureClick(
    window,
    window.locator('button[aria-selected]', { hasText: 'web-app' }).first(),
    '15-pick-web'
  )
  await captureFrames(window, 3, '16-picked-web')

  // Save — then guarantee the space exists, is active, and has both projects
  // bound (so the quick-start actually offers them) even if a locator missed.
  await gestureClickTestId(window, 'space-modal-save', '17-save')
  await window.evaluate(
    ({ name, ids }) => {
      // @ts-expect-error injected
      const ss = window.__dplex.spaceStore.getState()
      const active = ss.spaces.find((s: { id: string }) => s.id === ss.activeSpaceId)
      if (!active || active.name !== name) {
        ss.createSpace({ name, projectIds: ids })
      } else {
        ss.assignProjects(active.id, ids)
      }
    },
    { name: OAUTH_SPACE, ids: OAUTH_PROJECTS }
  )
  await sleep(700)
  await captureFrames(window, 8, '18-space-created')
  await captionOut(window, '18z-newspace-out')

  const apiPath = projectPaths['p-api']
  const appPath = projectPaths['p-app']

  // ── 4. Start session 1 — api-server, from the space's empty-state page ──
  // Clear the workspace so the new space shows its Welcome (empty) state: a
  // per-project "Start session" card for each bound project. We visually click
  // api-server's "Start session" (we don't really fire it — that would
  // exec-replace the login shell — we create the tab programmatically and
  // paint fabricated AI output, the established pattern).
  await window.evaluate(() => {
    // @ts-expect-error injected
    window.__dplex.terminalStore.setState({ groups: [], layout: null, activeGroupId: null })
  })
  await sleep(500)
  await showCaption(window, 'Live session', 'Start an AI agent right inside the space.')
  await captureFrames(window, 10, '19-space-welcome')
  await gestureClick(
    window,
    window
      .locator('div.rounded-xl')
      .filter({ hasText: 'api-server' })
      .getByRole('button', { name: /Start session/ })
      .first(),
    '20-start-api',
    { click: false }
  )
  await sleep(250)

  const s1TabId = (await window.evaluate(
    ({ title, cwd }) => {
      // @ts-expect-error injected
      const ts = window.__dplex.terminalStore
      return ts
        .getState()
        .createTerminal(undefined, title, undefined, undefined, cwd, 'copilot-cli')
    },
    { title: '⚡ api-server · main', cwd: apiPath }
  )) as string
  await sleep(500)
  await patchTabCwd(window, s1TabId, '~/code/api-server')
  // Paint the header + an empty "You" prompt, type the prompt live, then stream
  // the assistant's reply — so session 1 reads as a real conversation too.
  const s1Header =
    ANSI.clear +
    `${ANSI.dim}~/code/api-server  ${ANSI.cyan}main${ANSI.reset}\r\n` +
    `${ANSI.dim}$${ANSI.reset} copilot\r\n\r\n` +
    `${ANSI.bold}${ANSI.magenta}● ${ANSI.bold}Ship OAuth login — API${ANSI.reset}\r\n\r\n` +
    `${ANSI.blue}${ANSI.bold}You${ANSI.reset}  `
  const s1Prompt = 'add PKCE verification and refresh-token rotation to the /token endpoint\r\n'
  const s1Response =
    `\r\n${ANSI.green}${ANSI.bold}● Copilot${ANSI.reset}\r\n` +
    `  On it — wiring PKCE (S256) and rotating refresh tokens.\r\n\r\n` +
    `  ${ANSI.yellow}▸${ANSI.reset} ${ANSI.dim}edit${ANSI.reset} src/auth/token.ts\r\n` +
    `  ${ANSI.green}✓${ANSI.reset} ${ANSI.dim}+21 −4${ANSI.reset}\r\n\r\n` +
    `  ${ANSI.yellow}▸${ANSI.reset} ${ANSI.dim}edit${ANSI.reset} src/auth/refresh.ts\r\n` +
    `  ${ANSI.dim}  rotating…${ANSI.reset}\r\n`
  await writeTerminal(window, s1TabId, s1Header)
  await sleep(250)
  await typeIntoActiveTerminal(window, s1Prompt, '21-type-s1', 42)
  await sleep(150)
  await writeTerminal(window, s1TabId, s1Response)
  await captureFrames(window, 9, '22-session1')
  // Full transcript, used to repaint session 1 after the split (wipes any late
  // shell prompt in the top pane).
  const s1Content = s1Header + s1Prompt + s1Response

  // ── 5. Start session 2 — web-app — from the "+ New session" dropdown ──
  // Click the top-right "+ New session" button to open its dropdown, then
  // click the project's "Start" inside that popover (scoped by testid so we hit
  // the popover row, not the project's row in the sidebar).
  await captionOut(window, '22z-live-out')
  await showCaption(
    window,
    'Parallel sessions',
    'Split the view and run a second repo side by side.'
  )
  await gestureClickTestId(window, 'space-quick-start', '23-quick-start-2')
  await sleep(400)
  await captureFrames(window, 10, '24-picker-2')
  await gestureClickTestId(window, 'space-quickstart-start-p-app', '25-start-web', {
    click: false
  })
  await window.keyboard.press('Escape')
  await sleep(250)

  const s2TabId = (await window.evaluate(
    ({ title, cwd }) => {
      // @ts-expect-error injected
      const ts = window.__dplex.terminalStore
      return ts
        .getState()
        .createTerminal(undefined, title, undefined, undefined, cwd, 'claude-code')
    },
    { title: '⚡ web-app · main', cwd: appPath }
  )) as string
  await sleep(450)
  await patchTabCwd(window, s2TabId, '~/code/web-app')
  await captureFrames(window, 6, '26-session2-tab')

  // Gesture over the split-down control, then perform the split
  // programmatically (moving session 2 into a fresh bottom group) so we get a
  // clean 2-pane result without splitGroup's stray empty terminal.
  await gestureClick(window, window.locator('button[title="Split down"]').first(), '27-split', {
    click: false
  })
  await window.evaluate((bottomTabId) => {
    // @ts-expect-error injected
    const ts = window.__dplex.terminalStore
    const st = ts.getState()
    const topId = st.activeGroupId
    const top = st.groups.find((g: { id: string }) => g.id === topId)
    if (!top) return
    const moved = top.tabs.find((t: { id: string }) => t.id === bottomTabId)
    if (!moved) return
    const rest = top.tabs.filter((t: { id: string }) => t.id !== bottomTabId)
    const B = 'group-split-1'
    ts.setState({
      groups: [
        ...st.groups.map((g: { id: string; tabs: Array<{ id: string }> }) =>
          g.id === topId
            ? { ...g, tabs: rest, activeTabId: rest.length ? rest[rest.length - 1].id : null }
            : g
        ),
        { id: B, tabs: [moved], activeTabId: moved.id }
      ],
      layout: {
        type: 'split',
        direction: 'vertical',
        children: [
          { type: 'group', groupId: topId },
          { type: 'group', groupId: B }
        ]
      },
      activeGroupId: B
    })
  }, s2TabId)
  await sleep(600)
  // Repaint session 1 so any late shell prompt that arrived after the first
  // paint is wiped before we hold on the split.
  await writeTerminal(window, s1TabId, s1Content)
  await captureFrames(window, 8, '28-split-done')

  // Paint a header into session 2, type a prompt, then stream a reply.
  await writeTerminal(
    window,
    s2TabId,
    ANSI.clear +
      `${ANSI.dim}~/code/web-app  ${ANSI.cyan}main${ANSI.reset}\r\n` +
      `${ANSI.dim}$${ANSI.reset} claude\r\n\r\n` +
      `${ANSI.bold}${ANSI.magenta}● ${ANSI.bold}Ship OAuth login — Web${ANSI.reset}\r\n\r\n` +
      `${ANSI.blue}${ANSI.bold}You${ANSI.reset}  `
  )
  await sleep(200)
  await typeIntoActiveTerminal(
    window,
    'build the sign-in form with inline validation\r\n',
    '29-type-s2',
    45
  )
  await sleep(150)
  await writeTerminal(
    window,
    s2TabId,
    `\r\n${ANSI.green}${ANSI.bold}● Claude${ANSI.reset}\r\n` +
      `  Building the sign-in form with inline validation.\r\n\r\n` +
      `  ${ANSI.yellow}▸${ANSI.reset} ${ANSI.dim}edit${ANSI.reset} src/components/LoginForm.tsx\r\n` +
      `  ${ANSI.green}✓${ANSI.reset} ${ANSI.dim}+16 −2${ANSI.reset}\r\n\r\n` +
      `  ${ANSI.yellow}▸${ANSI.reset} ${ANSI.dim}create${ANSI.reset} src/utils/validate.ts\r\n` +
      `  ${ANSI.dim}  writing…${ANSI.reset}\r\n`
  )
  await captureFrames(window, 10, '30-session2-running')

  // ── 6. Resume a related session from the Sessions panel ───────────────
  await captionOut(window, '30z-parallel-out')
  await showCaption(
    window,
    'Session history',
    'Find a related session and resume it into this space.'
  )
  await gestureClickTestId(window, 'activity-bar-sessions', '31-to-sessions')
  await sleep(400)
  await captureFrames(window, 9, '32-sessions-panel')

  const RESUMED_SUMMARY = 'Add OAuth callback route and token exchange'
  await gestureClick(window, window.locator(`text=${RESUMED_SUMMARY}`).first(), '33-session-row', {
    click: false
  })

  const resumedTabId = (await window.evaluate(
    ({ title, cwd }) => {
      // @ts-expect-error injected
      const ts = window.__dplex.terminalStore
      const st = ts.getState()
      // Resume into the TOP group (first child of the split) so it lands
      // alongside session 1 while session 2 keeps running below.
      let top = st.activeGroupId
      const lay = st.layout
      if (lay && lay.type === 'split' && lay.children && lay.children.length) {
        top = lay.children[0].groupId
      }
      return ts.getState().createTerminal(top, title, undefined, undefined, cwd, 'copilot-cli')
    },
    { title: '↻ OAuth callback route', cwd: apiPath }
  )) as string
  await sleep(500)
  await patchTabCwd(window, resumedTabId, '~/code/api-server')
  await writeTerminal(
    window,
    resumedTabId,
    ANSI.clear +
      `${ANSI.dim}~/code/api-server  ${ANSI.cyan}main${ANSI.reset}\r\n` +
      `${ANSI.dim}$${ANSI.reset} copilot --resume=7f3a9c\r\n\r\n` +
      `${ANSI.bold}${ANSI.magenta}● ${ANSI.bold}Add OAuth callback route${ANSI.reset}\r\n` +
      `${ANSI.dim}  Resumed · 9 messages · 3 tool calls${ANSI.reset}\r\n\r\n` +
      `${ANSI.green}${ANSI.bold}● Copilot${ANSI.reset}\r\n` +
      `  Session restored — the callback stub is in place.\r\n\r\n` +
      `${ANSI.blue}${ANSI.bold}You${ANSI.reset}  `
  )
  await captureFrames(window, 10, '34-resumed')
  await typeIntoActiveTerminal(
    window,
    'handle the /callback redirect and exchange the code\r\n',
    '35-type-resume',
    45
  )
  await sleep(150)
  await writeTerminal(
    window,
    resumedTabId,
    `\r\n${ANSI.green}${ANSI.bold}● Copilot${ANSI.reset}\r\n` +
      `  Wiring the redirect handler and code exchange.\r\n\r\n` +
      `  ${ANSI.yellow}▸${ANSI.reset} ${ANSI.dim}edit${ANSI.reset} src/auth/callback.ts\r\n` +
      `  ${ANSI.dim}  exchanging…${ANSI.reset}\r\n`
  )
  await captureFrames(window, 11, '36-all-running')

  // ── 7. Overview dashboard — slowly scroll every metric ────────────────
  await window.evaluate((metrics) => {
    // @ts-expect-error injected
    window.__dplex.dashboardStore.setState({
      metrics,
      loading: false,
      error: null,
      dirty: false,
      lastLoadedAt: Date.now()
    })
  }, buildDashboardMetrics())
  // Collapse to a single full-width group so the dashboard fills the area.
  await window.evaluate(() => {
    // @ts-expect-error injected
    const ts = window.__dplex.terminalStore
    const st = ts.getState()
    let topId = st.activeGroupId
    const lay = st.layout
    if (lay && lay.type === 'split' && lay.children && lay.children.length) {
      topId = lay.children[0].groupId
    }
    const top = st.groups.find((g: { id: string }) => g.id === topId)
    if (!top) return
    ts.setState({
      groups: [top],
      layout: { type: 'group', groupId: topId },
      activeGroupId: topId
    })
  })
  await sleep(300)

  await gestureClickTestId(window, 'activity-bar-dashboard', '37-to-dashboard')
  await sleep(1100)
  await moveCursorTo(window, 640, 360, 200)
  await showCaption(window, 'Insights', 'Streaks, cadence and provider mix at a glance.')
  await captureFrames(window, 24, '38-dashboard-top')

  // Scroll the whole dashboard at a steady, gentle pace. Frame-locked (scrollTop
  // set per captured frame) so it reaches the bottom exactly on the last frame —
  // no static tail from screenshot latency — and linear so every metric gets
  // equal, readable dwell as it passes. The Insights caption stays pinned at the
  // bottom through the scroll (subtitle-style) and only animates out when we
  // leave for the next phase.
  const gotDashScroller = await prepareScroller(window, { anchorText: 'Overview' })
  if (gotDashScroller) {
    await frameScroll(window, '39-dashboard-scroll', { from: 0, to: 1, steps: 72 })
  }
  await captureFrames(window, 2, '40-dashboard-bottom')

  // ── 8. Git — open a side-by-side diff and scroll it ───────────────────
  // Point the Git panel at api-server, open it, and refresh so the tracked
  // modifications show up in the Changes list.
  await captionOut(window, '40z-insights-out')
  await window.evaluate(() => {
    // @ts-expect-error injected
    window.__dplex.projectStore.setState({ activeProjectId: 'p-api' })
  })
  await gestureClickTestId(window, 'activity-bar-git', '41-to-git', { moveFrames: 7 })
  await sleep(500)
  await window.evaluate(() => {
    // @ts-expect-error injected
    const gp = window.__dplex.gitPanelStore
    if (gp && gp.getState().refresh) gp.getState().refresh()
  })
  await sleep(1200)
  await showCaption(window, 'Review changes', 'Side-by-side diffs across all your projects.')
  await captureFrames(window, 22, '42-git-changes')

  // Open the token.ts diff (double-click promotes to a permanent tab). Modified
  // (tracked) files default to side-by-side, so both gutters are populated. Keep
  // the Review-changes caption up through the diff open + side-by-side hold so it
  // reads alongside the diffs for a few seconds, then animate it out before we
  // scroll the code (so it never covers the lines scrolling past).
  const fileRow = window.locator('[data-git-path="src/auth/token.ts"]').first()
  const okRow = await gestureClick(window, fileRow, '43-file-row', { click: false })
  if (okRow) {
    await fileRow.dblclick().catch(() => undefined)
  } else {
    // Fallback: open the first changed file if the exact path isn't found.
    await window
      .locator('[data-git-path]')
      .first()
      .dblclick()
      .catch(() => undefined)
  }
  await sleep(1400)
  await captureFrames(window, 8, '44-diff-open')

  // Draw attention to the side-by-side toggle, then scroll the Monaco diff.
  await gestureClick(
    window,
    window.getByTitle(/side-by-side|inline view/i).first(),
    '45-sbs-toggle',
    {
      click: false
    }
  )
  await captureFrames(window, 6, '46-sbs-hold')
  await captionOut(window, '46z-review-out')
  await window.mouse.move(820, 420)
  for (let s = 0; s < 9; s++) {
    await window.mouse.wheel(0, 60)
    await captureFrames(window, 2, `47-diff-scroll-${s}`)
  }
  await captureFrames(window, 10, '48-diff-rest')

  // ── 9. End frame — let it breathe ─────────────────────────────────────
  await showCaption(window, 'DPlex', 'Every AI coding session, organized in one place.')
  await captureFrames(window, 8, 'z-end')

  await app.close()
  await fs.rm(userDataDir, { recursive: true, force: true })
  // Remove the whole demo workspace dir (parent of `code`), not just `code`,
  // so we don't leave an empty scaffold behind.
  await fs.rm(process.platform === 'win32' ? root : path.dirname(root), {
    recursive: true,
    force: true
  })

  // ── Encode: H.264 MP4 (primary) + gifski GIF (fallback) ───────────────
  // Sorted frame list — filenames are zero-padded and scene prefixes are
  // alphabetically monotonic, so a plain sort yields playback order.
  const frameFiles = (await fs.readdir(FRAMES_DIR))
    .filter((f) => f.endsWith('.png'))
    .sort()
    .map((f) => path.join(FRAMES_DIR, f))

  if (!ffmpegPath) {
    console.error('ffmpeg-static did not provide a binary')
    process.exit(1)
  }

  // Encode at the *measured* effective fps so playback is true real-time (see
  // the FPS note above) rather than the nominal capture target.
  const encodeFps = effectiveFps()
  console.log(
    `Captured ${CAP_FRAMES} timed frames; effective ${encodeFps}fps ` +
      `(${(CAP_MS / Math.max(1, CAP_FRAMES)).toFixed(0)}ms/frame).`
  )

  // 1. MP4 — the README hero. H.264 + yuv420p for universal playback; GitHub
  //    renders it inline via <video>. ~5–20× smaller than the GIF.
  const mp4Out = path.join(OUT, 'demo.mp4')
  const mp4Res = spawnSync(
    ffmpegPath,
    [
      '-y',
      '-framerate',
      String(encodeFps),
      '-pattern_type',
      'glob',
      '-i',
      path.join(FRAMES_DIR, '*.png'),
      '-vf',
      `scale=${OUT_WIDTH}:-2:flags=lanczos,format=yuv420p`,
      '-c:v',
      'libx264',
      '-crf',
      '20',
      '-preset',
      'veryslow',
      '-movflags',
      '+faststart',
      mp4Out
    ],
    { stdio: 'inherit' }
  )
  assertEncodeOk('ffmpeg (MP4)', mp4Res)

  // 2. GIF — universal fallback (npm page, mirrors that don't render <video>).
  //    gifski gives thousands of colors/frame + temporal dithering — far
  //    crisper on UI text than ffmpeg's 256-color palettegen. Sample every 2nd
  //    frame and play at half the effective fps so the GIF keeps the same
  //    real-time pacing as the MP4 while staying a reasonable size.
  const GIF_WIDTH = 900
  const GIF_FPS = Math.max(1, Math.round(encodeFps / 2))
  const gifFrames = frameFiles.filter((_, i) => i % 2 === 0)
  const gifOut = path.join(OUT, 'demo.gif')
  const gifRes = spawnSync(
    gifskiPath,
    [
      '-o',
      gifOut,
      '--fps',
      String(GIF_FPS),
      '--quality',
      '90',
      '--width',
      String(GIF_WIDTH),
      '--extra',
      ...gifFrames
    ],
    { stdio: 'inherit' }
  )
  assertEncodeOk('gifski (GIF)', gifRes)

  // Only clean up the captured frames once both encoders have succeeded — on
  // failure we keep them so the run can be diagnosed/re-encoded.
  await fs.rm(FRAMES_DIR, { recursive: true, force: true })
  console.log(`\nDone. MP4: ${mp4Out}\n      GIF: ${gifOut}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
