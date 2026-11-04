from __future__ import annotations

import json
import re
from pathlib import Path

from job_matcher.cv_parser import CvReadError, parse_cv
from job_matcher.report import format_job_plain

STATE_PATH = Path.home() / ".job-matcher" / "state.json"


def default_out_dir() -> Path:
    documents = Path.home() / "Documents"
    base = documents if documents.is_dir() else Path.home()
    return base / "job-matcher-reports"


def cv_preview_text(path: str) -> str:
    path = (path or "").strip()
    file = Path(path) if path else None
    if file is None or not file.is_file():
        return "לא נבחר קובץ."
    kind = {".pdf": "PDF", ".docx": "DOCX", ".txt": "TXT"}.get(file.suffix.lower(), "FILE")
    if file.suffix.lower() not in {".pdf", ".docx", ".txt"}:
        return f"{file.name}  ·  {kind}\nבחרו קובץ PDF, DOCX או TXT."
    try:
        profile = parse_cv(file)
    except CvReadError as exc:
        return f"{file.name}  ·  {kind}\n{exc}"
    excerpt = re.sub(r"\s+", " ", profile.text).strip()[:420]
    return f"{file.name}  ·  {kind}\n{excerpt}"


def result_lines(result) -> list[str]:
    lines = []
    for scored in result.included_jobs():
        job = scored.job
        company = job.company or "—"
        location = job.location or ""
        lines.append(f"{scored.match_percent}%   {job.title}   {company}   {location}")
    return lines


def status_text(result) -> str:
    visible = result.included_jobs()
    below = len(result.below_threshold())
    unscored = len(result.unscored())
    if result.errors and not visible:
        return "השליפה נעצרה. הפירוט בפרטי המשרה."
    if not visible:
        return f"אין משרות מעל {result.threshold}%. מתחת לסף: {below}. בלי ציון: {unscored}."
    return (
        f"{len(visible)} משרות מעל {result.threshold}%, "
        f"לפי אחוז. מתחת לסף: {below}. בלי ציון: {unscored}."
    )


def detail_text(result, index: int) -> str:
    visible = result.included_jobs()
    if 0 <= index < len(visible):
        return format_job_plain(visible[index])
    if result.errors or result.notes:
        return "\n".join([*result.errors, *result.notes])
    return ""


def jobs_found_label(count: int) -> str:
    return f"נמצאו {int(count)}"


def watch_view(event: dict) -> dict:
    url = str(event.get("url") or "")
    if len(url) > 110:
        url = url[:107] + "…"
    snippet = re.sub(r"\s+", " ", str(event.get("snippet") or "")).strip()
    jobs = event.get("jobs")
    fraction = event.get("fraction")
    if fraction is not None:
        fraction = max(0.0, min(1.0, float(fraction)))
    return {
        "url": url,
        "snippet": snippet,
        "jobs": None if jobs is None else int(jobs),
        "fraction": fraction,
    }


def load_state(path: Path | None = None) -> dict:
    file = path or STATE_PATH
    try:
        data = json.loads(file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def save_state(data: dict, path: Path | None = None) -> None:
    file = path or STATE_PATH
    try:
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        return


def layout_frames(width: float) -> tuple[dict[str, tuple[float, float, float, float]], float]:
    """Top-level frames for the macOS window, in AppKit coordinates (origin at the bottom)."""
    width = float(width)
    if width < 640:
        width = 640
    margin = 20.0
    gap = 10.0
    pad = 12.0
    inner = width - margin * 2
    y = 16.0
    frames: dict[str, tuple[float, float, float, float]] = {}

    def add(name: str, height: float, x: float | None = None, w: float | None = None) -> None:
        frames[name] = (margin if x is None else x, y, inner if w is None else w, height)

    def advance(height: float) -> None:
        nonlocal y
        y += height

    add("title", 32)
    advance(36)
    add("subtitle", 22)
    advance(30)

    card_top = y
    y += pad
    add("url_label", 22, margin + pad, inner - 2 * pad)
    advance(24)
    add("url_hint", 18, margin + pad, inner - 2 * pad)
    advance(22)
    add("url_field", 42, margin + pad, inner - 2 * pad)
    advance(42 + pad)
    frames["url_card"] = (margin, card_top, inner, y - card_top)
    advance(gap)

    card_top = y
    y += pad
    add("cv_label", 22, margin + pad, inner - 2 * pad)
    advance(26)
    button_w = 96.0
    field_w = inner - 2 * pad - button_w - 8
    add("cv_field", 34, margin + pad, field_w)
    add("cv_button", 34, margin + pad + field_w + 8, button_w)
    advance(42)
    add("preview_label", 18, margin + pad, inner - 2 * pad)
    advance(20)
    add("preview", 76, margin + pad, inner - 2 * pad)
    advance(76 + pad)
    frames["cv_card"] = (margin, card_top, inner, y - card_top)
    advance(gap)

    threshold_label_w = 118.0
    threshold_field_w = 58.0
    out_label_w = 96.0
    out_button_w = 96.0
    add("threshold_label", 34, margin, threshold_label_w)
    add("threshold_field", 34, margin + threshold_label_w, threshold_field_w)
    out_x = margin + threshold_label_w + threshold_field_w + 12
    add("out_label", 34, out_x, out_label_w)
    out_field_x = out_x + out_label_w
    out_field_w = max(80.0, inner - (out_field_x - margin) - out_button_w - 8)
    add("out_field", 34, out_field_x, out_field_w)
    add("out_button", 34, margin + inner - out_button_w, out_button_w)
    advance(34 + gap)

    cursor = margin + inner
    for name, button_width in (("run", 156.0), ("open_report", 128.0), ("open_job", 128.0), ("clear", 78.0)):
        cursor -= button_width
        add(name, 34, cursor, button_width)
        cursor -= 8
    advance(34 + gap)

    card_top = y
    y += pad
    elapsed_w = 64.0
    jobs_w = 120.0
    add("elapsed", 22, margin + inner - pad - elapsed_w, elapsed_w)
    add("jobs", 22, margin + inner - pad - elapsed_w - 10 - jobs_w, jobs_w)
    status_right = margin + inner - pad - elapsed_w - 10 - jobs_w - 8
    add("status", 22, margin + pad, max(40.0, status_right - (margin + pad)))
    advance(26)
    add("bar", 14, margin + pad, inner - 2 * pad)
    advance(14 + pad)
    frames["progress_card"] = (margin, card_top, inner, y - card_top)
    advance(gap)

    card_top = y
    y += pad
    add("live_label", 18, margin + pad, inner - 2 * pad)
    advance(20)
    add("live_url", 22, margin + pad, inner - 2 * pad)
    advance(26)
    add("live_snippet", 58, margin + pad, inner - 2 * pad)
    advance(58 + pad)
    frames["live_card"] = (margin, card_top, inner, y - card_top)
    advance(gap)

    col_gap = 12.0
    col_w = (inner - col_gap) / 2
    add("results_label", 22, margin, col_w)
    add("detail_label", 22, margin + col_w + col_gap, col_w)
    advance(24)
    add("results", 210, margin, col_w)
    add("detail", 210, margin + col_w + col_gap, col_w)
    advance(210 + gap)
    add("report", 40)
    advance(40 + 18)

    height = y
    flipped: dict[str, tuple[float, float, float, float]] = {}
    for name, (frame_x, frame_y, frame_w, frame_h) in frames.items():
        flipped[name] = (frame_x, height - frame_y - frame_h, frame_w, frame_h)
    return flipped, height
