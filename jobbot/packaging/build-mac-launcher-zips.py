#!/usr/bin/env python3
"""Build הפעל-Jobbot.command.zip + הפעל-Jobbot.app.zip with Unix 755 modes."""
from __future__ import annotations

import os
import stat
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO_JOBBOT = ROOT.parent
# Prefer explicit media out; default beside packaging for CI, or env
MEDIA = Path(os.environ.get("JOBBOT_MEDIA_OUT", "/cursor/stores/self/media"))

REPO_URL = "https://github.com/matan4749/matan4749.git"
BRANCH = "cursor/jobbot-desktop-app-4bd4"
APP_DIR = '${HOME}/Desktop/Jobbot-src'

RUN_LOGIC = r'''#!/bin/bash
# Shared Jobbot update+start (sourced/called by .command and .app)
set -euo pipefail
REPO_URL="https://github.com/matan4749/matan4749.git"
BRANCH="cursor/jobbot-desktop-app-4bd4"
APP_DIR="${HOME}/Desktop/Jobbot-src"
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:$PATH"

say() { echo "$*"; }
die() {
  say "❌ $*"
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "display dialog \"$*\" buttons {\"OK\"} default button 1 with title \"Jobbot\"" >/dev/null 2>&1 || true
  fi
  exit 1
}

if ! command -v node >/dev/null 2>&1; then
  die "לא נמצא Node.js — התקן מ־https://nodejs.org (LTS) והרץ שוב."
fi
if ! command -v git >/dev/null 2>&1; then
  die "לא נמצא git — הרץ: xcode-select --install"
fi

say "Node $(node -v) · $APP_DIR"

if [[ ! -d "$APP_DIR/.git" ]]; then
  say "מוריד את Jobbot לראשונה…"
  mkdir -p "$(dirname "$APP_DIR")"
  rm -rf "$APP_DIR"
  git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$APP_DIR" \
    || die "השכפול נכשל (ריפו פרטי?). בטרמינל: gh auth login"
else
  say "מעדכן…"
  cd "$APP_DIR"
  git fetch origin "$BRANCH" || git fetch origin
  git checkout "$BRANCH"
  git pull --ff-only origin "$BRANCH" || git pull --ff-only
fi

cd "$APP_DIR/jobbot"
say "מתקין תלויות…"
npm install
say "בונה…"
npm run build
say "מפעיל…"
npm start
'''

COMMAND = f'''#!/bin/bash
# Jobbot — עדכון והפעלה בלחיצה אחת
# קליק ימני → פתח
set -euo pipefail
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
echo ""
echo "══════════════════════════════════════"
echo "  Jobbot — מעדכן… מפעיל…"
echo "══════════════════════════════════════"
echo ""
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Prefer embedded runner next to us inside .app Resources; else inline
if [[ -f "$SCRIPT_DIR/../Resources/jobbot-run.sh" ]]; then
  exec bash "$SCRIPT_DIR/../Resources/jobbot-run.sh"
fi
# Standalone .command — run inline copy
bash -s <<'JOBBOT_EOF'
{RUN_LOGIC}
JOBBOT_EOF
'''

# For standalone .command, embed logic directly (clearer than heredoc nesting)
STANDALONE_COMMAND = '''#!/bin/bash
# Jobbot — עדכון והפעלה בלחיצה אחת (Mac)
# קליק ימני → פתח   |   אחרי כל עדכון — אותה לחיצה שוב
set -euo pipefail

REPO_URL="https://github.com/matan4749/matan4749.git"
BRANCH="cursor/jobbot-desktop-app-4bd4"
APP_DIR="${HOME}/Desktop/Jobbot-src"
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:$PATH"

echo ""
echo "══════════════════════════════════════"
echo "  Jobbot — מעדכן… מפעיל…"
echo "══════════════════════════════════════"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "❌ לא נמצא Node.js — התקן מ־https://nodejs.org (LTS)"
  read -r -p "לחץ Enter לסגירה… " _
  exit 1
fi
if ! command -v git >/dev/null 2>&1; then
  echo "❌ לא נמצא git — xcode-select --install"
  read -r -p "לחץ Enter לסגירה… " _
  exit 1
fi

echo "Node $(node -v) · תיקייה: $APP_DIR"
echo ""

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "מוריד את Jobbot לראשונה (פעם אחת)…"
  mkdir -p "$(dirname "$APP_DIR")"
  rm -rf "$APP_DIR"
  if ! git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$APP_DIR"; then
    echo "❌ השכפול נכשל. נסה: gh auth login"
    read -r -p "לחץ Enter לסגירה… " _
    exit 1
  fi
else
  echo "מעדכן מהענף האחרון…"
  cd "$APP_DIR"
  git fetch origin "$BRANCH" || git fetch origin
  git checkout "$BRANCH"
  git pull --ff-only origin "$BRANCH" || git pull --ff-only
fi

cd "$APP_DIR/jobbot"
echo ""
echo "מתקין תלויות (פעם ראשונה יכול לקחת כמה דקות)…"
npm install
echo ""
echo "בונה…"
npm run build
echo ""
echo "מפעיל את Jobbot…"
npm start
'''

