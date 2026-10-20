#!/bin/bash
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
