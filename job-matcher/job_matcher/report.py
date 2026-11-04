from __future__ import annotations

import html
from pathlib import Path

from job_matcher.models import CvProfile, RunResult, ScoredJob
from job_matcher.score import STATUS_LABEL, _fmt

_FORMULA = (
    "אחוז ההתאמה מחושב רק מדרישות שחולצו מהמודעה. "
    "כשיש גם דרישות ניסיון (עם מספר שנים) וגם דרישות אחרות, הניסיון הוא 65% מהציון. "
    "נענה = 100, חלקי = 50, חסר = 0. דרישת יתרון שוקלת 45% מדרישת חובה. "
    "לא מוסיפים דרישות שלא נכתבו במודעה."
)


def profile_summary(profile: CvProfile) -> str:
    if profile.total_years is None:
        years = "לא הוערכו שנות ניסיון"
    else:
        years = f"{_fmt(profile.total_years)} שנות ניסיון ({profile.years_method})"
    skill_bits = [
        f"{name} {_fmt(amount)} שנ׳"
        for name, amount in sorted(profile.skill_years.items(), key=lambda item: (-item[1], item[0]))[:12]
    ]
    present_only = sorted(skill for skill in profile.skill_present if skill not in profile.skill_years)[:12]
    parts = [years]
    if skill_bits:
        parts.append("שנים לפי תפקיד: " + ", ".join(skill_bits))
    if present_only:
        parts.append("מופיעים בלי שיוך לשנים: " + ", ".join(present_only))
    return ". ".join(parts) + "."


def format_job_plain(scored: ScoredJob) -> str:
    job = scored.job
    lines = [
        job.title,
        f"התאמה: {scored.match_percent}%" if scored.match_percent is not None else "התאמה: לא חושבה",
        f"סיבה: {scored.reason}",
        f"חברה: {job.company or 'לא צוין במודעה'}",
        f"מיקום: {job.location or 'לא צוין במודעה'}",
        f"קישור: {job.url}",
        "",
        "דרישות:",
    ]
    if scored.matches:
        for item in scored.matches:
            lines.append(f"- {STATUS_LABEL[item.status]} | {item.requirement.text}")
            lines.append(f"  {item.evidence}")
    else:
        lines.append("לא נמצאו דרישות מפורשות במודעה.")
    if job.notes:
        lines.append("")
        lines.append("הערות חילוץ: " + " ".join(job.notes))
    lines.extend(["", "פירוט המשרה:", job.description or "לא חולץ תיאור."])
    return "\n".join(lines)


def write_reports(result: RunResult, out_dir: Path) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = result.generated_at.strftime("%Y%m%d-%H%M%S")
    markdown_path = out_dir / f"job-match-{stamp}.md"
    html_path = out_dir / f"job-match-{stamp}.html"
    markdown_path.write_text(render_markdown(result), encoding="utf-8")
    html_path.write_text(render_html(result), encoding="utf-8")
    result.markdown_path = str(markdown_path)
    result.html_path = str(html_path)
    return markdown_path, html_path


def render_markdown(result: RunResult) -> str:
    included = result.included_jobs()
    lines = [
        "# דוח התאמת משרות",
        "",
        f"- מקור: {result.source_url}",
        f"- קורות חיים: {result.cv_name}",
        f"- סף מינימום: {result.threshold}%",
        f"- תאריך: {result.generated_at.strftime('%Y-%m-%d %H:%M %Z')}",
        f"- עמודים שנקראו: {result.pages_fetched}",
        "",
        "## ניסיון שחולץ מקורות החיים",
        "",
        profile_summary(result.profile),
        "",
        "## סיכום",
        "",
        (
            f"חולצו {len(result.jobs)} משרות. "
            f"{len(included)} בסף {result.threshold}% ומעלה."
        ),
        "",
    ]
    if result.errors:
        lines.append("## לא ניתן היה להשלים את השליפה")
        lines.append("")
        for error in result.errors:
            lines.append(f"> {error}")
            lines.append("")
    lines.append("## משרות רלוונטיות")
    lines.append("")
    if not included:
        lines.append("אין משרות שעומדות בסף ההתאמה.")
        lines.append("")
    for index, scored in enumerate(included, start=1):
        lines.extend(_markdown_job(index, scored, full=True))
    below = result.below_threshold()
    if below:
        lines.append("## מתחת לסף")
        lines.append("")
        lines.append("המשרות האלה חולצו, אבל אחוז ההתאמה נמוך מהסף ולכן אינן בדוח הרלוונטי.")
        lines.append("")
        for scored in below:
            job = scored.job
            lines.append(
                f"- {scored.match_percent}% — {job.title} — {job.company or 'ללא חברה'} — {job.url}"
            )
            lines.append(f"  - {scored.reason}")
        lines.append("")
    unscored = result.unscored()
    if unscored:
        lines.append("## משרות ללא אחוז")
        lines.append("")
        lines.append("המשרות האלה נמצאו, אבל לא חושב להן אחוז כי לא חולצו דרישות. לא הומצאו דרישות.")
        lines.append("")
        for index, scored in enumerate(unscored, start=1):
            lines.extend(_markdown_job(index, scored, full=True))
    if result.notes:
        lines.append("## הערות שליפה")
        lines.append("")
        for note in result.notes:
            lines.append(f"- {note}")
        lines.append("")
    lines.extend(["## איך חושב האחוז", "", _FORMULA, ""])
    return "\n".join(lines)


