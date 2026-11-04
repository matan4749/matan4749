from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Callable, Protocol
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup, Tag

from job_matcher.fetch import FetchResult, interpret, looks_like_js_shell
from job_matcher.models import JobPosting, Requirement
from job_matcher.skills import known_skills_in

MAX_JOBS = 30
MAX_LISTING_PAGES = 3
MAX_DESCRIPTION = 50_000

_HEADING_RE = re.compile(
    r"^(?:"
    r"requirements|job requirements|position requirements|"
    r"qualifications|minimum qualifications|basic qualifications|required qualifications|"
    r"what you(?:'|’)ll (?:need|bring)|what we(?:'|’)re looking for|what you need|"
    r"must[- ]haves?|required skills|skills required|experience required|"
    r"nice[- ]to[- ]haves?|preferred qualifications|preferred skills|bonus points|"
    r"דרישות(?:\s+התפקיד|\s+חובה|\s+סף)?|כישורים(?:\s+נדרשים)?|"
    r"ניסיון נדרש|דרישות סף|יתרון|כישורים ודרישות"
    r")$",
    re.I,
)
_PREFERRED_RE = re.compile(
    r"nice|preferred|bonus|advantage|plus|יתרון|עדיפות",
    re.I,
)
_GENERIC_TITLES = {
    "careers", "jobs", "job", "openings", "positions", "vacancies",
    "משרות", "דרושים", "קריירה", "משרה",
}
_JOB_HREF = re.compile(
    r"(jobs?/\d+|jobs?/[a-z0-9][a-z0-9\-]{2,}|/positions?/|/openings?/|/vacancies/|"
    r"gh_jid=|greenhouse\.io/.+/jobs/|lever\.co/.+/|ashbyhq\.com/.+/|"
    r"comeet\.(?:co|com)/.+/|myworkdayjobs\.com/.+/job/|"
    r"smartrecruiters\.com/.+/|recruitee\.com/.+/|workable\.com/.+/)",
    re.I,
)
_CARD_CLASS = re.compile(r"job|opening|position|posting|vacanc|career", re.I)
_SKIP_LINK = re.compile(
    r"^(apply|apply now|read more|learn more|share|login|log in|sign in|next|previous|"
    r"home|back|הגש|הגשת מועמדות|קרא עוד|שתף|התחבר|הבא|הקודם)$",
    re.I,
)
_SOCIAL_HOSTS = ("linkedin.com", "facebook.com", "twitter.com", "x.com", "instagram.com", "t.me")
_BOARD_HOSTS = (
    "greenhouse.io",
    "lever.co",
    "ashbyhq.com",
    "myworkdayjobs.com",
    "comeet.co",
    "comeet.com",
    "smartrecruiters.com",
    "recruitee.com",
    "workable.com",
)
_YEAR_PATTERNS = (
    re.compile(
        r"(\d+(?:\.\d+)?)\s*\+?\s*(?:years|yrs)\b(?:\s+of)?(?:\s+experience)?"
        r"(?:\s+(?:with|in|of|using))?\s*([^.,;\n|]{0,80})",
        re.I,
    ),
    re.compile(
        r"(?:at least|minimum of|minimum)\s+(\d+(?:\.\d+)?)\s*\+?\s*(?:years|yrs)\b"
        r"(?:\s+of)?(?:\s+experience)?(?:\s+(?:with|in|of|using))?\s*([^.,;\n|]{0,80})",
        re.I,
    ),
    re.compile(
        r"(\d+(?:\.\d+)?)\s*\+?\s*שנ(?:ות|ים|ה)\s+(?:של\s+)?ניסיון"
        r"(?:\s*(?:ב|עם|בתחום))?\s*([^.,;\n|]{0,80})"
    ),
    re.compile(
        r"ניסיון(?:\s+של)?\s+(\d+(?:\.\d+)?)\s*\+?\s*שנ(?:ות|ים|ה)"
        r"(?:\s*(?:ב|עם|בתחום))?\s*([^.,;\n|]{0,80})"
    ),
)
_EXPERIENCE_DOMAIN = re.compile(
    r"(?:experience\s+(?:with|in|using)\s+|ניסיון\s*(?:עם|ב))\s*([^.,;\n|]{2,80})",
    re.I,
)
_MONTHS_REQ = re.compile(r"(\d+(?:\.\d+)?)\s*monthsOfExperience", re.I)
GENERIC_WORDS = {
    "software", "development", "engineering", "professional", "experience",
    "relevant", "work", "industry", "field", "related", "similar", "role", "a",
    "the", "of", "in", "with", "and", "or",
    "פיתוח", "תוכנה", "ניסיון", "מקצועי", "רלוונטי", "הייטק", "תחום", "התחום",
    "עבודה", "בתחום", "כללי",
}


