from __future__ import annotations

import queue
import re
import subprocess
import sys
import threading
import tkinter as tk
import tkinter.font as tkfont
from pathlib import Path
from tkinter import filedialog, messagebox

# Explicit light colors. macOS dark mode plus Apple's Tk 8.5 draws light text
# on a white window, and ttk widgets often do not paint at all. Classic Tk
# widgets with a forced foreground/background stay visible.
BG = "#f2f2f2"
FG = "#1a1a1a"
FIELD = "#ffffff"

from job_matcher.cv_parser import CvReadError
from job_matcher.pipeline import run_match, validate_http_url
from job_matcher.report import format_job_plain

def _shape(text: str) -> str:
    """Linux Tk does not shape Hebrew. macOS Tk does, so leave it alone there."""
    if sys.platform == "darwin" or not re.search(r"[\u0590-\u05FF]", text):
        return text
    try:
        from bidi.algorithm import get_display

        return get_display(text)
    except Exception:
        return text


def _shape_block(text: str) -> str:
    return "\n".join(_shape(line) for line in text.splitlines())


class JobMatcherApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("Job Matcher")
        self.root.configure(bg=BG)
        self.font = self._pick_font(13)
        self.font_bold = self._pick_font(16, "bold")
        self.queue: queue.Queue = queue.Queue()
        self.visible = []
        self.markdown_path = ""
        self.html_path = ""
        self._build()
        # Size from the screen only. Do not flush the event queue here:
        # on macOS system Tk that leaves a permanently blank window.
        self._fit_geometry()
        self.root.after(120, self._poll)

    def _pick_font(self, size: int, weight: str = "normal") -> tuple:
        # Listing font families asks Tk to flush, which blanks the Mac window.
        if sys.platform == "darwin":
            family = "Helvetica"
            return (family, size, weight) if weight != "normal" else (family, size)
        families = set(tkfont.families())
        for name in (
            "Arial Hebrew",
            "Noto Sans Hebrew",
            "Noto Serif Hebrew",
            "DejaVu Sans",
            "Arial",
            "Helvetica",
        ):
            if name in families:
                return (name, size, weight) if weight != "normal" else (name, size)
        return ("TkDefaultFont", size)

    def _fit_geometry(self) -> None:
        screen_w = self.root.winfo_screenwidth()
        screen_h = self.root.winfo_screenheight()
        if screen_w < 400 or screen_h < 400:
            screen_w, screen_h = 1280, 800
        width = min(740, max(560, screen_w - 80))
        height = min(640, max(500, screen_h - 160))
        if width > screen_w - 20:
            width = max(320, screen_w - 20)
        if height > screen_h - 80:
            height = max(320, screen_h - 80)
        x = max(20, (screen_w - width) // 2)
        self.root.geometry(f"{int(width)}x{int(height)}+{int(x)}+50")

    def _label(self, parent: tk.Misc, text: str, bold: bool = False) -> tk.Label:
        return tk.Label(
            parent,
            text=_shape(text),
            bg=BG,
            fg=FG,
            font=self.font_bold if bold else self.font,
            anchor="w",
            justify="left",
        )

    def _entry(self, parent: tk.Misc, variable: tk.Variable) -> tk.Entry:
        return tk.Entry(
            parent,
            textvariable=variable,
            bg=FIELD,
            fg=FG,
            insertbackground=FG,
            font=self.font,
            highlightbackground="#b0b0b0",
            highlightthickness=1,
        )

    def _button(self, parent: tk.Misc, text: str, command) -> tk.Button:
        return tk.Button(parent, text=_shape(text), command=command, font=self.font)

    def _build(self) -> None:
        # Classic Tk only, packed top to bottom. Themed ttk widgets and
        # Treeview do not paint on the Mac mini's system Tk.
        pad = tk.Frame(self.root, bg=BG, padx=12, pady=10)
        pad.pack(side="top", fill="both", expand=True)

        self._label(pad, "התאמת משרות", bold=True).pack(anchor="w")
        self._label(pad, "משווים דרישות ממודעות ציבוריות לקורות החיים, אצלכם במחשב.").pack(
            anchor="w", pady=(0, 8)
        )

        self._label(pad, "כתובת לוח משרות").pack(anchor="w")
        self.url_var = tk.StringVar()
        self.url_entry = self._entry(pad, self.url_var)
        self.url_entry.pack(fill="x", pady=(0, 6))
        self.url_entry.bind("<Return>", lambda _event: self.run_clicked())

        self._label(pad, "קורות חיים").pack(anchor="w")
        cv_row = tk.Frame(pad, bg=BG)
        cv_row.pack(fill="x", pady=(0, 6))
        self._button(cv_row, "עיון…", self._pick_cv).pack(side="right")
        self.cv_var = tk.StringVar()
        self._entry(cv_row, self.cv_var).pack(side="left", fill="x", expand=True, padx=(0, 8))

        threshold_row = tk.Frame(pad, bg=BG)
        threshold_row.pack(fill="x", pady=(0, 6))
        self._label(threshold_row, "סף התאמה %").pack(side="left")
        self.threshold_var = tk.IntVar(value=50)
        tk.Spinbox(
            threshold_row,
            from_=0,
            to=100,
            textvariable=self.threshold_var,
            width=6,
            font=self.font,
            bg=FIELD,
            fg=FG,
        ).pack(side="left", padx=8)

        self._label(pad, "תיקיית דוח").pack(anchor="w")
        out_row = tk.Frame(pad, bg=BG)
        out_row.pack(fill="x", pady=(0, 8))
        self._button(out_row, "בחירה…", self._pick_out).pack(side="right")
        self.out_var = tk.StringVar(value=str(self._default_out()))
        self._entry(out_row, self.out_var).pack(side="left", fill="x", expand=True, padx=(0, 8))

        actions = tk.Frame(pad, bg=BG)
        actions.pack(fill="x", pady=(0, 8))
        self.run_button = self._button(actions, "הרץ התאמה", self.run_clicked)
        self.run_button.pack(side="right")
        self._button(actions, "פתח דוח HTML", self._open_html).pack(side="right", padx=6)
        self._button(actions, "פתח משרה", self._open_job).pack(side="right", padx=6)
        self.status_var = tk.StringVar(value=_shape("מוכן"))
        tk.Label(actions, textvariable=self.status_var, bg=BG, fg=FG, font=self.font).pack(side="left")

        self._label(pad, "תוצאות").pack(anchor="w")
        list_row = tk.Frame(pad, bg=BG)
        list_row.pack(fill="both", expand=True)
        scroll = tk.Scrollbar(list_row)
        scroll.pack(side="right", fill="y")
        self.results = tk.Listbox(
            list_row,
            font=self.font,
            height=6,
            bg=FIELD,
            fg=FG,
            selectbackground="#2f6fed",
            selectforeground="#ffffff",
            activestyle="dotbox",
            exportselection=False,
            yscrollcommand=scroll.set,
        )
        self.results.pack(side="left", fill="both", expand=True)
        scroll.configure(command=self.results.yview)
        self.results.bind("<<ListboxSelect>>", self._on_select)

        self._label(pad, "פרטי המשרה").pack(anchor="w", pady=(8, 2))
        text_row = tk.Frame(pad, bg=BG)
        text_row.pack(fill="both", expand=True)
        detail_scroll = tk.Scrollbar(text_row)
        detail_scroll.pack(side="right", fill="y")
        self.detail = tk.Text(
            text_row,
            wrap="word",
            font=self.font,
            height=6,
            bg=FIELD,
            fg=FG,
            insertbackground=FG,
            yscrollcommand=detail_scroll.set,
        )
        self.detail.pack(side="left", fill="both", expand=True)
        detail_scroll.configure(command=self.detail.yview)

        self.report_var = tk.StringVar(value="")
        tk.Label(
            pad,
            textvariable=self.report_var,
            bg=BG,
            fg=FG,
            font=self.font,
            wraplength=640,
            justify="left",
        ).pack(fill="x", pady=(6, 0))

    def _default_out(self) -> Path:
        documents = Path.home() / "Documents"
        base = documents if documents.is_dir() else Path.home()
        return base / "job-matcher-reports"

    def _pick_cv(self) -> None:
        chosen = filedialog.askopenfilename(
            title=_shape("בחירת קורות חיים"),
            filetypes=[
                ("CV", "*.pdf *.docx *.txt"),
                ("PDF", "*.pdf"),
                ("Word", "*.docx"),
                ("Text", "*.txt"),
            ],
        )
        if chosen:
            self.cv_var.set(chosen)

    def _pick_out(self) -> None:
        chosen = filedialog.askdirectory(title=_shape("תיקיית שמירה"))
        if chosen:
            self.out_var.set(chosen)

    def run_clicked(self) -> None:
        try:
            url = validate_http_url(self.url_var.get())
        except ValueError as exc:
            messagebox.showerror(_shape("כתובת"), _shape(str(exc)))
            return
        cv_path = Path(self.cv_var.get().strip())
        if cv_path.suffix.lower() not in {".pdf", ".docx", ".txt"} or not cv_path.is_file():
            messagebox.showerror(
                _shape("קורות חיים"),
                _shape("בחרו קובץ PDF, DOCX או TXT קיים."),
            )
            return
        try:
            threshold = float(self.threshold_var.get())
        except (tk.TclError, ValueError):
            messagebox.showerror(_shape("סף"), _shape("הסף צריך להיות מספר בין 0 ל-100."))
            return
        out_dir = Path(self.out_var.get().strip() or self._default_out())
        self.run_button.configure(state="disabled")
        self.status_var.set(_shape("מתחיל…"))
        self.detail.delete("1.0", "end")

        def worker() -> None:
            try:
                result = run_match(
                    url=url,
                    cv_path=cv_path,
                    threshold=threshold,
                    out_dir=out_dir,
                    progress=lambda message: self.queue.put(("progress", message)),
                )
            except CvReadError as exc:
                self.queue.put(("err", str(exc)))
            except Exception as exc:
                self.queue.put(("err", f"הריצה נכשלה: {exc}"))
            else:
                self.queue.put(("ok", result))

        threading.Thread(target=worker, daemon=True).start()

    def present(self, result) -> None:
        self.visible = result.included_jobs()
        self.markdown_path = result.markdown_path
        self.html_path = result.html_path
        self.results.delete(0, "end")
        for scored in self.visible:
            job = scored.job
            company = job.company or "—"
            location = job.location or ""
            self.results.insert("end", f"{scored.match_percent}%   {job.title}   {company}   {location}")
        below = len(result.below_threshold())
        unscored = len(result.unscored())
        if result.errors:
            status = result.errors[0]
        elif not self.visible:
            status = f"אין משרות מעל {result.threshold}%. מתחת לסף: {below}. בלי ציון: {unscored}."
        else:
            status = (
                f"מוצגות {len(self.visible)} משרות מעל {result.threshold}%, "
                f"ממוינות לפי אחוז. מתחת לסף: {below}. בלי ציון: {unscored}."
            )
        self.status_var.set(_shape(status))
        saved = f"Markdown: {result.markdown_path}    HTML: {result.html_path}"
        self.report_var.set(saved)
        if self.visible:
            self.results.selection_clear(0, "end")
            self.results.selection_set(0)
            self.results.activate(0)
            self._show(0)
        elif result.errors:
            self.detail.insert("1.0", _shape_block("\n".join(result.errors + result.notes)))
        self.run_button.configure(state="normal")

    def _show(self, index: int) -> None:
        if index < 0 or index >= len(self.visible):
            return
        self.detail.delete("1.0", "end")
        self.detail.insert("1.0", _shape_block(format_job_plain(self.visible[index])))
        self.detail.see("1.0")

    def _on_select(self, _event=None) -> None:
        selected = self.results.curselection()
        if not selected:
            return
        self._show(int(selected[0]))

    def _poll(self) -> None:
        try:
            while True:
                kind, payload = self.queue.get_nowait()
                if kind == "progress":
                    self.status_var.set(_shape(payload))
                elif kind == "ok":
                    self.present(payload)
                elif kind == "err":
                    self.run_button.configure(state="normal")
                    self.status_var.set(_shape("הריצה נעצרה"))
                    messagebox.showerror(_shape("שגיאה"), _shape(str(payload)))
        except queue.Empty:
            pass
        self.root.after(120, self._poll)

    def _open_html(self) -> None:
        if not self.html_path:
            messagebox.showinfo(_shape("דוח"), _shape("עדיין אין דוח. הריצו התאמה קודם."))
            return
        open_on_desktop(self.html_path)

    def _open_job(self) -> None:
        selected = self.results.curselection()
        if not selected:
            messagebox.showinfo(_shape("משרה"), _shape("בחרו משרה מהרשימה."))
            return
        url = self.visible[int(selected[0])].job.url
        open_on_desktop(url)


def open_on_desktop(path: str) -> None:
    if sys.platform == "darwin":
        subprocess.run(["open", path], check=False)
    elif sys.platform == "win32":
        import os

        os.startfile(path)  # type: ignore[attr-defined]
    else:
        subprocess.run(["xdg-open", path], check=False)


def run_gui() -> None:
    root = tk.Tk()
    JobMatcherApp(root)
    root.mainloop()