APP_LAUNCHER = '''#!/bin/bash
# CFBundleExecutable for הפעל-Jobbot.app
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
DIR="$(cd "$(dirname "$0")" && pwd)"
RESOURCES="$(cd "$DIR/../Resources" && pwd)"

# Immediate Hebrew dialog (non-blocking give-up)
osascript <<'OSA' >/dev/null 2>&1 &
display dialog "מעדכן… מפעיל…" buttons {"OK"} default button 1 giving up after 2 with title "Jobbot"
OSA

LOG="$HOME/Library/Logs/Jobbot-launcher.log"
mkdir -p "$(dirname "$LOG")"
{
  echo "==== $(date) ===="
  bash "$RESOURCES/jobbot-run.sh"
  ec=$?
  echo "exit=$ec"
  if [[ $ec -ne 0 ]]; then
    osascript -e "display dialog \"Jobbot נכשל (קוד $ec). בדוק את הלוג:\\n$LOG\" buttons {\"OK\"} default button 1 with title \"Jobbot\"" >/dev/null 2>&1 || true
  fi
  exit $ec
} 2>&1 | tee -a "$LOG"
'''

INFO_PLIST = '''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>הפעל-Jobbot</string>
  <key>CFBundleDisplayName</key><string>הפעל Jobbot</string>
  <key>CFBundleIdentifier</key><string>life.matan.jobbot.launcher</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSUIElement</key><false/>
</dict>
</plist>
'''


def unix_zipinfo(name: str, data: bytes, mode: int = 0o644) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.create_system = 3  # Unix
    # high 16 bits = Unix mode
    info.external_attr = (stat.S_IFREG | mode) << 16
    info.date_time = (2026, 10, 19, 12, 0, 0)
    return info


def write_zip(path: Path, files: dict[str, tuple[bytes, int]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.unlink()
    with zipfile.ZipFile(path, "w") as zf:
        for name, (data, mode) in files.items():
            zf.writestr(unix_zipinfo(name, data, mode), data)
    print(f"wrote {path} ({path.stat().st_size} bytes) entries={list(files)}")


def main() -> None:
    MEDIA.mkdir(parents=True, exist_ok=True)
    cmd_bytes = STANDALONE_COMMAND.encode("utf-8")
    run_bytes = RUN_LOGIC.encode("utf-8")
    launcher_bytes = APP_LAUNCHER.encode("utf-8")
    plist_bytes = INFO_PLIST.encode("utf-8")

    # 1) .command with 755 inside zip
    write_zip(
        MEDIA / "הפעל-Jobbot.command.zip",
        {"הפעל-Jobbot.command": (cmd_bytes, 0o755)},
    )
    write_zip(
        MEDIA / "עדכן-והפעל-Jobbot.command.zip",
        {"עדכן-והפעל-Jobbot.command": (cmd_bytes, 0o755)},
    )
    write_zip(
        MEDIA / "Run-Jobbot.command.zip",
        {"Run-Jobbot.command": (cmd_bytes, 0o755)},
    )

    # Loose copies (store may force 644; zip is authoritative)
    for name in ("הפעל-Jobbot.command", "עדכן-והפעל-Jobbot.command", "Run-Jobbot.command"):
        p = MEDIA / name
        p.write_bytes(cmd_bytes)
        try:
            p.chmod(0o755)
        except OSError:
            pass

    # 2) .app bundle zip — double-click / right-click Open, no chmod
    app_prefix = "הפעל-Jobbot.app"
    write_zip(
        MEDIA / "הפעל-Jobbot.app.zip",
        {
            f"{app_prefix}/Contents/Info.plist": (plist_bytes, 0o644),
            f"{app_prefix}/Contents/MacOS/launcher": (launcher_bytes, 0o755),
            f"{app_prefix}/Contents/Resources/jobbot-run.sh": (run_bytes, 0o755),
            f"{app_prefix}/Contents/PkgInfo": (b"APPL????", 0o644),
        },
    )

    # Also English-named app zip for download UIs that mangle Hebrew
    write_zip(
        MEDIA / "Launch-Jobbot.app.zip",
        {
            "Launch-Jobbot.app/Contents/Info.plist": (
                INFO_PLIST.replace("הפעל-Jobbot", "Launch-Jobbot")
                .replace("הפעל Jobbot", "Launch Jobbot")
                .encode("utf-8"),
                0o644,
            ),
            "Launch-Jobbot.app/Contents/MacOS/launcher": (launcher_bytes, 0o755),
            "Launch-Jobbot.app/Contents/Resources/jobbot-run.sh": (run_bytes, 0o755),
            "Launch-Jobbot.app/Contents/PkgInfo": (b"APPL????", 0o644),
        },
    )

    # Sync into packaging/ for the git repo
    (ROOT / "הפעל-Jobbot.command").write_bytes(cmd_bytes)
    try:
        (ROOT / "הפעל-Jobbot.command").chmod(0o755)
    except OSError:
        pass
    (ROOT / "Run-Jobbot.command").write_bytes(cmd_bytes)
    try:
        (ROOT / "Run-Jobbot.command").chmod(0o755)
    except OSError:
        pass

    print("OK media=", MEDIA)


if __name__ == "__main__":
    main()
