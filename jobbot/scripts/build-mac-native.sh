#!/usr/bin/env bash
# MUST run on macOS (Apple Silicon). Produces a signed-ad-hoc Jobbot.app.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: This script only works on a Mac. Linux cross-builds cannot codesign." >&2
  exit 1
fi

echo "Building Jobbot for $(uname -m)…"
npm install
npm run build
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dir --arm64 --publish never

APP="$ROOT/release/mac-arm64/Jobbot.app"
if [[ ! -d "$APP" ]]; then
  # electron-builder may use mac/ depending on version
  APP="$ROOT/release/mac/Jobbot.app"
fi
if [[ ! -d "$APP" ]]; then
  echo "Jobbot.app not found under release/" >&2
  find "$ROOT/release" -name 'Jobbot.app' -type d 2>/dev/null | head
  exit 1
fi

echo "Ad-hoc codesign (fixes «עקב בעיה» for local unsigned apps)…"
codesign --force --deep --sign - "$APP"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

echo "OK → $APP"
echo "Open with: open \"$APP\""
open -R "$APP"
