from __future__ import annotations

import re

from job_matcher.extract import domain_is_generic
from job_matcher.models import CvProfile, Requirement, RequirementMatch, ScoredJob
from job_matcher.skills import known_skills_in

STATUS_LABEL = {
    "met": "נענה (met)",
    "partial": "חלקי (partial)",
    "missing": "חסר (missing)",
}

_STOP = {
    "the", "and", "for", "with", "from", "that", "this", "your", "you", "our",
    "are", "was", "were", "have", "has", "will", "not", "but", "all", "any",
    "experience", "experienced", "years", "year", "ability", "strong", "using",
    "including", "include", "plus", "must", "required", "preferred", "work",
    "working", "team", "skills", "skill", "knowledge", "familiarity", "a", "an",
    "of", "in", "on", "to", "or", "as", "at", "by", "be",
    "של", "על", "עם", "את", "או", "גם", "לא", "כי", "זה", "זו", "הוא", "היא",
    "הם", "ברמת", "רמת", "עבור", "בין", "כדי", "יש", "אין", "כל", "יותר",
    "פחות", "מאוד", "מאד", "וכן", "כולל", "בתחום", "בתפקיד", "יכולת", "נדרש",
    "נדרשת", "חובה", "ניסיון", "שנות", "שנים", "שנה",
}


def score_job(profile: CvProfile, job) -> ScoredJob:
    if not job.requirements:
        note = "לא חולצו דרישות מהמודעה, ולכן לא חושב אחוז התאמה."
        if job.notes:
            note = " ".join(job.notes) + " " + note
        return ScoredJob(job=job, match_percent=None, reason=note, matches=[], included=False)
    matches = [score_requirement(profile, requirement) for requirement in job.requirements]
    percent = _percent(matches)
    return ScoredJob(
        job=job,
        match_percent=percent,
        reason=build_reason(percent, matches),
        matches=matches,
        included=False,
    )


def score_requirement(profile: CvProfile, requirement: Requirement) -> RequirementMatch:
    if requirement.kind == "education":
        status, evidence = _score_education(profile, requirement)
    elif requirement.kind == "experience" and requirement.years is not None:
        status, evidence = _compare_years(profile, requirement.years, requirement.domain or "")
    elif requirement.kind in {"experience", "skill"}:
        status, evidence = _score_skillish(profile, requirement)
    else:
        status, evidence = _score_tokens(profile, requirement.text)
    return RequirementMatch(requirement=requirement, status=status, evidence=evidence)


def build_reason(percent: int, matches: list[RequirementMatch]) -> str:
    met = sum(item.status == "met" for item in matches)
    partial = sum(item.status == "partial" for item in matches)
    missing = sum(item.status == "missing" for item in matches)
    experience = [item for item in matches if item.requirement.kind == "experience"]
    bits = [
        f"{item.requirement.text} — {STATUS_LABEL[item.status]}"
        for item in experience[:3]
    ]
    if bits:
        experience_text = "ניסיון: " + "; ".join(bits) + "."
    else:
        experience_text = "לא צוינו דרישות ניסיון עם שנות ניסיון."
    return (
        f"התאמה {percent}% — {met} נענו, {partial} חלקי, {missing} חסרות. {experience_text}"
    )


def _percent(matches: list[RequirementMatch]) -> int:
    experience = [item for item in matches if item.requirement.kind == "experience"]
    other = [item for item in matches if item.requirement.kind != "experience"]
    if experience and other:
        value = 0.65 * _group_score(experience) + 0.35 * _group_score(other)
    elif experience:
        value = _group_score(experience)
    else:
        value = _group_score(other)
    return int(value + 0.5)


def _group_score(matches: list[RequirementMatch]) -> float:
    total_weight = 0.0
    total_value = 0.0
    for item in matches:
        weight = 1.0 if item.requirement.priority == "required" else 0.45
        value = {"met": 1.0, "partial": 0.5, "missing": 0.0}[item.status]
        total_weight += weight
        total_value += weight * value
    if total_weight == 0:
        return 0.0
    return 100.0 * total_value / total_weight


def _compare_years(profile: CvProfile, required: float, domain: str) -> tuple[str, str]:
    skills = [skill for skill in known_skills_in(domain) if not domain_is_generic(skill)]
    if not skills or domain_is_generic(domain):
        if profile.total_years is None:
            return (
                "partial",
                "צוינו שנות ניסיון נדרשות, אך לא ניתן היה לחשב שנות ניסיון כוללות מקורות החיים.",
            )
        return _years_status(
            required,
            profile.total_years,
            f"נדרשות {_fmt(required)} שנים; מקורות החיים הוערכו {_fmt(profile.total_years)} שנות ניסיון.",
        )
    statuses: list[str] = []
    details: list[str] = []
    for skill in skills:
        if skill in profile.skill_years:
            years = profile.skill_years[skill]
            status, _evidence = _years_status(required, years, "")
            statuses.append(status)
            details.append(f"{skill}: {_fmt(years)} שנים (נדרשות {_fmt(required)})")
        elif skill in profile.skill_present:
            statuses.append("partial")
            details.append(f"{skill} מופיע בקורות החיים, אך לא צוינו שנות ניסיון בתחום")
        else:
            statuses.append("missing")
            details.append(f"{skill} לא נמצא בקורות החיים (נדרשות {_fmt(required)} שנים)")
    return _combine(statuses), "; ".join(details)