class Fetcher(Protocol):
    def fetch(self, url: str) -> FetchResult: ...


@dataclass
class ListingHint:
    url: str
    title: str
    location: str = ""
    company: str = ""


@dataclass
class Extraction:
    jobs: list[JobPosting]
    errors: list[str]
    notes: list[str]
    pages_fetched: int


Progress = Callable[[str], None]


def _page_snippet(html: str) -> str:
    if not html:
        return ""
    if "<" in html[:200] and ">" in html[:200]:
        from job_matcher.fetch import visible_text

        text = visible_text(html)
    else:
        text = html
    return re.sub(r"\s+", " ", text).strip()[:220]


def extract_jobs(
    fetcher: Fetcher,
    start_url: str,
    progress: Progress | None = None,
    *,
    watch: Callable[[dict], None] | None = None,
) -> Extraction:
    progress = progress or (lambda _message: None)
    notes: list[str] = []
    errors: list[str] = []
    pages_fetched = 0
    jobs_found = 0

    def ping(url: str, snippet: str, phase: str, fraction: float | None = None) -> None:
        if watch is None:
            return
        watch(
            {
                "url": url,
                "snippet": (snippet or "")[:240],
                "pages": pages_fetched,
                "jobs": jobs_found,
                "phase": phase,
                "fraction": fraction,
            }
        )

    progress("שולף את העמוד…")
    ping(start_url, "שולף את העמוד…", "fetch", 0.08)
    first = interpret(fetcher.fetch(start_url))
    pages_fetched += 1
    ping(
        first.final_url or start_url,
        first.error or first.blocked_reason or _page_snippet(first.text),
        "page",
        0.16,
    )
    if first.error:
        return Extraction([], [first.error], notes, pages_fetched)
    if first.blocked_reason:
        return Extraction([], [first.blocked_reason], notes, pages_fetched)
    if looks_like_js_shell(first.text):
        return Extraction(
            [],
            [
                "העמוד כמעט ריק ונראה שהוא נטען באמצעות JavaScript. "
                "האפליקציה קוראת HTML בלבד ולא מריצה דפדפן, ולכן לא חולצו משרות."
            ],
            notes,
            pages_fetched,
        )

    pages = [first]
    seen_pages = {_norm_url(first.final_url)}
    next_url = find_next_page(BeautifulSoup(first.text, "lxml"), first.final_url)
    while next_url and len(pages) < MAX_LISTING_PAGES:
        normalized = _norm_url(next_url)
        if normalized in seen_pages:
            break
        progress("שולף עמוד רשימה נוסף…")
        ping(next_url, "שולף עמוד רשימה נוסף…", "fetch", 0.2)
        page = interpret(fetcher.fetch(next_url))
        pages_fetched += 1
        ping(
            page.final_url or next_url,
            page.error or page.blocked_reason or _page_snippet(page.text),
            "page",
            0.24,
        )
        seen_pages.add(normalized)
        if page.error or page.blocked_reason or looks_like_js_shell(page.text):
            notes.append(page.error or page.blocked_reason or "עמוד ההמשך נראה כמעטפת JavaScript ולא נקרא.")
            break
        pages.append(page)
        next_url = find_next_page(BeautifulSoup(page.text, "lxml"), page.final_url)

    if len(pages) == 1:
        soup = BeautifulSoup(pages[0].text, "lxml")
        links = discover_links(soup, pages[0].final_url)
        embedded = _embedded_jobs(soup, pages[0].final_url)
        if _is_single_job(soup, embedded, links):
            job = parse_job_page(pages[0], None)
            if job is not None:
                jobs_found = 1
                ping(job.url, job.title, "job", 0.9)
            if job is None:
                return Extraction(
                    [],
                    ["לא ניתן היה לחלץ משרה מהעמוד. לא הומצאה משרה."],
                    notes,
                    pages_fetched,
                )
            return Extraction([job], errors, notes, pages_fetched)

    hints: list[ListingHint] = []
    embedded_jobs: list[JobPosting] = []
    seen_jobs: set[str] = set()
    for page in pages:
        soup = BeautifulSoup(page.text, "lxml")
        for hint in discover_links(soup, page.final_url):
            key = _norm_url(hint.url)
            if key in seen_jobs or key in seen_pages:
                continue
            seen_jobs.add(key)
            hints.append(hint)
        for job in _embedded_jobs(soup, page.final_url):
            key = _norm_url(job.url) if job.url else ""
            if job.requirements and len(job.description) > 80 and key and key not in seen_jobs:
                embedded_jobs.append(job)
                seen_jobs.add(key)

    if not hints and not embedded_jobs:
        notes.append(
            "העמוד נטען, אבל לא נמצאו מודעות משרה ב-HTML. "
            "אתרים שמציגים משרות רק אחרי JavaScript לא נתמכים. לא הומצאו משרות."
        )
        return Extraction([], errors, notes, pages_fetched)

    jobs = list(embedded_jobs)
    jobs_found = len(jobs)
    limited = hints[:MAX_JOBS]
    if len(hints) > MAX_JOBS:
        notes.append(f"נמצאו {len(hints)} קישורים. נקראו {MAX_JOBS} הראשונים בלבד.")
    for index, hint in enumerate(limited, start=1):
        progress(f"קורא משרה {index}/{len(limited)}: {hint.title}")
        fraction = 0.25 + 0.65 * (index / max(len(limited), 1))
        ping(hint.url, hint.title, "fetch", fraction)
        page = interpret(fetcher.fetch(hint.url))
        pages_fetched += 1
        ping(
            page.final_url or hint.url,
            page.error or page.blocked_reason or _page_snippet(page.text) or hint.title,
            "page",
            fraction,
        )
        if page.error or page.blocked_reason:
            notes.append(f"{hint.title} ({hint.url}): {page.error or page.blocked_reason}")
            continue
        if "pdf" in (page.content_type or "").lower() or hint.url.lower().split("?")[0].endswith(".pdf"):
            notes.append(f"{hint.title}: המודעה היא PDF ולא נותחה כ-HTML. {hint.url}")
            continue
        job = parse_job_page(page, hint)
        if job is None:
            notes.append(f"לא חולצה משרה מהקישור {hint.url}")
            continue
        jobs.append(job)
        jobs_found = len(jobs)
        ping(job.url, f"{job.title} — {job.company}".strip(" —"), "job", fraction)
    return Extraction(jobs, errors, notes, pages_fetched)


