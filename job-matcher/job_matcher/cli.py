from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

os.environ.setdefault("TK_SILENCE_DEPRECATION", "1")

from job_matcher.cv_parser import CvReadError
from job_matcher.pipeline import run_match


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Local desktop job matcher. Compares a CV to public job postings."
    )
    parser.add_argument("--url", help="Job board URL (http or https)")
    parser.add_argument("--html", type=Path, help="Local HTML fixture or saved listing page")
    parser.add_argument("--cv", type=Path, help="CV file: PDF, DOCX, or TXT")
    parser.add_argument("--threshold", type=float, default=50, help="Minimum match percent (default 50)")
    parser.add_argument("--out", type=Path, default=Path("reports"), help="Folder for Markdown and HTML reports")
    parser.add_argument("--gui", action="store_true", help="Open the desktop window")
    args = parser.parse_args(argv)

    has_source = args.html is not None or bool(args.url)
    if args.gui or not has_source:
        if has_source and args.cv is None and not args.gui:
            parser.error("Headless mode needs --cv")
        if args.cv and not has_source and not args.gui:
            parser.error("Headless mode needs --url or --html")
        return _launch_gui()
    if args.cv is None:
        parser.error("Headless mode needs --cv")
    try:
        result = run_match(
            url=args.url,
            html_file=args.html,
            cv_path=args.cv,
            threshold=args.threshold,
            out_dir=args.out,
            progress=lambda message: print(message, flush=True),
        )
    except CvReadError as exc:
        print(exc, file=sys.stderr)
        return 1
    except ValueError as exc:
        print(exc, file=sys.stderr)
        return 1

    print(f"סף: {result.threshold}%")
    if result.errors:
        for error in result.errors:
            print(error)
    included = result.included_jobs()
    if not included:
        print("אין משרות מעל הסף.")
    for job in included:
        print(f"{job.match_percent}%  {job.job.title}  {job.job.url}")
    print(f"Markdown: {result.markdown_path}")
    print(f"HTML: {result.html_path}")
    return 0


def _launch_gui() -> int:
    try:
        import tkinter  # noqa: F401
    except ImportError:
        print(
            "Tkinter חסר, ולכן אי אפשר לפתוח את החלון.\n"
            "On a Mac, install Python from https://www.python.org/downloads/macos/ (it includes Tk),\n"
            "or run: brew install python-tk",
            file=sys.stderr,
        )
        return 1
    from job_matcher.gui import run_gui

    run_gui()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
