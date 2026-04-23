#!/bin/bash
# Wrapper around electron-builder's bundled `dmgbuild` that injects
# --detach-retries=30. The bundled python dmgbuild defaults to a single
# detach attempt, so Spotlight/XProtect holding the fresh DMG volume for
# a second is enough to fail the whole build with "Resource busy".
# 30 one-second retries gives the OS time to release the volume.
#
# Invoked by electron-builder when CUSTOM_DMGBUILD_PATH points here.
# See node_modules/dmg-builder/out/dmgUtil.js.

set -euo pipefail

CACHE_DIR="$HOME/Library/Caches/electron-builder/dmg-builder@1.2.0"
ARCH_SUFFIX="arm64"
if [ "$(uname -m)" != "arm64" ]; then
  ARCH_SUFFIX="x86_64"
fi

# The bundled tool lives at a path like
#   dmgbuild-bundle-<arch>-<sha>-<rand>/dmgbuild
# where <rand> is a per-install temp suffix. Glob it.
BUNDLED_DMGBUILD=$(ls -dt "$CACHE_DIR"/dmgbuild-bundle-"$ARCH_SUFFIX"-*/dmgbuild 2>/dev/null | head -n 1 || true)

# Fallback to the other arch bundle if the native one is absent
if [ -z "${BUNDLED_DMGBUILD:-}" ] || [ ! -x "$BUNDLED_DMGBUILD" ]; then
  OTHER="x86_64"
  [ "$ARCH_SUFFIX" = "x86_64" ] && OTHER="arm64"
  BUNDLED_DMGBUILD=$(ls -dt "$CACHE_DIR"/dmgbuild-bundle-"$OTHER"-*/dmgbuild 2>/dev/null | head -n 1 || true)
fi

if [ ! -x "$BUNDLED_DMGBUILD" ]; then
  echo "dmgbuild-wrapper: could not find bundled dmgbuild under $HOME/Library/Caches/electron-builder/dmg-builder@1.2.0/" >&2
  exit 1
fi

# Insert --detach-retries=30 ahead of all other args. dmgbuild accepts it as
# an option before the positional volume-name/output.dmg args.
exec "$BUNDLED_DMGBUILD" --detach-retries 30 "$@"
