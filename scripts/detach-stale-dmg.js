#!/usr/bin/env node
/**
 * Mac-only: before electron-builder builds a DMG, force-detach any stale
 * dplex-* DMG volumes left mounted by a previous (failed) build. Spotlight
 * or XProtect sometimes hold these mounts open, which causes dmgbuild's
 * final `hdiutil detach` to fail with "Resource busy" and abort the build.
 *
 * Safe to run multiple times / when nothing is mounted — each unmount is
 * best-effort and errors are swallowed. No-op on non-macOS platforms.
 */
const { execSync } = require('node:child_process')

if (process.platform !== 'darwin') process.exit(0)

let info = ''
try {
  info = execSync('hdiutil info', { encoding: 'utf8' })
} catch {
  process.exit(0)
}

// hdiutil info prints blank-line separated records. Each record has an
// `image-path : <path>` line and one or more `/dev/diskN ... /Volumes/...`
// lines. Detach every record whose image-path contains a dplex artifact.
const records = info.split(/\n\s*\n/)
const disksToDetach = new Set()

for (const rec of records) {
  if (!/image-path\s*:.*dplex/i.test(rec)) continue
  for (const line of rec.split('\n')) {
    const m = line.match(/^(\/dev\/disk\d+)(?:s\d+)?\b/)
    if (m) disksToDetach.add(m[1])
  }
}

for (const disk of disksToDetach) {
  try {
    execSync(`hdiutil detach ${disk} -force`, { stdio: 'ignore' })
    console.log(`[prebuild-mac] detached stale DMG volume: ${disk}`)
  } catch {
    // best effort — volume may already be gone
  }
}
