from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from job_matcher.cv_parser import parse_cv
from job_matcher.extract import parse_years
from job_matcher.fetch import FetchResult
from job_matcher.pipeline import run_match

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "fixtures"
CV = FIXTURES / "sample_cv.txt"


class MapFetcher:
    def __init__(self, pages: dict[str, tuple[int, str]]) -> None:
        self.pages = pages

    def fetch(self, url: str) -> FetchResult:
        if url not in self.pages:
            return FetchResult(url=url, final_url=url, status=0, text="", error=f"missing {url}")
        status, body = self.pages[url]
        return FetchResult(
            url=url,
            final_url=url,
            status=status,
            text=body,
            content_type="text/html",
        )


def _status(scored, snippet: str) -> str:
    for item in scored.matches:
        if snippet.lower() in item.requirement.text.lower():
            return item.status
    raise AssertionError(f"{snippet!r} not in {[m.requirement.text for m in scored.matches]}")


class PipelineTests(unittest.TestCase):
    def test_cv_years_and_skills(self) -> None:
        profile = parse_cv(CV)
        self.assertIsNotNone(profile.total_years)
        assert profile.total_years is not None
        self.assertGreaterEqual(profile.total_years, 7)
        self.assertLess(profile.total_years, 9)
        self.assertIn("python", profile.skill_years)
        self.assertGreaterEqual(profile.skill_years["python"], 4)
        self.assertLess(profile.skill_years["python"], 5.5)
        self.assertIn("react", profile.skill_present)
        self.assertNotIn("kubernetes", profile.skill_present)
        self.assertNotIn("machine learning", profile.skill_present)

    def test_nextjs_is_not_counted_as_javascript(self) -> None:
        from job_matcher.skills import known_skills_in

        self.assertEqual(known_skills_in("Experience with Next.js"), ["nextjs"])
        self.assertIn("javascript", known_skills_in("JavaScript and JS"))
        self.assertNotIn("javascript", known_skills_in("react.js"))

    def test_year_phrases(self) -> None:
        years, domain = parse_years("3+ years of experience in software development")
        self.assertEqual(years, 3)
        self.assertIn("software", (domain or "").lower())
        years, domain = parse_years("3 שנות ניסיון בפיתוח תוכנה")
        self.assertEqual(years, 3)
        self.assertIn("פיתוח", domain or "")
        years, domain = parse_years("8+ years of experience with machine learning")
        self.assertEqual(years, 8)
        self.assertIn("machine learning", (domain or "").lower())

    def test_board_report_fields_and_order(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = run_match(
                html_file=FIXTURES / "board.html",
                cv_path=CV,
                threshold=50,
                out_dir=Path(tmp),
            )
            html = Path(result.html_path).read_text(encoding="utf-8")
            markdown = Path(result.markdown_path).read_text(encoding="utf-8")
        self.assertGreaterEqual(result.pages_fetched, 5)
        included = result.included_jobs()
        titles = [job.job.title for job in included]
        self.assertIn("Full-Stack Developer", titles)
        self.assertIn("Backend Engineer", titles)
        self.assertIn("מפתח/ת פולסטאק", titles)
        self.assertNotIn("Senior Data Scientist", titles)
        percents = [job.match_percent for job in included]
        self.assertEqual(percents, sorted(percents, reverse=True))

        by_title = {job.job.title: job for job in result.jobs}
        full = by_title["Full-Stack Developer"]
        self.assertGreaterEqual(full.match_percent, 80)
        self.assertEqual(full.job.company, "Northwind Labs")
        self.assertIn("Tel Aviv", full.job.location)
        self.assertIn("job-fullstack.html", full.job.url)
        self.assertIn("Build the product", full.job.description)
        self.assertEqual(_status(full, "React"), "met")
        self.assertEqual(_status(full, "Kubernetes"), "missing")
        self.assertIn("%", full.reason)
        self.assertTrue(full.matches)

        hebrew = by_title["מפתח/ת פולסטאק"]
        self.assertGreaterEqual(hebrew.match_percent, 90)
        self.assertEqual(_status(hebrew, "React"), "met")
        self.assertEqual(_status(hebrew, "עברית"), "met")
        self.assertEqual(hebrew.job.company, "חברה לדוגמה")

        backend = by_title["Backend Engineer"]
        self.assertEqual(_status(backend, "Python"), "partial")
        self.assertEqual(_status(backend, "Firebase"), "met")
        self.assertEqual(_status(backend, "PostgreSQL"), "missing")
        self.assertGreaterEqual(backend.match_percent, 50)

        data = by_title["Senior Data Scientist"]
        self.assertLess(data.match_percent, 50)
        self.assertFalse(data.included)
        self.assertEqual(_status(data, "machine learning"), "missing")
        self.assertEqual(_status(data, "PhD"), "missing")
        self.assertEqual(_status(data, "Python"), "met")

        for report in (html, markdown):
            self.assertIn("Full-Stack Developer", report)
            self.assertIn("job-fullstack.html", report)
            self.assertIn("Northwind Labs", report)
            self.assertIn("Build the product", report)
            self.assertIn("Kubernetes", report)
            self.assertIn("3+ years of experience in software development", report)
            self.assertIn("%", report)
        self.assertIn('dir="rtl"', html)
        self.assertIn("נענה (met)", html)
        self.assertIn("חסר (missing)", html)
        self.assertIn("חלקי (partial)", html)
        self.assertIn("<table>", html)

    def test_blocked_page_invents_nothing(self) -> None:
        body = """
        <html><head><title>Attention Required! | Cloudflare</title></head>
        <body><h1>Software Engineer</h1>
        <div class="job-opening"><a href="/jobs/1">Imaginary Role</a></div>
        <p>Sorry, you have been blocked</p></body></html>
        """
        with tempfile.TemporaryDirectory() as tmp:
            result = run_match(
                url="https://jobs.example/blocked",
                cv_path=CV,
                threshold=50,
                out_dir=Path(tmp),
                fetcher=MapFetcher({"https://jobs.example/blocked": (403, body)}),
            )
            report = Path(result.html_path).read_text(encoding="utf-8")
        self.assertEqual(result.jobs, [])
        self.assertTrue(result.errors)
        self.assertIn("403", report)
        self.assertNotIn("Imaginary Role", report)
        self.assertNotIn("Software Engineer", report)

    def test_javascript_shell_and_missing_requirements(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            shell = run_match(
                html_file=FIXTURES / "js-shell.html",
                cv_path=CV,
                threshold=50,
                out_dir=Path(tmp) / "js",
            )
            empty = run_match(
                html_file=FIXTURES / "no-requirements.html",
                cv_path=CV,
                threshold=0,
                out_dir=Path(tmp) / "empty",
            )
            report = Path(empty.html_path).read_text(encoding="utf-8")
        self.assertEqual(shell.jobs, [])
        self.assertTrue(any("JavaScript" in error for error in shell.errors))
        self.assertEqual(len(empty.jobs), 1)
        self.assertIsNone(empty.jobs[0].match_percent)
        self.assertEqual(empty.jobs[0].job.title, "Office Manager")
        self.assertEqual(empty.jobs[0].matches, [])
        self.assertIn("לא נמצאו דרישות", report)
        self.assertIn("Come say hello", report)

    def test_jsonld_job(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = run_match(
                html_file=FIXTURES / "jsonld-job.html",
                cv_path=CV,
                threshold=50,
                out_dir=Path(tmp),
            )
        self.assertEqual(len(result.jobs), 1)
        job = result.jobs[0]
        self.assertEqual(job.job.title, "Platform Engineer")
        self.assertEqual(job.job.company, "Schema Co")
        self.assertIn("Beer Sheva", job.job.location)
        self.assertEqual(job.job.url, "https://example.com/jobs/platform")
        self.assertEqual(_status(job, "Python"), "met")
        self.assertEqual(_status(job, "Docker"), "missing")
        self.assertIn("Keep the platform running", job.job.description)
        self.assertTrue(job.included)

    def test_pdf_and_docx(self) -> None:
        from docx import Document

        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            docx_path = folder / "cv.docx"
            document = Document()
            document.add_paragraph("Backend Engineer")
            document.add_paragraph("2020 - 2024")
            document.add_paragraph("Python and PostgreSQL in production.")
            document.save(docx_path)
            pdf_path = folder / "cv.pdf"
            pdf_path.write_bytes(_pdf_bytes("Backend Engineer Python 2020 - 2024"))

            docx_profile = parse_cv(docx_path)
            pdf_profile = parse_cv(pdf_path)
        self.assertIn("Python", docx_profile.text)
        self.assertIn("PostgreSQL", docx_profile.text)
        self.assertIsNotNone(docx_profile.total_years)
        self.assertIn("python", docx_profile.skill_present)
        self.assertIn("Python", pdf_profile.text)
        self.assertIsNotNone(pdf_profile.total_years)

    def test_window_keeps_form_on_screen(self) -> None:
        import tkinter as tk

        from job_matcher.gui import JobMatcherApp

        root = tk.Tk()
        try:
            app = JobMatcherApp(root)
            root.update_idletasks()
            root.deiconify()
            root.update()
            screen_h = root.winfo_screenheight()
            screen_w = root.winfo_screenwidth()
            self.assertLessEqual(root.winfo_reqheight(), screen_h)
            self.assertLessEqual(root.winfo_width(), screen_w)
            self.assertLessEqual(root.winfo_height(), screen_h)
            self.assertGreaterEqual(root.winfo_y(), 0)
            self.assertLess(root.winfo_y() + 80, screen_h)
            # The run button is on screen and above the detail pane.
            self.assertGreater(app.run_button.winfo_height(), 1)
            self.assertGreater(app.url_entry.winfo_height(), 1)
            self.assertLess(app.run_button.winfo_rooty(), app.detail.winfo_rooty())
            self.assertLess(app.run_button.winfo_rooty(), screen_h - 40)
        finally:
            root.destroy()

    def test_gui_uses_classic_tk(self) -> None:
        source = (ROOT / "job_matcher" / "gui.py").read_text(encoding="utf-8")
        self.assertNotIn("ttk.", source)
        self.assertNotIn("import ttk", source)
        self.assertNotIn("update_idletasks", source)

    def test_urllib3_stays_on_libressl(self) -> None:
        text = (ROOT / "requirements.txt").read_text(encoding="utf-8")
        self.assertIn("urllib3>=1.26.18,<2", text)

    def test_gui_lists_matches_descending(self) -> None:
        import tkinter as tk

        from job_matcher.gui import JobMatcherApp

        with tempfile.TemporaryDirectory() as tmp:
            result = run_match(
                html_file=FIXTURES / "board.html",
                cv_path=CV,
                threshold=50,
                out_dir=Path(tmp),
            )
            root = tk.Tk()
            root.withdraw()
            try:
                app = JobMatcherApp(root)
                app.present(result)
                root.update_idletasks()
                rows = []
                for line in app.results.get(0, "end"):
                    rows.append(int(str(line).split("%", 1)[0]))
                self.assertGreaterEqual(len(rows), 3)
                self.assertEqual(rows, sorted(rows, reverse=True))
                app._show(0)
                detail = app.detail.get("1.0", "end")
                self.assertIn("%", detail)
                self.assertTrue("job-" in detail or "file:" in detail or "http" in detail.lower())
            finally:
                root.destroy()


def _pdf_bytes(text: str) -> bytes:
    stream = f"BT /F1 24 Tf 72 720 Td ({text}) Tj ET".encode("latin-1")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for offset in offsets[1:]:
        out += f"{offset:010d} 00000 n \n".encode()
    out += (
        f"trailer<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode()
    )
    return bytes(out)


if __name__ == "__main__":
    unittest.main()
