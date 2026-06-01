#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type --
   This is a Node build script, not application TypeScript. The
   explicit-function-return-type rule applies to .ts/.tsx files;
   .mjs scripts in this repo opt out following the same pattern as
   `scripts/build-changelog.mjs`. */
/**
 * Regenerate every icon asset from `resources/icon.svg`.
 *
 * `resources/icon.svg` is the single source of truth for the DPlex brand
 * mark. Whenever it changes (palette refresh, glyph tweak, etc.) the
 * following derived assets need to be re-rendered so the OS-level icons
 * (dock, taskbar, installer) match the in-app logo:
 *
 *   - `resources/icon.png` — 512²  · used by the renderer's empty-state
 *     hero and any non-React surface that wants a raster fallback.
 *   - `build/icon.png`     — 1024² · consumed by `electron-builder` as the
 *     baseline asset when packaging on Linux and as a fallback for
 *     mac/win when the platform-specific bundles below are missing.
 *   - `build/icon.icns`    — macOS app-bundle icon. Multi-resolution
 *     container covering 16..1024 px including @2x variants.
 *   - `build/icon.ico`     — Windows app + installer icon. Multi-image
 *     ICO covering 16..256 px.
 *
 * The script uses `sharp` (high-quality SVG → PNG rasterisation) and
 * `png2icons` (pure-JS multi-image ICO/ICNS packer). Both are installed
 * with `npm install --no-save` so they don't pollute `package.json` —
 * we only need them when regenerating icons, which is rare.
 *
 * Usage:
 *   node scripts/regen-icons.mjs
 *
 * Cross-platform: works on macOS, Windows, and Linux. Doesn't rely on
 * platform tools like `iconutil` (mac-only) or `ImageMagick` (extra
 * install on Windows).
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC_SVG = resolve(REPO_ROOT, 'resources/icon.svg')
const OUT_PNG_RESOURCES = resolve(REPO_ROOT, 'resources/icon.png')
const OUT_PNG_BUILD = resolve(REPO_ROOT, 'build/icon.png')
const OUT_ICNS = resolve(REPO_ROOT, 'build/icon.icns')
const OUT_ICO = resolve(REPO_ROOT, 'build/icon.ico')

// Ensure the source SVG exists; fail loudly otherwise.
if (!existsSync(SRC_SVG)) {
  console.error(`✗ Source SVG not found at ${SRC_SVG}`)
  process.exit(1)
}

// Lazily install rendering deps. Using --no-save keeps `package.json`
// clean: these are tools, not project dependencies. The dance below
// also tolerates a partially-installed state from an aborted previous run.
function ensureDeps() {
  const require = createRequire(import.meta.url)
  const missing = []
  for (const name of ['sharp', 'png2icons']) {
    try {
      require.resolve(name)
    } catch {
      missing.push(name)
    }
  }
  if (missing.length === 0) return

  console.log(`→ Installing rendering deps (no-save): ${missing.join(', ')}`)
  execSync(`npm install --no-save --no-audit --no-fund ${missing.join(' ')}`, {
    cwd: REPO_ROOT,
    stdio: 'inherit'
  })
}

async function main() {
  ensureDeps()

  // Use createRequire for both modules. sharp + png2icons are CommonJS
  // packages without an `exports` map, which Node 20's ESM resolver
  // doesn't always follow via the `main` field. createRequire goes
  // through the CommonJS resolver and works on every supported Node.
  const require = createRequire(import.meta.url)
  const sharp = require('sharp')
  const png2icons = require('png2icons')

  const svgBuffer = readFileSync(SRC_SVG)

  // Render base PNGs first. We rasterise from the SVG at a high density
  // (384 dpi) so the output is crisp even when downsampled — sharp's
  // SVG renderer benefits from oversized intermediates.
  console.log('→ Rendering PNG variants')
  const renderPng = async (size) =>
    sharp(svgBuffer, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer()

  const png512 = await renderPng(512)
  const png1024 = await renderPng(1024)

  // Ensure output dirs exist (resources/ always does; build/ may not on
  // a fresh checkout).
  for (const p of [OUT_PNG_RESOURCES, OUT_PNG_BUILD, OUT_ICNS, OUT_ICO]) {
    mkdirSync(dirname(p), { recursive: true })
  }

  writeFileSync(OUT_PNG_RESOURCES, png512)
  console.log(`  ✓ ${rel(OUT_PNG_RESOURCES)}  (512²)`)
  writeFileSync(OUT_PNG_BUILD, png1024)
  console.log(`  ✓ ${rel(OUT_PNG_BUILD)}      (1024²)`)

  // Build platform bundles from the 1024² master. png2icns/createICO
  // generate every required sub-image internally, so a single master is
  // enough — no need to feed them an array of sizes.
  console.log('→ Building platform bundles')
  const icns = png2icons.createICNS(png1024, png2icons.BILINEAR, 0)
  if (!icns) throw new Error('png2icons.createICNS returned null')
  writeFileSync(OUT_ICNS, icns)
  console.log(`  ✓ ${rel(OUT_ICNS)}     (macOS)`)

  const ico = png2icons.createICO(png1024, png2icons.BILINEAR, 0, false)
  if (!ico) throw new Error('png2icons.createICO returned null')
  writeFileSync(OUT_ICO, ico)
  console.log(`  ✓ ${rel(OUT_ICO)}      (Windows)`)

  console.log('\n✓ All icons regenerated from resources/icon.svg')
}

function rel(p) {
  return p.replace(REPO_ROOT + '/', '')
}

main().catch((err) => {
  console.error('\n✗ Icon regeneration failed:', err)
  process.exit(1)
})