def _markdown_job(index: int, scored: ScoredJob, full: bool) -> list[str]:
    job = scored.job
    percent = f"{scored.match_percent}%" if scored.match_percent is not None else "לא חושב"
    lines = [
        f"### {index}. {job.title} — {percent}",
        "",
        f"- **חברה:** {job.company or 'לא צוין במודעה'}",
        f"- **מיקום:** {job.location or 'לא צוין במודעה'}",
        f"- **קישור:** {job.url}",
        f"- **סיבה:** {scored.reason}",
        "",
        "#### דרישות",
        "",
    ]
    if scored.matches:
        lines.append("| דרישה | סטטוס | מול קורות החיים |")
        lines.append("| --- | --- | --- |")
        for item in scored.matches:
            lines.append(
                "| "
                + " | ".join(
                    [
                        _md_cell(item.requirement.text),
                        _md_cell(STATUS_LABEL[item.status]),
                        _md_cell(item.evidence),
                    ]
                )
                + " |"
            )
        lines.append("")
    else:
        lines.append("לא נמצאו דרישות מפורשות במודעה.")
        lines.append("")
    if job.notes:
        lines.append("הערות: " + " ".join(job.notes))
        lines.append("")
    if full:
        lines.append("#### פירוט המשרה")
        lines.append("")
        lines.append(job.description or "לא חולץ תיאור.")
        lines.append("")
    return lines


def render_html(result: RunResult) -> str:
    included = result.included_jobs()
    parts = [
        "<!DOCTYPE html>",
        '<html lang="he" dir="rtl">',
        "<head>",
        '<meta charset="utf-8"/>',
        "<title>דוח התאמת משרות</title>",
        "<style>",
        _CSS,
        "</style>",
        "</head>",
        "<body>",
        "<h1>דוח התאמת משרות</h1>",
        "<ul>",
        f"<li>מקור: {_link(result.source_url)}</li>",
        f"<li>קורות חיים: {html.escape(result.cv_name)}</li>",
        f"<li>סף מינימום: {result.threshold}%</li>",
        f"<li>תאריך: {html.escape(result.generated_at.strftime('%Y-%m-%d %H:%M %Z'))}</li>",
        f"<li>עמודים שנקראו: {result.pages_fetched}</li>",
        "</ul>",
        "<h2>ניסיון שחולץ מקורות החיים</h2>",
        f"<p>{html.escape(profile_summary(result.profile))}</p>",
        "<h2>סיכום</h2>",
        (
            f"<p>חולצו {len(result.jobs)} משרות. "
            f"{len(included)} בסף {result.threshold}% ומעלה.</p>"
        ),
    ]
    if result.errors:
        parts.append("<h2>לא ניתן היה להשלים את השליפה</h2>")
        for error in result.errors:
            parts.append(f'<p class="error">{html.escape(error)}</p>')
    parts.append("<h2>משרות רלוונטיות</h2>")
    if not included:
        parts.append("<p>אין משרות שעומדות בסף ההתאמה.</p>")
    for index, scored in enumerate(included, start=1):
        parts.append(_html_job(index, scored))
    below = result.below_threshold()
    if below:
        parts.append("<h2>מתחת לסף</h2>")
        parts.append("<p>המשרות האלה חולצו, אבל אחוז ההתאמה נמוך מהסף.</p><ul>")
        for scored in below:
            job = scored.job
            parts.append(
                "<li>"
                f"{scored.match_percent}% — {html.escape(job.title)} — "
                f"{html.escape(job.company or 'ללא חברה')} — {_link(job.url)}"
                f"<div>{html.escape(scored.reason)}</div></li>"
            )
        parts.append("</ul>")
    unscored = result.unscored()
    if unscored:
        parts.append("<h2>משרות ללא אחוז</h2>")
        parts.append("<p>נמצאו משרות, אבל לא חולצו מהן דרישות. לא הומצאו דרישות.</p>")
        for index, scored in enumerate(unscored, start=1):
            parts.append(_html_job(index, scored))
    if result.notes:
        parts.append("<h2>הערות שליפה</h2><ul>")
        for note in result.notes:
            parts.append(f"<li>{html.escape(note)}</li>")
        parts.append("</ul>")
    parts.append("<h2>איך חושב האחוז</h2>")
    parts.append(f"<p>{html.escape(_FORMULA)}</p>")
    parts.append("</body></html>")
    return "\n".join(parts)


