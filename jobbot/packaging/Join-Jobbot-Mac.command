#!/bin/bash
# Prefer .tar.gz.part → Jobbot-mac.tar.gz → tar extract. Fallback: legacy zip.part.
set -euo pipefail
cd "$(dirname "$0")" || true

TGZ0="Jobbot-0.1.0-mac-arm64.tar.gz.part00"
TGZ1="Jobbot-0.1.0-mac-arm64.tar.gz.part01"
TGZ2="Jobbot-0.1.0-mac-arm64.tar.gz.part02"
ZIP0="Jobbot-0.1.0-mac-arm64.zip.part00"
ZIP1="Jobbot-0.1.0-mac-arm64.zip.part01"
ZIP2="Jobbot-0.1.0-mac-arm64.zip.part02"
OUT_TGZ="Jobbot-mac.tar.gz"
HE_CORRUPT="הקובץ פגום. מחק ארכיונים ו-.part ישנים, הורד שוב את שלושת .tar.gz.part מאותו ביילד."
TAR_HINT="cd ~/Desktop/Jobbot && cat Jobbot-0.1.0-mac-arm64.tar.gz.part00 Jobbot-0.1.0-mac-arm64.tar.gz.part01 Jobbot-0.1.0-mac-arm64.tar.gz.part02 > Jobbot-mac.tar.gz && tar -tzf Jobbot-mac.tar.gz && tar -xzf Jobbot-mac.tar.gz && open -R Jobbot.app"

find_dir() {
  local mode="$1" # tar|zip
  for d in "$PWD" "$HOME/Downloads" "$HOME/Desktop" "$HOME/Downloads/Jobbot" "$HOME/Desktop/Jobbot"; do
    if [[ "$mode" == tar ]]; then
      if [[ -f "$d/$TGZ0" && -f "$d/$TGZ1" && -f "$d/$TGZ2" ]]; then echo "$d"; return 0; fi
    else
      if [[ -f "$d/$ZIP0" && -f "$d/$ZIP1" && -f "$d/$ZIP2" ]]; then echo "$d"; return 0; fi
    fi
  done
  return 1
}

DIR="$(find_dir tar || true)"
KIND=tar
if [[ -z "${DIR:-}" ]]; then
  DIR="$(find_dir zip || true)"
  KIND=zip
fi

if [[ -z "${DIR:-}" ]]; then
  echo "לא נמצאו Jobbot-…tar.gz.part00/01/02"
  echo "שים אותם ב-Desktop/Jobbot (לא .zip.part אלא אם אין tar.gz)."
  echo ""
  echo "Terminal:"
  echo "$TAR_HINT"
  read -r -p "Enter לסגירה…" || true
  exit 1
fi

cd "$DIR"
echo "נמצא ב: $DIR (מצב: $KIND)"

if [[ "$KIND" == tar ]]; then
  rm -f "$OUT_TGZ" Jobbot-mac.zip
  echo "מחבר .tar.gz.part…"
  cat "$TGZ0" "$TGZ1" "$TGZ2" > "$OUT_TGZ"
  MAGIC="$(dd if="$OUT_TGZ" bs=2 count=1 2>/dev/null | od -An -tx1 | tr -d ' \n')"
  if [[ "$MAGIC" != "1f8b" ]]; then
    echo "$HE_CORRUPT"; echo "$TAR_HINT"; rm -f "$OUT_TGZ"
    read -r -p "Enter…" || true; exit 1
  fi
  if ! /usr/bin/tar -tzf "$OUT_TGZ" >/tmp/jobbot-tar-t.log 2>&1; then
    echo "$HE_CORRUPT"; tail -10 /tmp/jobbot-tar-t.log || true; echo "$TAR_HINT"
    rm -f "$OUT_TGZ"; read -r -p "Enter…" || true; exit 1
  fi
  rm -rf Jobbot.app
  /usr/bin/tar -xzf "$OUT_TGZ"
else
  echo "אזהרה: משתמש ב-.zip.part ישן — עדיף .tar.gz.part"
  rm -f Jobbot-mac.zip
  cat "$ZIP0" "$ZIP1" "$ZIP2" > Jobbot-mac.zip
  /usr/bin/unzip -t Jobbot-mac.zip
  rm -rf Jobbot.app
  /usr/bin/unzip -o -q Jobbot-mac.zip
fi

if [[ ! -d Jobbot.app ]]; then
  echo "חילוץ נכשל. $HE_CORRUPT"
  echo "$TAR_HINT"
  read -r -p "Enter…" || true
  exit 1
fi

echo "=========================================="
echo "  מוכן: $DIR/Jobbot.app"
echo "  אסור ללחוץ פעמיים על הארכיון — רק Jobbot.app"
echo "=========================================="
open -R "$DIR/Jobbot.app" 2>/dev/null || true
read -r -p "הצלחה. Enter לסגירה…" || true
