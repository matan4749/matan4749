#!/bin/bash
# Join Jobbot Mac — PRIMARY installer (Terminal .command is more reliable than unsigned .app)
# Double-click OR: right-click → Open → Open. If blocked: chmod +x then open again.

export PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# Hebrew/newlines-safe dialog via temp UTF-8 file (never silent fail of the whole script)
say_he() {
  local msg="$1"
  local tmp
  tmp="$(/usr/bin/mktemp /tmp/jobbot-join-XXXX.txt 2>/dev/null || echo /tmp/jobbot-join-msg.txt)"
  printf '%s' "$msg" > "$tmp"
  /usr/bin/osascript <<OSA 2>/dev/null || /usr/bin/osascript -e 'display dialog "Jobbot Join רץ — ראה חלון הטרמינל" buttons {"אישור"} default button 1' 2>/dev/null || true
set f to POSIX file "$tmp"
set t to read f as «class utf8»
display dialog t buttons {"אישור"} default button 1 with title "Jobbot Join"
OSA
  /bin/rm -f "$tmp"
}

# ALWAYS show something immediately — never silent
say_he "מתחיל… מחפש את קבצי Jobbot-…tar.gz.part על ה-Desktop / Downloads"

# Drop Gatekeeper quarantine on this script when possible
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
/usr/bin/xattr -dr com.apple.quarantine "$0" 2>/dev/null || true
/usr/bin/xattr -dr com.apple.quarantine "$SCRIPT_DIR" 2>/dev/null || true

cd "$SCRIPT_DIR" || true

TGZ0="Jobbot-0.1.0-mac-arm64.tar.gz.part00"
TGZ1="Jobbot-0.1.0-mac-arm64.tar.gz.part01"
TGZ2="Jobbot-0.1.0-mac-arm64.tar.gz.part02"
ZIP0="Jobbot-0.1.0-mac-arm64.zip.part00"
ZIP1="Jobbot-0.1.0-mac-arm64.zip.part01"
ZIP2="Jobbot-0.1.0-mac-arm64.zip.part02"
OUT_TGZ="Jobbot-mac.tar.gz"
TAR_HINT="cd ~/Desktop/Jobbot && cat Jobbot-0.1.0-mac-arm64.tar.gz.part00 Jobbot-0.1.0-mac-arm64.tar.gz.part01 Jobbot-0.1.0-mac-arm64.tar.gz.part02 > Jobbot-mac.tar.gz && tar -tzf Jobbot-mac.tar.gz && tar -xzf Jobbot-mac.tar.gz && open -R Jobbot.app"

find_dir() {
  local mode="$1"
  local d
  for d in "$SCRIPT_DIR" "$PWD" "$HOME/Desktop/Jobbot" "$HOME/Desktop" "$HOME/Downloads/Jobbot" "$HOME/Downloads" "$HOME/שולחן העבודה" "$HOME/הורדות"; do
    [[ -d "$d" ]] || continue
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
  say_he "לא נמצאו קבצי .tar.gz.part

שים בתיקייה אחת (למשל Desktop/Jobbot):
• $TGZ0
• $TGZ1
• $TGZ2

ואז הרץ שוב את Join-Jobbot-Mac.command
(לחיצה ימנית ← פתח)

או Terminal:
$TAR_HINT"
  echo "$TAR_HINT"
  read -r -p "Enter לסגירה…" || true
  exit 1
fi

cd "$DIR" || exit 1
say_he "נמצאו חלקים ב:
$DIR
סוג: $KIND

מחבר ומחלץ Jobbot.app…"

set +e
if [[ "$KIND" == tar ]]; then
  /bin/rm -f "$OUT_TGZ" Jobbot-mac.zip
  /bin/cat "$TGZ0" "$TGZ1" "$TGZ2" > "$OUT_TGZ"
  MAGIC="$(/bin/dd if="$OUT_TGZ" bs=2 count=1 2>/dev/null | /usr/bin/od -An -tx1 | /usr/bin/tr -d ' \n')"
  if [[ "$MAGIC" != "1f8b" ]]; then
    say_he "הקובץ פגום (לא gzip).
מחק .part ישנים והורד שוב מאותו ביילד.

$TAR_HINT"
    read -r -p "Enter…" || true
    exit 1
  fi
  if ! /usr/bin/tar -tzf "$OUT_TGZ" >/tmp/jobbot-tar-t.log 2>&1; then
    say_he "בדיקת tar נכשלה — הורד שוב את שלושת החלקים.

$TAR_HINT"
    read -r -p "Enter…" || true
    exit 1
  fi
  /bin/rm -rf Jobbot.app
  /usr/bin/tar -xzf "$OUT_TGZ"
else
  say_he "משתמש ב-.zip.part ישן — עדיף .tar.gz.part"
  /bin/rm -f Jobbot-mac.zip
  /bin/cat "$ZIP0" "$ZIP1" "$ZIP2" > Jobbot-mac.zip
  /usr/bin/unzip -t Jobbot-mac.zip >/tmp/jobbot-unzip-t.log 2>&1
  /bin/rm -rf Jobbot.app
  /usr/bin/unzip -o -q Jobbot-mac.zip
fi

if [[ ! -d "$DIR/Jobbot.app" ]]; then
  say_he "חילוץ נכשל — אין Jobbot.app.

$TAR_HINT"
  read -r -p "Enter…" || true
  exit 1
fi

/usr/bin/xattr -dr com.apple.quarantine "$DIR/Jobbot.app" 2>/dev/null || true
/usr/bin/open -R "$DIR/Jobbot.app" 2>/dev/null || true

say_he "✅ Jobbot.app מוכן!

$DIR/Jobbot.app

⚠️ אל תלחץ פעמיים על Jobbot-mac.tar.gz
רק על Jobbot.app — לחיצה ימנית ← פתח אם macOS חוסם."

echo "OK: $DIR/Jobbot.app"
read -r -p "הצלחה. Enter לסגירה…" || true
exit 0
