from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlparse

import requests
from bs4 import BeautifulSoup

MAX_BYTES = 2_000_000
_BLOCK_MARKERS = (
    "just a moment",
    "cf-browser-verification",
    "attention required",
    "verify you are human",
    "g-recaptcha",
    "access denied",
    "request blocked",
    "enable javascript and cookies",
)


@dataclass
class FetchResult:
    url: str
    final_url: str
    status: int
    text: str
    content_type: str = ""
    error: str = ""
    blocked_reason: str = ""


class HttpFetcher:
    """Fetch public pages with one browser-like request. No bypass, no proxy."""

    def __init__(self, delay_seconds: float = 0.35) -> None:
        self.delay_seconds = delay_seconds
        self._last = 0.0
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
                ),
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "he,en;q=0.8",
            }
        )

    def fetch(self, url: str) -> FetchResult:
        elapsed = time.monotonic() - self._last
        if self._last and elapsed < self.delay_seconds:
            time.sleep(self.delay_seconds - elapsed)
        self._last = time.monotonic()
        try:
            response = self.session.get(url, timeout=(10, 25), allow_redirects=True, stream=True)
        except requests.RequestException as exc:
            return FetchResult(
                url=url,
                final_url=url,
                status=0,
                text="",
                error=f"שגיאת רשת: {exc.__class__.__name__}. Network error while fetching the page.",
            )
        chunks: list[bytes] = []
        size = 0
        try:
            for chunk in response.iter_content(chunk_size=65536):
                if not chunk:
                    continue
                size += len(chunk)
                if size > MAX_BYTES:
                    break
                chunks.append(chunk)
        finally:
            response.close()
        raw = b"".join(chunks)
        encoding = response.encoding
        if not encoding or encoding.lower() == "iso-8859-1":
            encoding = response.apparent_encoding or "utf-8"
        try:
            text = raw.decode(encoding, errors="replace")
        except LookupError:
            text = raw.decode("utf-8", errors="replace")
        result = FetchResult(
            url=url,
            final_url=response.url,
            status=response.status_code,
            text=text,
            content_type=response.headers.get("Content-Type", ""),
        )
        return interpret(result)


class DirectoryFetcher:
    """Read HTML fixtures from one folder. Refuses paths outside that folder."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def fetch(self, url: str) -> FetchResult:
        path = self._path_for(url)
        if path is None:
            return FetchResult(url=url, final_url=url, status=0, text="", error=f"נתיב לא תקין: {url}")
        try:
            path.relative_to(self.root)
        except ValueError:
            return FetchResult(
                url=url,
                final_url=url,
                status=0,
                text="",
                error="הקישור מחוץ לתיקיית המקור ולא נקרא.",
            )
        if not path.is_file():
            return FetchResult(
                url=url,
                final_url=path.as_uri(),
                status=0,
                text="",
                error=f"הקובץ לא נמצא: {path.name}",
            )
        text = path.read_text(encoding="utf-8")
        return FetchResult(
            url=url,
            final_url=path.as_uri(),
            status=200,
            text=text,
            content_type="text/html; charset=utf-8",
        )

    def _path_for(self, url: str) -> Path | None:
        if url.startswith("file://"):
            parsed = urlparse(url)
            return Path(unquote(parsed.path)).resolve()
        candidate = Path(url)
        if candidate.is_absolute():
            return candidate.resolve()
        return (self.root / url).resolve()


def interpret(result: FetchResult) -> FetchResult:
    if result.error or result.blocked_reason:
        return result
    reason = detect_block(result.status, result.text, result.content_type)
    if reason:
        result.blocked_reason = reason
    return result


def detect_block(status: int, html: str, content_type: str = "") -> str:
    if status in (401, 403):
        return (
            f"האתר סירב לבקשה (HTTP {status}). "
            "The site blocked the request or requires an account. לא הומצאו משרות."
        )
    if status == 429:
        return "האתר הגביל את הקצב (HTTP 429). לא הומצאו משרות."
    if status >= 400:
        return f"האתר החזיר שגיאה HTTP {status}. לא הומצאו משרות."
    if content_type and "html" not in content_type.lower() and "text" not in content_type.lower() and "xml" not in content_type.lower():
        if "pdf" in content_type.lower():
            return ""
        return ""
    visible = visible_text(html)
    sample = (visible + "\n" + html[:4000]).lower()
    if len(visible) < 700 and any(marker in sample for marker in _BLOCK_MARKERS):
        return (
            "העמוד נראה כחסימה (Cloudflare / captcha / access denied) ולא כלוח משרות. "
            "לא הומצאו משרות."
        )
    if _login_wall(html, visible):
        return "נראה שהעמוד דורש התחברות כדי להציג משרות. לא הומצאו משרות."
    return ""


def looks_like_js_shell(html: str) -> bool:
    low = (html or "").lower()
    # JSON-LD JobPosting is real content even when the visible HTML is thin.
    if "ld+json" in low and "jobposting" in low:
        return False
    visible = visible_text(html)
    if len(visible) < 180 and ("<script" in low or "enable javascript" in low):
        return True
    if "you need to enable javascript" in low and len(visible) < 400:
        return True
    return False


def visible_text(html: str) -> str:
    soup = BeautifulSoup(html or "", "lxml")
    for bad in soup(["script", "style", "noscript"]):
        bad.decompose()
    return soup.get_text(" ", strip=True)


def _login_wall(html: str, visible: str) -> bool:
    soup = BeautifulSoup(html or "", "lxml")
    if soup.find("input", attrs={"type": "password"}) is None:
        return False
    return len(visible) < 900
