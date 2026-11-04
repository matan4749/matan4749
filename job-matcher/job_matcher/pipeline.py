from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from job_matcher.cv_parser import CvReadError, parse_cv
from job_matcher.extract import Extraction, Fetcher, extract_jobs
from job_matcher.fetch import DirectoryFetcher, HttpFetcher
from job_matcher.models import RunResult
from job_matcher.report import write_reports
from job_matcher.score import score_job

Progress = Callable[[str], None]


def run_match(
    *,
    cv_path: Path,
    threshold: float,
    out_dir: Path,
    url: str | None = None,
    html_file: Path | None = None,
    progress: Progress | None = None,
    fetcher: Fetcher | None = None,
    watch: Callable[[dict], None] | None = None,
) -> RunResult:
    progress = progress or (lambda _message: None)
    if threshold < 0 or threshold > 100:
        raise ValueError("סף ההתאמה צריך להיות בין 0 ל-100.")
    threshold_int = int(float(threshold) + 0.5)
    progress("קורא את קורות החיים…")
    try:
        profile = parse_cv(Path(cv_path))
    except CvReadError:
        raise
    if html_file is not None and fetcher is None:
        html_path = Path(html_file).resolve()
        fetcher = DirectoryFetcher(html_path.parent)
        start_url = html_path.as_uri()
    elif fetcher is not None:
        if not url:
            raise ValueError("חסרה כתובת מקור לשליפה.")
        start_url = url
    else:
        start_url = validate_http_url(url or "")
        fetcher = HttpFetcher()

    extraction: Extraction = extract_jobs(fetcher, start_url, progress, watch=watch)
    progress("משווה דרישות לקורות החיים…")
    if watch:
        watch(
            {
                "url": start_url,
                "snippet": "משווה דרישות לקורות החיים",
                "pages": extraction.pages_fetched,
                "jobs": len(extraction.jobs),
                "phase": "score",
                "fraction": 0.96,
            }
        )
    scored = []
    for job in extraction.jobs:
        item = score_job(profile, job)
        if item.match_percent is not None:
            item.included = item.match_percent >= threshold_int
        scored.append(item)
    result = RunResult(
        source_url=start_url,
        cv_name=profile.path_name,
        threshold=threshold_int,
        generated_at=datetime.now(_local_zone()),
        profile=profile,
        jobs=scored,
        errors=list(extraction.errors),
        notes=list(extraction.notes),
        pages_fetched=extraction.pages_fetched,
    )
    progress("שומר דוח…")
    write_reports(result, Path(out_dir))
    return result


def _local_zone():
    try:
        return ZoneInfo("Asia/Jerusalem")
    except Exception:
        return timezone.utc


def validate_http_url(url: str) -> str:
    cleaned = (url or "").strip()
    parsed = urlparse(cleaned)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("יש להזין כתובת http או https של לוח משרות.")
    return cleaned
