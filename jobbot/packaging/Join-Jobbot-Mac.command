#!/bin/bash
# Fallback: Right-click → Open (or Open With → Terminal)
# Joins Jobbot Mac zip parts from Downloads / Desktop / this folder
cd "$(dirname "$0")" || true
PART0="Jobbot-0.1.0-mac-arm64.zip.part00"
PART1="Jobbot-0.1.0-mac-arm64.zip.part01"
PART2="Jobbot-0.1.0-mac-arm64.zip.part02"
OUT="Jobbot-mac.zip"

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
  echo "לא נמצאו קבצי .part — העבר אותם לתיקייה עם הסקריפט או הרץ:"
  echo "cat $PART0 $PART1 $PART2 > $OUT"
  read -r -p "Enter לסגירה…"
  exit 1
fi

cd "$DIR"
rm -f "$OUT"
cat "$PART0" "$PART1" "$PART2" > "$OUT"
echo "נוצר: $DIR/$OUT"
open -R "$DIR/$OUT" 2>/dev/null || true
read -r -p "הצלחה. Enter לסגירה…"