def _years_status(required: float, actual: float, evidence: str) -> tuple[str, str]:
    if actual >= required:
        status = "met"
        suffix = "עומד בדרישה."
    elif actual >= required * 0.6:
        status = "partial"
        suffix = "קרוב לדרישה, אך מתחתיה."
    else:
        status = "missing"
        suffix = "מתחת לדרישה."
    if evidence:
        evidence = f"{evidence} {suffix}"
    return status, evidence


def _score_skillish(profile: CvProfile, requirement: Requirement) -> tuple[str, str]:
    source = requirement.domain or requirement.text
    skills = [skill for skill in known_skills_in(source) if not domain_is_generic(skill)]
    if not skills:
        skills = [skill for skill in known_skills_in(requirement.text) if not domain_is_generic(skill)]
    if not skills:
        return _score_tokens(profile, requirement.text)
    statuses: list[str] = []
    details: list[str] = []
    for skill in skills:
        if skill in profile.skill_years:
            statuses.append("met")
            details.append(f"{skill}: {_fmt(profile.skill_years[skill])} שנים בקורות החיים")
        elif skill in profile.skill_present:
            statuses.append("met")
            snippet = _snippet(profile.text, skill)
            details.append(f"{skill} מופיע בקורות החיים" + (f" ({snippet})" if snippet else ""))
        else:
            statuses.append("missing")
            details.append(f"{skill} לא נמצא בקורות החיים")
    return _combine(statuses), "; ".join(details)


def _score_tokens(profile: CvProfile, text: str) -> tuple[str, str]:
    tokens = _significant(text)
    if not tokens:
        return "partial", "הדרישה כללית מדי להשוואה אוטומטית מול קורות החיים."
    cv_tokens = set(_significant(profile.text))
    hits = [token for token in tokens if token in cv_tokens]
    ratio = len(hits) / len(tokens)
    if hits and ratio >= 0.6:
        return "met", _evidence_hits(profile.text, hits)
    if hits and ratio >= 0.34:
        return "partial", "התאמה חלקית בלבד: " + _evidence_hits(profile.text, hits)
    return "missing", "לא נמצא בקורות החיים."


def _score_education(profile: CvProfile, requirement: Requirement) -> tuple[str, str]:
    text = profile.text
    blob = requirement.text
    cv_phd = bool(re.search(r"ph\.?d|דוקטור|doctorate", text, re.I))
    cv_msc = cv_phd or bool(re.search(r"m\.sc|m\.s\.|master|תואר שני", text, re.I))
    cv_bsc = cv_msc or bool(re.search(r"b\.sc|b\.s\.|bachelor|תואר ראשון|תואר|\bdegree\b", text, re.I))
    if re.search(r"ph\.?d|דוקטור|doctorate", blob, re.I):
        if cv_phd:
            return "met", "נמצא תואר שלישי בקורות החיים."
        if cv_bsc:
            return "missing", "נדרש PhD; בקורות החיים מופיע תואר נמוך יותר בלבד."
        return "missing", "לא נמצא PhD בקורות החיים."
    if re.search(r"m\.sc|master|תואר שני", blob, re.I):
        if cv_msc:
            return "met", "נמצא תואר שני ומעלה בקורות החיים."
        if cv_bsc:
            return "partial", "נמצא תואר ראשון; נדרש תואר שני."
        return "missing", "לא נמצא תואר בקורות החיים."
    if cv_bsc:
        return "met", "נמצא תואר בקורות החיים."
    return "missing", "לא נמצאה השכלה תואמת בקורות החיים."


def _combine(statuses: list[str]) -> str:
    if statuses and all(status == "met" for status in statuses):
        return "met"
    if statuses and all(status == "missing" for status in statuses):
        return "missing"
    return "partial"


def _significant(text: str) -> list[str]:
    raw = re.findall(r"[A-Za-z][A-Za-z0-9+#.]{1,}|[\u0590-\u05FF]{2,}", text.lower())
    tokens = []
    seen = set()
    for token in raw:
        if token in _STOP or token in seen:
            continue
        if len(token) < 2:
            continue
        seen.add(token)
        tokens.append(token)
    return tokens


def _evidence_hits(text: str, hits: list[str]) -> str:
    snippets: list[str] = []
    for hit in hits[:4]:
        snippet = _snippet(text, hit)
        if not snippet:
            continue
        if any(snippet in existing or existing in snippet for existing in snippets):
            continue
        snippets.append(snippet)
    if snippets:
        return "נמצא בקורות החיים: " + " | ".join(snippets[:2])
    return "נמצאו בקורות החיים: " + ", ".join(hits[:6])


def _snippet(text: str, needle: str) -> str:
    match = re.search(re.escape(needle), text, re.I)
    if not match:
        return ""
    start = max(0, match.start() - 40)
    end = min(len(text), match.end() + 40)
    if start > 0 and not text[start - 1].isspace():
        space = text.find(" ", start, match.start())
        if space != -1:
            start = space + 1
    if end < len(text) and not text[end - 1].isspace():
        space = text.rfind(" ", match.end(), end)
        if space != -1:
            end = space
    return re.sub(r"\s+", " ", text[start:end]).strip(" ,;|-—")


def _fmt(value: float) -> str:
    if abs(value - round(value)) < 0.05:
        return str(int(round(value)))
    return f"{value:.1f}"