def parse_job_page(fetched: FetchResult, hint: ListingHint | None) -> JobPosting | None:
    if looks_like_js_shell(fetched.text):
        if hint and hint.title:
            return JobPosting(
                title=hint.title,
                url=fetched.final_url or hint.url,
                company=hint.company,
                location=hint.location,
                description="",
                notes=["עמוד המשרה נטען ב-JavaScript ולא נמצא תוכן HTML לניתוח."],
            )
        return None
    soup = BeautifulSoup(fetched.text, "lxml")
    nodes = _jsonld_job_nodes(soup)
    if nodes:
        job = job_from_jsonld(nodes[0], fetched.final_url)
        html_job = job_from_html(soup, fetched.final_url)
        if not job.company:
            job.company = html_job.company
        if not job.location:
            job.location = html_job.location
        if len(html_job.description) > len(job.description):
            job.description = html_job.description
        if _generic_title(job.title) and html_job.title:
            job.title = html_job.title
        job.requirements = _merge_requirements(job.requirements, html_job.requirements)
    else:
        job = job_from_html(soup, fetched.final_url)
    if hint:
        if (not job.title or _generic_title(job.title)) and hint.title:
            job.title = hint.title
        if not job.location:
            job.location = hint.location
        if not job.company:
            job.company = hint.company
        if not job.url:
            job.url = hint.url
    job.requirements = _add_loose_experience(job.description, job.requirements)
    job.description = job.description[:MAX_DESCRIPTION]
    if not job.title or _generic_title(job.title):
        if len(job.description) < 40:
            return None
        if not job.title or _generic_title(job.title):
            job.notes.append("לא נמצאה כותרת במודעה.")
            job.title = job.title or "משרה ללא כותרת שחולצה"
    return job


