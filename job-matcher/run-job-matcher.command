#!/bin/bash
# Double-click this file in Finder, or run it from Terminal, to open the local Mac app.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required. The Python that comes with macOS is enough."
  exit 1
fi

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
echo "Installing dependencies. The first launch installs PyObjC so the window can draw."
python3 -m pip install -q -r requirements.txt
if ! python3 -c "import Cocoa" >/dev/null 2>&1; then
  echo "AppKit did not load. The window needs PyObjC (pip install -r requirements.txt)."
  exit 1
fi
exec python3 -m job_matcher
