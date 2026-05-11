// electron-builder `afterPack` hook — applies an ad-hoc codesignature to
// the freshly-packed macOS .app BEFORE electron-builder seals it into a
// DMG. Without this, the published DMG ships an entirely unsigned .app
// (issue #45 follow-up).
//
// Why afterPack and not afterSign:
//   `identity: null` in electron-builder.yml disables electron-builder's
//   own signing path, so its `afterSign` hook never fires. We sign here,
//   one level earlier, so the DMG's HFS payload contains a signed .app.
//
// Why `codesign --deep --sign -` against the packed .app rather than
// letting electron-builder ad-hoc sign per-component:
//   electron-builder's per-component path signs the main binary and
//   helpers but historically does not propagate the same ad-hoc identity
//   to the bundled `Electron Framework.framework`. macOS 14+ then refuses
//   to load the framework with `"Team IDs differ"`. A single recursive
//   `codesign --deep --sign -` signs every nested Mach-O — main binary,
//   helpers, the framework, dylibs — with the same (empty) ad-hoc
//   identity, eliminating the mismatch.
//
// What this DOES give us:
//   - `codesign -dvvv` reports a valid (ad-hoc) signature
//   - macOS 14+ loads the Electron Framework without "Team IDs differ"
//   - The "DPlex is damaged" Gatekeeper error path is avoided
//
// What this DOES NOT give us:
//   - Gatekeeper "Identified Developer" trust (still need Developer ID
//     + notarization for that — users still see the unidentified
//     developer warning on first launch and may need
//     `xattr -dr com.apple.quarantine`).
/* eslint-disable @typescript-eslint/explicit-function-return-type --
   Node build/CI hook, not application TypeScript. */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export default async function adhocSignMac(context) {
  const { electronPlatformName, appOutDir, packager } = context

  if (electronPlatformName !== 'darwin') return

  // Skip when a real Developer ID is configured — electron-builder will
  // do the proper signing and we'd just stomp on it.
  if (process.env.CSC_LINK) {
    console.log('[mac-adhoc-sign] CSC_LINK set — skipping ad-hoc signature')
    return
  }

  const productFilename = packager.appInfo.productFilename
  const appPath = path.join(appOutDir, `${productFilename}.app`)
  if (!fs.existsSync(appPath)) {
    console.log(`[mac-adhoc-sign] no .app at ${appPath} — skipping`)
    return
  }

  console.log(`[mac-adhoc-sign] ad-hoc signing ${appPath}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit'
  })
  execFileSync('codesign', ['--verify', '--verbose=2', appPath], { stdio: 'inherit' })
}