def job_from_html(soup: BeautifulSoup, page_url: str) -> JobPosting:
    title = ""
    h1 = soup.find("h1")
    if h1:
        title = h1.get_text(" ", strip=True)
    if not title or _generic_title(title):
        og = soup.find("meta", property="og:title")
        if og and og.get("content"):
            title = og["content"].strip()
    if not title and soup.title and soup.title.string:
        title = soup.title.string.strip()
    node = _description_node(soup)
    description = _plain_text(node) if node else ""
    requirements = extract_requirements_from_html(soup)
    return JobPosting(
        title=title.strip(),
        url=page_url,
        company=_labeled(soup, "company"),
        location=_labeled(soup, "location"),
        description=description,
        requirements=requirements,
    )


def job_from_jsonld(node: dict, page_url: str) -> JobPosting:
    title = _as_text(node.get("title"))
    description = _html_to_text(_as_text(node.get("description")))
    company = ""
    org = node.get("hiringOrganization")
    if isinstance(org, dict):
        company = _as_text(org.get("name"))
    elif isinstance(org, str):
        company = org
    url = _as_text(node.get("url")) or page_url
    if url.startswith("/"):
        url = urljoin(page_url, url)
    requirements: list[Requirement] = []
    for field, label in (
        ("qualifications", "qualifications"),
        ("experienceRequirements", "experienceRequirements"),
        ("skills", "skills"),
        ("educationRequirements", "educationRequirements"),
    ):
        for piece in _coerce_pieces(node.get(field)):
            requirements.append(make_requirement(piece, "required", label))
    return JobPosting(
        title=title,
        url=url or page_url,
        company=company,
        location=_location_from_jsonld(node),
        description=description,
        requirements=_dedupe(requirements),
    )


def extract_requirements_from_html(soup: BeautifulSoup) -> list[Requirement]:
    pairs: list[tuple[Tag, str]] = []
    for el in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "strong", "b"]):
        label = _heading_label(el)
        if label:
            pairs.append((el, label))
    filtered: list[tuple[Tag, str]] = []
    elements = [el for el, _label in pairs]
    for el, label in pairs:
        if any(el is not other and other in el.parents for other in elements):
            continue
        filtered.append((el, label))
    requirements: list[Requirement] = []
    for index, (el, label) in enumerate(filtered):
        end = filtered[index + 1][0] if index + 1 < len(filtered) else None
        priority = "preferred" if _PREFERRED_RE.search(label) else "required"
        for bullet in _bullets_until(el, end):
            requirements.append(make_requirement(bullet, priority, label))
    return _dedupe(requirements)


def make_requirement(text: str, priority: str, section: str) -> Requirement:
    cleaned = re.sub(r"\s+", " ", text).strip(" \t-•●▪·")
    months = _MONTHS_REQ.search(cleaned)
    if months:
        years = float(months.group(1)) / 12
        return Requirement(
            text=cleaned,
            kind="experience",
            years=years,
            domain="professional experience",
            priority=priority,
            section=section,
        )
    years, domain = parse_years(cleaned)
    if years is None:
        domain = domain or _experience_domain(cleaned)
    if years is not None:
        kind = "experience"
    elif re.search(r"\bexperience\b|ניסיון", cleaned, re.I):
        skills = [skill for skill in known_skills_in(cleaned) if skill not in GENERIC_WORDS]
        if skills and not domain_is_generic(cleaned):
            kind = "skill"
        else:
            kind = "experience"
    elif re.search(r"\b(ph\.?d|m\.sc|b\.sc|bachelor|master|degree)\b|תואר|השכלה", cleaned, re.I):
        kind = "education"
    elif known_skills_in(cleaned) and len(cleaned) <= 48:
        kind = "skill"
    else:
        kind = "other"
    return Requirement(
        text=cleaned,
        kind=kind,
        years=years,
        domain=domain,
        priority=priority,
        section=section,
    )


