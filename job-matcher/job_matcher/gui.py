from __future__ import annotations

import queue
import re
import subprocess
import sys
import threading
import tkinter as tk
import tkinter.font as tkfont
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

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
        self.root.title("התאמת משרות | Job Matcher")
        self.root.geometry("980x740")
        self.root.minsize(820, 620)
        self.font = self._pick_font(13)
        self.font_bold = self._pick_font(16, "bold")
        self.queue: queue.Queue = queue.Queue()
        self.visible = []
        self.markdown_path = ""
        self.html_path = ""
        self._build()
        self.root.after(120, self._poll)

    def _pick_font(self, size: int, weight: str = "normal") -> tuple:
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

    def _build(self) -> None:
        if sys.platform != "darwin":
            style = ttk.Style()
            if "clam" in style.theme_names():
                style.theme_use("clam")
        frame = ttk.Frame(self.root, padding=16)
        frame.grid(row=0, column=0, sticky="nsew")
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)
        frame.columnconfigure(1, weight=1)
        frame.rowconfigure(6, weight=1)
        frame.rowconfigure(8, weight=2)

        ttk.Label(frame, text=_shape("התאמת משרות"), font=self.font_bold).grid(
            row=0, column=0, columnspan=3, sticky="e"
        )
        ttk.Label(
            frame,
            text=_shape("משווים דרישות ממודעות ציבוריות לקורות החיים, אצלכם במחשב."),
            font=self.font,
        ).grid(row=1, column=0, columnspan=3, sticky="e", pady=(0, 10))

        ttk.Label(frame, text=_shape("כתובת לוח משרות"), font=self.font).grid(row=2, column=2, sticky="e")
        self.url_var = tk.StringVar()
        url_entry = ttk.Entry(frame, textvariable=self.url_var, font=self.font)
        url_entry.grid(row=2, column=0, columnspan=2, sticky="ew", padx=(0, 8))
        url_entry.bind("<Return>", lambda _event: self.run_clicked())

        ttk.Label(frame, text=_shape("קורות חיים"), font=self.font).grid(row=3, column=2, sticky="e", pady=6)
        self.cv_var = tk.StringVar()
        ttk.Entry(frame, textvariable=self.cv_var, font=self.font).grid(
            row=3, column=1, sticky="ew", padx=(0, 8)
        )
        ttk.Button(frame, text=_shape("עיון…"), command=self._pick_cv).grid(row=3, column=0, sticky="ew")

        options = ttk.Frame(frame)
        options.grid(row=4, column=0, columnspan=3, sticky="ew", pady=4)
        options.columnconfigure(1, weight=1)
        ttk.Label(options, text=_shape("סף התאמה %"), font=self.font).grid(row=0, column=4, sticky="e")
        self.threshold_var = tk.IntVar(value=50)
        ttk.Spinbox(options, from_=0, to=100, textvariable=self.threshold_var, width=6).grid(
            row=0, column=3, sticky="e", padx=6
        )
        ttk.Label(options, text=_shape("תיקיית דוח"), font=self.font).grid(row=0, column=2, sticky="e")
        self.out_var = tk.StringVar(value=str(self._default_out()))
        ttk.Entry(options, textvariable=self.out_var, font=self.font).grid(
            row=0, column=1, sticky="ew", padx=6
        )
        ttk.Button(options, text=_shape("בחירה…"), command=self._pick_out).grid(row=0, column=0, sticky="w")

        actions = ttk.Frame(frame)
        actions.grid(row=5, column=0, columnspan=3, sticky="ew", pady=8)
        self.run_button = ttk.Button(actions, text=_shape("הרץ התאמה"), command=self.run_clicked)
        self.run_button.pack(side="right")
        ttk.Button(actions, text=_shape("פתח דוח HTML"), command=self._open_html).pack(side="right", padx=6)
        ttk.Button(actions, text=_shape("פתח משרה"), command=self._open_job).pack(side="right", padx=6)
        self.status_var = tk.StringVar(value=_shape("מוכן"))
        ttk.Label(actions, textvariable=self.status_var, font=self.font).pack(side="left")

        columns = ("percent", "title", "company", "location")
        self.tree = ttk.Treeview(frame, columns=columns, show="headings", height=8)
        for key, label, width in (
            ("percent", "אחוז", 70),
            ("title", "משרה", 320),
            ("company", "חברה", 180),
            ("location", "מיקום", 180),
        ):
            self.tree.heading(key, text=_shape(label))
            self.tree.column(key, width=width, anchor="e")
        self.tree.grid(row=6, column=0, columnspan=3, sticky="nsew")
        self.tree.bind("<<TreeviewSelect>>", self._on_select)

        ttk.Label(frame, text=_shape("פרטי המשרה"), font=self.font).grid(
            row=7, column=0, columnspan=3, sticky="e", pady=(8, 2)
        )
        self.detail = tk.Text(frame, wrap="word", font=self.font, height=12)
        self.detail.grid(row=8, column=0, columnspan=3, sticky="nsew")
        self.report_var = tk.StringVar(value="")
        ttk.Label(frame, textvariable=self.report_var, font=self.font).grid(
            row=9, column=0, columnspan=3, sticky="ew", pady=(6, 0)
        )

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
        self.run_button.state(["disabled"])
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
        children = self.tree.get_children()
        if children:
            self.tree.delete(*children)
        for index, scored in enumerate(self.visible):
            job = scored.job
            self.tree.insert(
                "",
                "end",
                iid=str(index),
                values=(
                    f"{scored.match_percent}%",
                    _shape(job.title),
                    _shape(job.company or "—"),
                    _shape(job.location or "—"),
                ),
            )
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
            self.tree.selection_set("0")
            self.tree.focus("0")
            self._show(0)
        elif result.errors:
            self.detail.insert("1.0", _shape_block("\n".join(result.errors + result.notes)))
        self.run_button.state(["!disabled"])

    def _show(self, index: int) -> None:
        if index < 0 or index >= len(self.visible):
            return
        self.detail.delete("1.0", "end")
        self.detail.insert("1.0", _shape_block(format_job_plain(self.visible[index])))
        self.detail.see("1.0")

    def _on_select(self, _event=None) -> None:
        selected = self.tree.selection()
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
                    self.run_button.state(["!disabled"])
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
        selected = self.tree.selection()
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
