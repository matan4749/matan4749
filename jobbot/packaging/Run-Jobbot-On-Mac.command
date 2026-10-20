#!/bin/bash
# Run Jobbot from source on Apple Silicon Mac (native Electron).
# Double-click or: chmod +x Run-Jobbot-On-Mac.command && ./Run-Jobbot-On-Mac.command
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
# Prefer repo root if script lives in packaging/; else sibling jobbot/
if [[ -f "$DIR/../package.json" ]]; then
  ROOT="$(cd "$DIR/.." && pwd)"
elif [[ -f "$DIR/jobbot/package.json" ]]; then
  ROOT="$DIR/jobbot"
elif [[ -f "$DIR/package.json" ]]; then
  ROOT="$DIR"
else
  osascript -e 'display dialog "לא נמצא package.json של Jobbot ליד הסקריפט.\nשים את Run-Jobbot-On-Mac.command בתוך תיקיית jobbot/ או packaging/." buttons {"OK"} default button 1' 2>/dev/null || true
  echo "Missing package.json near $DIR" >&2
  exit 1
fi

cd "$ROOT"
osascript -e 'display dialog "Jobbot — מתקין ותלויות ומפעיל (פעם ראשונה יכול לקחת כמה דקות)…" buttons {"המשך"} default button 1 giving up after 3' 2>/dev/null || true

if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display dialog "לא נמצא Node.js.\nהתקן מ־https://nodejs.org (LTS) והרץ שוב." buttons {"OK"} default button 1' 2>/dev/null || true
  echo "Install Node.js LTS from https://nodejs.org" >&2
  exit 1
fi

echo "Node: $(node -v)  root: $ROOT"
npm install
npm run build
# Launch Electron GUI (native darwin binary from npm)
npx electron .