def parse_years(text: str) -> tuple[float | None, str | None]:
    for pattern in _YEAR_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue
        years = float(match.group(1))
        domain = _clean_domain(match.group(2) or "")
        return years, domain
    return None, None


def domain_is_generic(domain: str | None) -> bool:
    if not domain:
        return True
    lowered = domain.strip().lower()
    if lowered in {"professional experience", "experience", "relevant experience"}:
        return True
    tokens = re.findall(r"[A-Za-z][A-Za-z+.#]{1,}|[\u0590-\u05FF]{2,}", lowered)
    if not tokens:
        return True
    return all(token in GENERIC_WORDS for token in tokens)


def discover_links(soup: BeautifulSoup, base_url: str) -> list[ListingHint]:
    hints: list[ListingHint] = []
    seen: set[str] = set()
    for anchor in soup.find_all("a", href=True):
        href = anchor["href"].strip()
        if not href or href.startswith(("#", "mailto:", "javascript:", "tel:")):
            continue
        absolute = urljoin(base_url, href)
        if not _allowed_target(base_url, absolute):
            continue
        text = anchor.get_text(" ", strip=True)
        heading = anchor.find(["h1", "h2", "h3", "h4", "h5"])
        if heading:
            text = heading.get_text(" ", strip=True) or text
        if not text or _SKIP_LINK.match(text) or not (4 <= len(text) <= 140):
            continue
        if not (_JOB_HREF.search(absolute) or _in_job_card(anchor)):
            continue
        key = _norm_url(absolute)
        if key in seen or key == _norm_url(base_url):
            continue
        seen.add(key)
        location = ""
        company = ""
        parent = anchor.find_parent(["li", "div", "article", "tr"])
        if parent:
            location = _labeled(parent, "location")
            company = _labeled(parent, "company")
        hints.append(ListingHint(url=absolute, title=text, location=location, company=company))
    return hints


def find_next_page(soup: BeautifulSoup, base_url: str) -> str | None:
    anchor = soup.find("a", rel=lambda value: value and "next" in " ".join(value if isinstance(value, list) else [value]))
    if isinstance(anchor, Tag) and anchor.get("href"):
        return urljoin(base_url, anchor["href"])
    for candidate in soup.find_all("a", href=True):
        label = candidate.get_text(" ", strip=True).lower()
        if label in {"next", "next ›", "הבא", "›", "»"}:
            return urljoin(base_url, candidate["href"])
    return None


def _embedded_jobs(soup: BeautifulSoup, page_url: str) -> list[JobPosting]:
    jobs = []
    for node in _jsonld_job_nodes(soup):
        job = job_from_jsonld(node, page_url)
        if job.title:
            jobs.append(job)
    return jobs


def _is_single_job(soup: BeautifulSoup, embedded: list[JobPosting], links: list[ListingHint]) -> bool:
    if len(embedded) == 1 and len(links) < 3:
        return True
    if len(embedded) > 1:
        return False
    h1s = [h.get_text(" ", strip=True) for h in soup.find_all("h1")]
    has_requirements = bool(extract_requirements_from_html(soup))
    if len(h1s) == 1 and has_requirements and len(links) <= 2:
        return True
    visible = soup.get_text(" ", strip=True)
    if len(links) == 0 and len(h1s) == 1 and len(visible) > 40 and not _generic_title(h1s[0]):
        return True
    return False


def _jsonld_job_nodes(soup: BeautifulSoup) -> list[dict]:
    found: list[dict] = []
    for script in soup.find_all("script"):
        script_type = " ".join(script.get("type", []) if isinstance(script.get("type"), list) else [script.get("type") or ""])
        if "ld+json" not in script_type:
            continue
        raw = script.string or script.get_text() or ""
        for blob in _parse_jsonld_blob(raw):
            found.extend(_walk_jobpostings(blob))
    return found


