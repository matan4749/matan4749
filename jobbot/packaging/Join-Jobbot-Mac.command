#!/bin/bash
# Join Jobbot Mac .tar.gz parts → ALWAYS extract Jobbot.app (never open archive in Finder)
set -euo pipefail
cd "$(dirname "$0")" || true

PART0="Jobbot-0.1.0-mac-arm64.tar.gz.part00"
PART1="Jobbot-0.1.0-mac-arm64.tar.gz.part01"
PART2="Jobbot-0.1.0-mac-arm64.tar.gz.part02"
OUT="Jobbot-mac.tar.gz"
HE_CORRUPT="הקובץ פגום אחרי חיבור החלקים. מחק את Jobbot-mac.tar.gz / Jobbot-mac.zip ואת כל קבצי ה-.part הישנים (כולל .zip.part), הורד שוב את שלושת החלקים החדשים (.tar.gz.part) מאותו ביילד, ונסה שוב."
HE_NO_DBL="אסור ללחוץ פעמיים על הארכיון ב-Finder — Join כבר מחלץ את Jobbot.app."

find_dir() {
  for d in "$PWD" "$HOME/Downloads" "$HOME/Desktop" "$HOME/Downloads/Jobbot" "$HOME/Desktop/Jobbot"; do
    if [[ -f "$d/$PART0" && -f "$d/$PART1" && -f "$d/$PART2" ]]; then
      echo "$d"
      return 0
    fi
  done
  return 1
}

DIR="$(find_dir || true)"
if [[ -z "${DIR:-}" ]]; then
  echo "לא נמצאו שלושת הקבצים:"
  echo "  $PART0 / $PART1 / $PART2"
  echo "שים אותם בתיקייה אחת (Downloads או Desktop/Jobbot)."
  echo "אל תשתמש ב-.zip.part ישנים."
  read -r -p "Enter לסגירה…" || true
  exit 1
fi

cd "$DIR"
rm -f "$OUT" Jobbot-mac.zip
echo "מחבר חלקים → $OUT …"
cat "$PART0" "$PART1" "$PART2" > "$OUT"

MAGIC="$(dd if="$OUT" bs=2 count=1 2>/dev/null | od -An -tx1 | tr -d ' \n')"
if [[ "$MAGIC" != "1f8b" ]]; then
  echo "$HE_CORRUPT"
  echo "(magic=$MAGIC — לא gzip)"
  rm -f "$OUT"
  read -r -p "Enter לסגירה…" || true
  exit 1
fi

if ! /usr/bin/tar -tzf "$OUT" >/tmp/jobbot-tar-t.log 2>&1; then
  echo "$HE_CORRUPT"
  tail -20 /tmp/jobbot-tar-t.log || true
  rm -f "$OUT"
  read -r -p "Enter לסגירה…" || true
  exit 1
fi

echo "הארכיון תקין. מחלץ Jobbot.app…"
rm -rf Jobbot.app
/usr/bin/tar -xzf "$OUT"
if [[ ! -d Jobbot.app ]]; then
  echo "חילוץ נכשל — $HE_CORRUPT"
  read -r -p "Enter לסגירה…" || true
  exit 1
fi

echo ""
echo "=========================================="
echo "  מוכן: $DIR/Jobbot.app"
echo "  $HE_NO_DBL"
echo "  אם macOS חוסם: לחיצה ימנית על Jobbot.app ← פתח"
echo "=========================================="
open -R "$DIR/Jobbot.app" 2>/dev/null || true
read -r -p "הצלחה. Enter לסגירה…" || true