def _html_job(index: int, scored: ScoredJob) -> str:
    job = scored.job
    percent = f"{scored.match_percent}%" if scored.match_percent is not None else "לא חושב"
    rows = []
    if scored.matches:
        rows.append(
            "<table><thead><tr><th>דרישה</th><th>סטטוס</th><th>מול קורות החיים</th></tr></thead><tbody>"
        )
        for item in scored.matches:
            rows.append(
                "<tr>"
                f"<td>{html.escape(item.requirement.text)}</td>"
                f'<td><span class="badge badge-{item.status}">{html.escape(STATUS_LABEL[item.status])}</span></td>'
                f"<td>{html.escape(item.evidence)}</td>"
                "</tr>"
            )
        rows.append("</tbody></table>")
    else:
        rows.append("<p>לא נמצאו דרישות מפורשות במודעה.</p>")
    notes = f"<p>{html.escape(' '.join(job.notes))}</p>" if job.notes else ""
    return (
        '<article class="job">'
        f"<h3>{index}. {html.escape(job.title)} — {percent}</h3>"
        "<ul>"
        f"<li>חברה: {html.escape(job.company or 'לא צוין במודעה')}</li>"
        f"<li>מיקום: {html.escape(job.location or 'לא צוין במודעה')}</li>"
        f"<li>קישור: {_link(job.url)}</li>"
        f"<li>סיבה: {html.escape(scored.reason)}</li>"
        "</ul>"
        "<h4>דרישות</h4>"
        + "".join(rows)
        + notes
        + "<h4>פירוט המשרה</h4>"
        f'<div class="desc">{html.escape(job.description or "לא חולץ תיאור.")}</div>'
        "</article>"
    )


def _link(url: str) -> str:
    escaped = html.escape(url, quote=True)
    return f'<a class="ltr" href="{escaped}">{html.escape(url)}</a>'


def _md_cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


_CSS = """
body { font-family: "Arial Hebrew", "Noto Sans Hebrew", "DejaVu Sans", Arial, sans-serif;
  margin: 2rem auto; max-width: 960px; line-height: 1.55; color: #1c1c1c; background: #fff; }
h1, h2, h3 { line-height: 1.3; }
a, .ltr { direction: ltr; unicode-bidi: isolate; }
table { width: 100%; border-collapse: collapse; margin: 0.5rem 0 1rem; }
td, th { border: 1px solid #ddd; padding: 8px; vertical-align: top; text-align: right; }
th { background: #f3f4f6; }
.desc { white-space: pre-wrap; background: #f7f7f8; padding: 12px; border-radius: 8px; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-weight: 600; }
.badge-met { background: #e5f6e8; color: #146c2e; }
.badge-partial { background: #fff4d6; color: #8a5a00; }
.badge-missing { background: #fde8e8; color: #9b1c1c; }
.error { background: #fde8e8; padding: 12px; border-radius: 8px; }
.job { border-top: 1px solid #e5e5e5; padding-top: 1rem; margin-top: 1.5rem; }
"""