def _parse_jsonld_blob(raw: str) -> list:
    raw = raw.strip()
    if not raw:
        return []
    try:
        return [json.loads(raw)]
    except json.JSONDecodeError:
        pass
    decoder = json.JSONDecoder()
    index = 0
    blobs = []
    while index < len(raw):
        while index < len(raw) and raw[index] not in "{[":
            index += 1
        if index >= len(raw):
            break
        try:
            obj, end = decoder.raw_decode(raw, index)
        except json.JSONDecodeError:
            index += 1
            continue
        blobs.append(obj)
        index = end
    return blobs


def _walk_jobpostings(node) -> list[dict]:
    found: list[dict] = []
    if isinstance(node, list):
        for item in node:
            found.extend(_walk_jobpostings(item))
        return found
    if not isinstance(node, dict):
        return found
    if "@graph" in node:
        found.extend(_walk_jobpostings(node["@graph"]))
    types = node.get("@type", [])
    if isinstance(types, str):
        types = [types]
    if any(str(item).lower() == "jobposting" for item in types):
        found.append(node)
    for key in ("itemListElement", "item"):
        if key in node:
            found.extend(_walk_jobpostings(node[key]))
    return found


def _coerce_pieces(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return _split_lines(value)
    if isinstance(value, list):
        pieces: list[str] = []
        for item in value:
            pieces.extend(_coerce_pieces(item))
        return pieces
    if isinstance(value, dict):
        if value.get("monthsOfExperience"):
            return [f"{value['monthsOfExperience']} monthsOfExperience"]
        for key in ("name", "description", "value"):
            if isinstance(value.get(key), str):
                return _coerce_pieces(value[key])
    return []


def _split_lines(text: str) -> list[str]:
    plain = _html_to_text(text)
    parts = re.split(r"[\n\r]+|•|●|▪|·", plain)
    lines = []
    for part in parts:
        cleaned = part.strip(" \t-–—*•")
        if len(cleaned) >= 2:
            lines.append(cleaned)
    return lines


def _bullets_until(start: Tag, end: Tag | None) -> list[str]:
    items: list[str] = []
    for node in start.find_all_next(["li", "h1", "h2", "h3", "h4", "h5", "h6", "p"]):
        if end is not None and (node is end or end in node.parents):
            break
        if node.name in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            break
        if node.name == "p" and _heading_label(node):
            break
        if node.name != "li":
            continue
        if node.find_parent("li") is not None:
            continue
        text = re.sub(r"\s+", " ", node.get_text(" ", strip=True)).strip()
        if 2 <= len(text) <= 500:
            items.append(text)
    return items


def _heading_label(el: Tag) -> str | None:
    if el.name in {"p", "div"} and el.find(["h1", "h2", "h3", "h4", "ul", "ol", "li"]):
        return None
    text = el.get_text(" ", strip=True).strip().strip(":").strip()
    if not text or len(text) > 60:
        return None
    if el.name in {"p", "div", "strong", "b"} and el.find_parent(["h1", "h2", "h3", "h4", "h5", "h6"]):
        return None
    if _HEADING_RE.match(text):
        return text
    return None


def _description_node(soup: BeautifulSoup):
    for selector in (
        "[itemprop=description]",
        ".job-post-content",
        ".job__description",
        "#job-description",
        ".posting-description",
        "article",
        "main",
    ):
        node = soup.select_one(selector)
        if node and len(node.get_text(" ", strip=True)) > 40:
            return node
    return soup.body or soup


def _labeled(node, kind: str) -> str:
    pattern = re.compile(kind, re.I)
    for el in node.find_all(class_=pattern):
        if el.find(["h1", "h2", "ul", "ol"]):
            continue
        text = el.get_text(" ", strip=True)
        if text and len(text) <= 80:
            return text
    return ""


def _plain_text(node) -> str:
    clone = BeautifulSoup(str(node), "lxml")
    for bad in clone.find_all(["script", "style", "noscript"]):
        bad.decompose()
    text = clone.get_text("\n", strip=True)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _html_to_text(value: str) -> str:
    if "<" in value and ">" in value:
        return _plain_text(BeautifulSoup(value, "lxml"))
    return value.strip()


def _location_from_jsonld(node: dict) -> str:
    locations = node.get("jobLocation")
    if isinstance(locations, dict):
        locations = [locations]
    if not isinstance(locations, list):
        return ""
    parts: list[str] = []
    for place in locations:
        if not isinstance(place, dict):
            continue
        address = place.get("address")
        if isinstance(address, str):
            parts.append(address)
            continue
        if isinstance(address, dict):
            bits = [
                address.get("addressLocality") or "",
                address.get("addressRegion") or "",
                address.get("addressCountry") or "",
            ]
            joined = ", ".join(bit for bit in bits if isinstance(bit, str) and bit)
            if joined:
                parts.append(joined)
        elif place.get("name"):
            parts.append(str(place["name"]))
    return "; ".join(parts)


def _as_text(value) -> str:
    if isinstance(value, str):
        return value.strip()
    return ""


def _clean_domain(domain: str) -> str | None:
    domain = re.sub(
        r"\b(required|preferred|or more|at least|minimum|and up)\b",
        "",
        domain,
        flags=re.I,
    )
    domain = domain.strip(" -–—:|/")
    domain = re.sub(r"\s+", " ", domain)
    if not domain:
        return "professional experience"
    if domain.lower() in {"experience", "relevant experience", "professional experience"}:
        return "professional experience"
    return domain[:80]


def _experience_domain(text: str) -> str | None:
    match = _EXPERIENCE_DOMAIN.search(text)
    if not match:
        return None
    return _clean_domain(match.group(1))


def _add_loose_experience(description: str, requirements: list[Requirement]) -> list[Requirement]:
    if not description:
        return requirements
    existing = [_norm_text(item.text) for item in requirements]
    extra: list[Requirement] = []
    for sentence in re.split(r"(?<=[.!?])\s+|\n+", description):
        sentence = sentence.strip(" \t-•")
        if not (8 <= len(sentence) <= 300):
            continue
        years, _domain = parse_years(sentence)
        if years is None:
            continue
        normalized = _norm_text(sentence)
        if any(normalized in item or item in normalized for item in existing):
            continue
        made = make_requirement(sentence, "required", "description")
        extra.append(made)
        existing.append(_norm_text(made.text))
    return _dedupe(requirements + extra)


def _merge_requirements(primary: list[Requirement], secondary: list[Requirement]) -> list[Requirement]:
    return _dedupe(primary + secondary)


def _dedupe(requirements: list[Requirement]) -> list[Requirement]:
    seen: set[str] = set()
    unique: list[Requirement] = []
    for requirement in requirements:
        key = _norm_text(requirement.text)
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(requirement)
    return unique


def _norm_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def _generic_title(title: str) -> bool:
    return title.strip().lower() in _GENERIC_TITLES


def _in_job_card(anchor: Tag) -> bool:
    depth = 0
    for parent in anchor.parents:
        depth += 1
        if depth > 5:
            break
        classes = " ".join(parent.get("class", []))
        ident = parent.get("id") or ""
        if _CARD_CLASS.search(classes) or _CARD_CLASS.search(ident):
            return True
    return False


def _allowed_target(base_url: str, url: str) -> bool:
    target = urlparse(url)
    if target.scheme not in {"http", "https", "file"}:
        return False
    host = target.netloc.lower()
    if any(host.endswith(social) for social in _SOCIAL_HOSTS):
        return False
    if re.search(r"/(login|signin|sign-in|signup|privacy|terms)(/|$)", target.path, re.I):
        return False
    base = urlparse(base_url)
    if base.scheme == "file" or target.scheme == "file":
        return base.scheme == "file" and target.scheme == "file"
    if _host(base.netloc) == _host(target.netloc):
        return True
    return any(host.endswith(board) for board in _BOARD_HOSTS)


def _host(netloc: str) -> str:
    host = netloc.lower().split("@")[-1].split(":")[0]
    if host.startswith("www."):
        host = host[4:]
    return host


def _norm_url(url: str) -> str:
    parsed = urlparse(url)
    path = parsed.path.rstrip("/") or "/"
    return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}{path}"
