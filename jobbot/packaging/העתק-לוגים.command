#!/bin/bash
# ייצוא קל — בלי פרופיל דפדפן (zip קטן לשליחה)
set -euo pipefail
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${HOME}/Desktop/Jobbot-logs-${STAMP}"
OUT_ZIP="${HOME}/Desktop/Jobbot-logs-${STAMP}.zip"

echo ""
echo "══════════════════════════════════════"
echo "  Jobbot — ייצוא קל (בלי פרופיל דפדפן)"
echo "══════════════════════════════════════"
echo ""

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/Library-Logs" "$OUT_DIR/meta" "$OUT_DIR/DiagnosticReports"

copy_file() {
  local src="$1"
  local dest="$2"
  local max_bytes="${3:-2097152}"
  if [[ ! -f "$src" ]]; then
    return 1
  fi
  local sz
  sz=$(wc -c < "$src" | tr -d ' ')
  mkdir -p "$(dirname "$dest")"
  if [[ "$sz" -gt "$max_bytes" ]]; then
    echo "(truncated $(basename "$src") ${sz}B)" > "${dest}.TRUNCATED.txt"
    head -c 102400 "$src" > "${dest}.head.txt" 2>/dev/null || true
    echo "· גדול מדי, נחתך: $(basename "$src") ($sz)"
    return 0
  fi
  cp "$src" "$dest"
  echo "✓ $(basename "$src")"
  return 0
}

FOUND_DATA=0
for DATA in \
  "${HOME}/Library/Application Support/jobbot/jobbot-data" \
  "${HOME}/Library/Application Support/Jobbot/jobbot-data"
do
  [[ -d "$DATA" ]] || continue
  FOUND_DATA=1
  TAG=$(basename "$(dirname "$DATA")")
  DEST="$OUT_DIR/data-${TAG}"
  mkdir -p "$DEST/runs" "$DEST/outbox" "$DEST/knowledge"
  echo "— מקור: $DATA"

  copy_file "$DATA/settings.json" "$DEST/settings.json" 512000 || true
  copy_file "$DATA/chat.json" "$DEST/chat.json" 2097152 || true

  if [[ -d "$DATA/runs" ]]; then
    copy_file "$DATA/runs/latest.json" "$DEST/runs/latest.json" 2097152 || true
    for f in "$DATA/runs"/run-*.json; do
      [[ -f "$f" ]] || continue
      copy_file "$f" "$DEST/runs/$(basename "$f")" 2097152 || true
    done
    # newest 3 HTML reports (cap 2MB each)
    ls -t "$DATA/runs"/report-*.html 2>/dev/null | head -3 | while read -r f; do
      [[ -f "$f" ]] || continue
      copy_file "$f" "$DEST/runs/$(basename "$f")" 2097152 || true
    done
  fi

  if [[ -d "$DATA/outbox" ]]; then
    ls -la "$DATA/outbox" > "$DEST/outbox/LISTING.txt" 2>/dev/null || true
    ls -t "$DATA/outbox"/*.html 2>/dev/null | head -2 | while read -r f; do
      [[ -f "$f" ]] || continue
      copy_file "$f" "$DEST/outbox/$(basename "$f")" 2097152 || true
    done
  fi

  if [[ -d "$DATA/knowledge" ]]; then
    for f in "$DATA/knowledge"/*; do
      [[ -f "$f" ]] || continue
      copy_file "$f" "$DEST/knowledge/$(basename "$f")" 1048576 || true
    done
  fi

  cat > "$DEST/EXCLUSIONS.txt" <<'EX'
EXCLUDED (ייצוא קל — בלי פרופיל דפדפן):
- browser-profile/
- chrome-clone/
- node_modules / *.app / Cache / GPUCache
- HTML reports over 2MB (truncated)
EX
done

if [[ "$FOUND_DATA" -eq 0 ]]; then
  echo "· לא נמצא jobbot-data"
  echo "missing jobbot-data under Application Support" > "$OUT_DIR/MISSING-DATA.txt"
fi

if [[ -f "${HOME}/Library/Logs/Jobbot-launcher.log" ]]; then
  tail -n 200 "${HOME}/Library/Logs/Jobbot-launcher.log" \
    > "$OUT_DIR/Library-Logs/Jobbot-launcher.tail200.log"
  echo "✓ Jobbot-launcher.log (200 שורות אחרונות)"
fi

for f in "${HOME}/Library/Logs"/Jobbot*.log "${HOME}/Library/Logs"/jobbot*.log; do
  [[ -f "$f" ]] || continue
  base=$(basename "$f")
  [[ "$base" == "Jobbot-launcher.log" ]] && continue
  tail -n 200 "$f" > "$OUT_DIR/Library-Logs/${base}.tail200.log" || true
done

ls -lt "${HOME}/Library/Logs/DiagnosticReports/" 2>/dev/null \
  | grep -iE 'Jobbot|Electron|הפעל' \
  | head -20 > "$OUT_DIR/DiagnosticReports/NAMES.txt" 2>/dev/null \
  || echo "(none)" > "$OUT_DIR/DiagnosticReports/NAMES.txt"

{
  echo "created=$STAMP"
  echo "note=ייצוא קל — בלי פרופיל דפדפן"
  uname -a 2>/dev/null || true
  sw_vers 2>/dev/null || true
  node -v 2>/dev/null || echo "node=missing"
  npm -v 2>/dev/null || true
  if [[ -d "${HOME}/Desktop/Jobbot-src/.git" ]]; then
    echo "src=${HOME}/Desktop/Jobbot-src"
    git -C "${HOME}/Desktop/Jobbot-src" rev-parse HEAD 2>/dev/null || true
    git -C "${HOME}/Desktop/Jobbot-src" branch --show-current 2>/dev/null || true
    git -C "${HOME}/Desktop/Jobbot-src" log -1 --oneline 2>/dev/null || true
  fi
  if [[ -f "${HOME}/Desktop/Jobbot-src/jobbot/package.json" ]]; then
    echo "--- package.json (head) ---"
    head -20 "${HOME}/Desktop/Jobbot-src/jobbot/package.json"
  fi
} > "$OUT_DIR/meta/SYSTEM.txt"

cd "$(dirname "$OUT_DIR")"
rm -f "$OUT_ZIP"
zip -r -q "$OUT_ZIP" "$(basename "$OUT_DIR")"
rm -rf "$OUT_DIR"

SIZE=$(wc -c < "$OUT_ZIP" | tr -d ' ')
echo ""
echo "✅ מוכן לשליחה — ייצוא קל (בלי פרופיל דפדפן):"
echo "   $OUT_ZIP"
echo "   גודל: ${SIZE} בתים"
if [[ "$SIZE" -gt 5242880 ]]; then
  echo "⚠ עדיין מעל 5MB — שלח ידנית את runs/latest.json"
fi
echo ""

if command -v osascript >/dev/null 2>&1; then
  osascript -e "display dialog \"ייצוא קל מוכן (בלי פרופיל דפדפן):\\n$OUT_ZIP\\n(${SIZE} בתים)\" buttons {\"OK\"} default button 1 with title \"Jobbot\"" >/dev/null 2>&1 || true
  open -R "$OUT_ZIP" 2>/dev/null || true
fi
if [[ -t 0 ]]; then
  read -r -p "לחץ Enter לסגירה… " _ || true
fi
