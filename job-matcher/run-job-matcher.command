#!/bin/bash
# Double-click this file in Finder, or run it from Terminal, to open the local app.
set -euo pipefail
cd "$(dirname "$0")"
# Apple's system Tk prints a deprecation warning. The app still uses that Tk.
export TK_SILENCE_DEPRECATION=1

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required."
  echo "Install it from https://www.python.org/downloads/macos/ (includes Tk)."
  exit 1
fi

if ! python3 -c "import tkinter" >/dev/null 2>&1; then
  echo "Tkinter is missing, so the window cannot open."
  echo "Install Python from https://www.python.org/downloads/macos/"
  echo "or run: brew install python-tk"
  exit 1
fi

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
python3 -m pip install -q -r requirements.txt
exec python3 -m job_matcher
