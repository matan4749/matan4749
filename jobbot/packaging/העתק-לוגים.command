#!/bin/bash
# מעתיק לוגים של Jobbot לשולחן העבודה כ-zip לשליחה לצוות
set -euo pipefail
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${HOME}/Desktop/Jobbot-logs-${STAMP}"
OUT_ZIP="${HOME}/Desktop/Jobbot-logs-${STAMP}.zip"

echo ""
echo "══════════════════════════════════════"
echo "  Jobbot — מעתיק לוגים…"
echo "══════════════════════════════════════"
echo ""

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

copy_tree() {
  local src="$1"
  local name="$2"
  if [[ -e "$src" ]]; then
    echo "✓ $src"
    mkdir -p "$OUT_DIR/$name"
    # Skip huge Chrome profile caches; keep settings/runs/outbox/knowledge/chat
    rsync -a --exclude 'browser-profile/Default/Cache' \
      --exclude 'browser-profile/Default/Code Cache' \
      --exclude 'browser-profile/Default/GPUCache' \
      --exclude 'browser-profile/*/Cache' \
      --exclude 'chrome-clone/*/Cache' \
      --exclude 'BrowserMetrics*' \
      "$src/" "$OUT_DIR/$name/" 2>/dev/null \
      || cp -R "$src/." "$OUT_DIR/$name/" 2>/dev/null || true
  else
    echo "· חסר: $src"
    echo "(missing) $src" >> "$OUT_DIR/MISSING.txt"
  fi
}

# Electron userData (dev npm start uses "jobbot"; packaged may use "Jobbot")
copy_tree "${HOME}/Library/Application Support/jobbot/jobbot-data" "AppSupport-jobbot"
copy_tree "${HOME}/Library/Application Support/Jobbot/jobbot-data" "AppSupport-Jobbot"

# Launcher + crash reports
mkdir -p "$OUT_DIR/Library-Logs"
[[ -f "${HOME}/Library/Logs/Jobbot-launcher.log" ]] \
  && cp "${HOME}/Library/Logs/Jobbot-launcher.log" "$OUT_DIR/Library-Logs/" \
  && echo "✓ Jobbot-launcher.log" \
  || echo "· אין Jobbot-launcher.log"

# Recent DiagnosticReports mentioning Jobbot/Electron (names only + copy small ones)
mkdir -p "$OUT_DIR/DiagnosticReports"
shopt -s nullglob
for f in "${HOME}/Library/Logs/DiagnosticReports/"Jobbot* \
         "${HOME}/Library/Logs/DiagnosticReports/"Electron* \
         "${HOME}/Library/Logs/DiagnosticReports/"הפעל*; do
  [[ -f "$f" ]] || continue
  # skip huge .ips.gz if > 5MB
  sz=$(wc -c < "$f" | tr -d ' ')
  if [[ "$sz" -lt 5000000 ]]; then
    cp "$f" "$OUT_DIR/DiagnosticReports/" && echo "✓ $(basename "$f")"
  else
    echo "skip large $(basename "$f") ($sz)" >> "$OUT_DIR/DiagnosticReports/SKIPPED.txt"
  fi
done
shopt -u nullglob

# Source checkout tip
if [[ -d "${HOME}/Desktop/Jobbot-src/jobbot" ]]; then
  echo "Jobbot-src present on Desktop" > "$OUT_DIR/SOURCE.txt"
  git -C "${HOME}/Desktop/Jobbot-src" rev-parse --short HEAD 2>/dev/null >> "$OUT_DIR/SOURCE.txt" || true
  git -C "${HOME}/Desktop/Jobbot-src" branch --show-current 2>/dev/null >> "$OUT_DIR/SOURCE.txt" || true
fi

# Manifest
{
  echo "created=$STAMP"
  echo "host=$(hostname 2>/dev/null || true)"
  echo "user=$USER"
  uname -a 2>/dev/null || true
  sw_vers 2>/dev/null || true
  node -v 2>/dev/null || echo "node=missing"
} > "$OUT_DIR/SYSTEM.txt"

cd "$(dirname "$OUT_DIR")"
rm -f "$OUT_ZIP"
zip -r -q "$OUT_ZIP" "$(basename "$OUT_DIR")"
rm -rf "$OUT_DIR"

echo ""
echo "✅ מוכן לשליחה:"
echo "   $OUT_ZIP"
echo ""
echo "שלח את הקובץ הזה לצ׳אט / למייל."
if command -v osascript >/dev/null 2>&1; then
  osascript -e "display dialog \"הלוגים מוכנים על שולחן העבודה:\\n$OUT_ZIP\" buttons {\"OK\"} default button 1 with title \"Jobbot\"" >/dev/null 2>&1 || true
  open -R "$OUT_ZIP" 2>/dev/null || true
fi
if [[ -t 0 ]]; then
  read -r -p "לחץ Enter לסגירה… " _ || true
fi
