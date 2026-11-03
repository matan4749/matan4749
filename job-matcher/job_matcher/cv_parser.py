from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path

from job_matcher.models import CvProfile
from job_matcher.skills import known_skills_in

MONTHS = {
    "january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3,
    "april": 4, "apr": 4, "may": 5, "june": 6, "jun": 6, "july": 7, "jul": 7,
    "august": 8, "aug": 8, "september": 9, "sep": 9, "sept": 9, "october": 10,
    "oct": 10, "november": 11, "nov": 11, "december": 12, "dec": 12,
    "ינואר": 1, "פברואר": 2, "מרץ": 3, "אפריל": 4, "מאי": 5, "יוני": 6,
    "יולי": 7, "אוגוסט": 8, "ספטמבר": 9, "אוקטובר": 10, "נובמבר": 11, "דצמבר": 12,
}

_MONTH_ALT = "|".join(sorted(MONTHS, key=len, reverse=True))
_PRESENT = r"present|current|now|today|ongoing|היום|עכשיו|נוכחי"
_RANGE_RE = re.compile(
    rf"(?:(?P<m1>{_MONTH_ALT})\.?\s+)?"
    rf"(?P<y1>(?:19|20)\d{{2}})"
    rf"\s*(?:-|–|—|−|to|עד)\s*"
    rf"(?:(?P<m2>{_MONTH_ALT})\.?\s+)?"
    rf"(?P<y2>(?:19|20)\d{{2}}|{_PRESENT})",
    re.I,
)
_EXPLICIT_YEARS = re.compile(
    r"(\d+(?:\.\d+)?)\s*\+?\s*(?:years|yrs|שנות|שנים)\s+"
    r"(?:of\s+)?(?:professional\s+|relevant\s+)?(?:experience|ניסיון)",
    re.I,
)
_EDU = re.compile(
    r"\b(university|college|bachelor|master|ph\.?d|b\.sc|m\.sc|b\.a|m\.a|student)\b|"
    r"תואר|אוניברסיטה|לימודים|השכלה",
    re.I,
)


class CvReadError(Exception):
    pass


def parse_cv(path: Path) -> CvProfile:
    path = Path(path)
    if not path.is_file():
        raise CvReadError(f"קובץ קורות החיים לא נמצא: {path}")
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        text = _read_pdf(path)
    elif suffix == ".docx":
        text = _read_docx(path)
    elif suffix == ".txt":
        text = _read_txt(path)
    else:
        raise CvReadError("סוג קובץ לא נתמך. בחרו PDF, DOCX או TXT.")
    text = text.replace("\x00", " ").strip()
    if len(text) < 20:
        raise CvReadError(
            "חולץ מעט מאוד טקסט מקורות החיים. "
            "PDF סרוק בלי שכבת טקסט לא נתמך. A scanned PDF with no text layer cannot be read."
        )
    total, method, skill_years = _experience(text)
    present = set(known_skills_in(text))
    return CvProfile(
        path_name=path.name,
        text=text,
        total_years=total,
        years_method=method,
        skill_years=skill_years,
        skill_present=present,
    )


def _read_txt(path: Path) -> str:
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "cp1255", "iso-8859-8"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _read_docx(path: Path) -> str:
    try:
        from docx import Document
    except ImportError as exc:
        raise CvReadError("חסרה הספרייה python-docx. הריצו pip install -r requirements.txt") from exc
    try:
        document = Document(str(path))
    except Exception as exc:
        raise CvReadError(f"לא ניתן לקרוא את קובץ ה-DOCX: {exc}") from exc
    parts = [p.text for p in document.paragraphs if p.text.strip()]
    for table in document.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
            if cells:
                parts.append(" | ".join(cells))
    return "\n".join(parts)


def _read_pdf(path: Path) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise CvReadError("חסרה הספרייה pypdf. הריצו pip install -r requirements.txt") from exc
    try:
        reader = PdfReader(str(path))
    except Exception as exc:
        raise CvReadError(f"לא ניתן לקרוא את קובץ ה-PDF: {exc}") from exc
    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception as exc:
            raise CvReadError("ה-PDF מוצפן ולא ניתן לקרוא אותו.") from exc
    pages = []
    for page in reader.pages:
        pages.append(page.extract_text() or "")
    return "\n".join(pages)


def _experience(text: str) -> tuple[float | None, str, dict[str, float]]:
    lines = text.splitlines()
    found: list[tuple[int, float, float]] = []
    for index, line in enumerate(lines):
        match = _RANGE_RE.search(line)
        if not match:
            continue
        start, end = _span_from_match(match)
        if end <= start:
            continue
        found.append((index, start, end))

    roles: list[tuple[float, float, str]] = []
    for pos, (line_index, start, end) in enumerate(found):
        next_index = found[pos + 1][0] if pos + 1 < len(found) else len(lines)
        header_from = max(0, line_index - 2)
        header = "\n".join(lines[header_from : line_index + 1])
        block = "\n".join(lines[header_from:next_index])
        if _EDU.search(header):
            continue
        roles.append((start, end, block))

    total = _merge_years(roles)
    method_parts = []
    if total is not None:
        method_parts.append("הוערך מטווחי תאריכים של תפקידים (קטעי השכלה שזוהו לא נספרו)")

    explicit = _EXPLICIT_YEARS.search(text)
    explicit_years = float(explicit.group(1)) if explicit else None
    if total is None and explicit_years is not None:
        total = explicit_years
        method_parts.append("נלקח ממשפט מפורש של שנות ניסיון בקורות החיים")
    elif explicit_years is not None and total is not None and abs(explicit_years - total) >= 1:
        method_parts.append(
            f"בקורות החיים כתוב גם {explicit_years:g} שנות ניסיון; לחישוב שימשו טווחי התאריכים"
        )
    if total is None:
        method = "לא נמצאו טווחי תאריכים או מספר שנות ניסיון מפורש"
    else:
        total = round(total, 2)
        method = "; ".join(method_parts)

    skill_years: dict[str, float] = {}
    for start, end, block in roles:
        duration = max(0.0, end - start)
        for skill in set(known_skills_in(block)):
            skill_years[skill] = skill_years.get(skill, 0.0) + duration
    if total is not None:
        for skill, years in list(skill_years.items()):
            skill_years[skill] = round(min(years, total), 2)
    else:
        skill_years = {skill: round(years, 2) for skill, years in skill_years.items()}
    return total, method, skill_years


def _span_from_match(match: re.Match[str]) -> tuple[float, float]:
    now = datetime.now()
    y1 = int(match.group("y1"))
    m1 = MONTHS.get((match.group("m1") or "").lower(), 1)
    start = y1 + (m1 - 1) / 12
    y2_raw = match.group("y2")
    if re.fullmatch(_PRESENT, y2_raw, re.I):
        end = now.year + (now.month - 1) / 12
    else:
        y2 = int(y2_raw)
        if match.group("m2"):
            m2 = MONTHS[(match.group("m2") or "").lower()]
            end = y2 + (m2 - 1) / 12
        elif y2 == now.year:
            end = now.year + (now.month - 1) / 12
        else:
            end = y2 + 11 / 12
    return start, end


def _merge_years(roles: list[tuple[float, float, str]]) -> float | None:
    if not roles:
        return None
    intervals = sorted((start, end) for start, end, _text in roles)
    merged: list[list[float]] = []
    for start, end in intervals:
        if not merged or start > merged[-1][1]:
            merged.append([start, end])
        else:
            merged[-1][1] = max(merged[-1][1], end)
    return sum(end - start for start, end in merged)
