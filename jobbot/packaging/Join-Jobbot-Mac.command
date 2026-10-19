#!/bin/bash
# Join Jobbot Mac zip parts — verify integrity, then unzip (bypasses Archive Utility Error 94)
set -euo pipefail
cd "$(dirname "$0")" || true
PART0="Jobbot-0.1.0-mac-arm64.zip.part00"
PART1="Jobbot-0.1.0-mac-arm64.zip.part01"
PART2="Jobbot-0.1.0-mac-arm64.zip.part02"
OUT="Jobbot-mac.zip"
HE_CORRUPT="הקובץ פגום אחרי חיבור החלקים. מחק את Jobbot-mac.zip ואת שלושת ה-.part הישנים, הורד שוב את שלושת החלקים מאותו ביילד, ונסה שוב."

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
  echo "לא נמצאו שלושת קבצי .part — שים אותם בתיקייה אחת (Downloads/Desktop) עם הסקריפט."
  read -r -p "Enter לסגירה…" || true
  exit 1
fi

cd "$DIR"
rm -f "$OUT"
echo "מחבר חלקים…"
cat "$PART0" "$PART1" "$PART2" > "$OUT"

# Magic PK\x03\x04
MAGIC="$(dd if="$OUT" bs=4 count=1 2>/dev/null | od -An -tx1 | tr -d ' \n')"
if [[ "$MAGIC" != "504b0304" ]]; then
  echo "$HE_CORRUPT"
  echo "(magic=$MAGIC — לא נראה כ־zip תקין)"
  rm -f "$OUT"
  read -r -p "Enter לסגירה…" || true
  exit 1
fi

if ! /usr/bin/unzip -t "$OUT" >/tmp/jobbot-unzip-t.log 2>&1; then
  echo "$HE_CORRUPT"
  echo "—— פירוט ——"; tail -20 /tmp/jobbot-unzip-t.log || true
  rm -f "$OUT"
  read -r -p "Enter לסגירה…" || true
  exit 1
fi

echo "ה־zip תקין (unzip -t עבר). מחלץ עם unzip…"
rm -rf Jobbot.app
/usr/bin/unzip -o -q "$OUT"
if [[ -d Jobbot.app ]]; then
  echo "מוכן: $DIR/Jobbot.app"
  echo "אם macOS חוסם: לחיצה ימנית על Jobbot.app ← פתח"
  open -R "$DIR/Jobbot.app" 2>/dev/null || true
else
  echo "החילוץ הצליח חלקית — נסה לחיצה כפולה על $OUT או: unzip $OUT"
  open -R "$DIR/$OUT" 2>/dev/null || true
fi
read -r -p "הצלחה. Enter לסגירה…" || true
