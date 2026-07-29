#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type --
   This is a Node build script, not application TypeScript. The
   explicit-function-return-type rule applies to .ts/.tsx files;
   .mjs scripts in this repo opt out following the same pattern as
   `scripts/regen-icons.mjs`. */
/**
 * Regenerate the per-type OS-notification icons from their SVG sources.
 *
 * Each notification kind gets a concrete, color-coded badge shown as the
 * notification's image (the right-side content image on macOS, the main
 * icon on Windows/Linux). The SVGs in `resources/notifications/*.svg` are
 * the single source of truth; this script rasterises them to the committed
 * `*.png` files the main process loads at runtime.
 *
 *   resources/notifications/approval.svg  → approval.png   (waiting for approval)
 *   resources/notifications/input.svg     → input.png      (waiting for input)
 *   resources/notifications/finished.svg  → finished.png   (agent finished)
 *   resources/notifications/error.svg     → error.png      (session error)
 *
 * Runtime never needs a rasteriser — only the PNGs are loaded — so this is
 * a rare, dev-only regeneration step (run it when an SVG changes).
 *
 * Uses `sharp` installed with `npm install --no-save` so it doesn't pollute
 * `package.json`, mirroring `scripts/regen-icons.mjs`.
 *
 * Usage:
 *   node scripts/regen-notification-icons.mjs
 *
 * Cross-platform: works on macOS, Windows, and Linux.
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = resolve(REPO_ROOT, 'resources/notifications')
const KINDS = ['approval', 'input', 'finished', 'error']
const SIZE = 256

function ensureDeps() {
  const require = createRequire(import.meta.url)
  try {
    require.resolve('sharp')
    return
  } catch {
    // fall through to install
  }
  console.log('→ Installing rendering dep (no-save): sharp')
  execSync('npm install --no-save --no-audit --no-fund sharp', {
    cwd: REPO_ROOT,
    stdio: 'inherit'
  })
}

async function main() {
  for (const kind of KINDS) {
    if (!existsSync(resolve(DIR, `${kind}.svg`))) {
      console.error(`✗ Source SVG not found: resources/notifications/${kind}.svg`)
      process.exit(1)
    }
  }

  ensureDeps()
  const require = createRequire(import.meta.url)
  const sharp = require('sharp')

  console.log(`→ Rendering ${SIZE}² notification icons`)
  for (const kind of KINDS) {
    const svg = readFileSync(resolve(DIR, `${kind}.svg`))
    const png = await sharp(svg, { density: 384 })
      .resize(SIZE, SIZE)
      .png({ compressionLevel: 9 })
      .toBuffer()
    const out = resolve(DIR, `${kind}.png`)
    writeFileSync(out, png)
    console.log(`  ✓ resources/notifications/${kind}.png`)
  }

  console.log('\n✓ Notification icons regenerated')
}

main().catch((err) => {
  console.error('\n✗ Notification icon regeneration failed:', err)
  process.exit(1)
})
