#!/bin/bash
cd "$(dirname "$0")"
set -e
OUT="Jobbot-mac.zip"
rm -f "$OUT"
cat Jobbot-0.1.0-mac-arm64.zip.part00 Jobbot-0.1.0-mac-arm64.zip.part01 Jobbot-0.1.0-mac-arm64.zip.part02 > "$OUT"
echo "Created $OUT — double-click it, then open Jobbot.app"
open -R "$OUT" || true
read -n 1 -s -r -p "Press any key…"
