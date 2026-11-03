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
        self.font = self._pick_font(13)
        self.font_bold = self._pick_font(16, "bold")
        self.queue: queue.Queue = queue.Queue()
        self.visible = []
        self.markdown_path = ""
        self.html_path = ""
        self._placed_on_screen = False
        self._build()
        # Cap the window before it is mapped. Old macOS Tk otherwise honors a
        # huge requested height and parks the top of the window off-screen.
        self._limit_to_screen()
        self._place_on_screen()
        self.root.bind("<Map>", self._on_map, add="+")
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

    def _screen_box(self) -> tuple[int, int]:
        width = self.root.winfo_screenwidth()
        height = self.root.winfo_screenheight()
        if width < 640 or height < 480:
            width, height = max(width, 1280), max(height, 800)
        return width, height

    def _limit_to_screen(self) -> None:
        width, height = self._screen_box()
        self.root.maxsize(width, height)
        self.root.minsize(min(560, width - 40), min(420, height - 120))

    def _place_on_screen(self) -> None:
        """Keep the title bar and the form on a normal Mac screen.

        System Tk 8.5 lets ttk.Treeview request a height taller than the
        display, then the window manager shows the bottom of that window.
        """
        self.root.update_idletasks()
        screen_w, screen_h = self._screen_box()
        margin_top = 48
        margin_bottom = 80
        usable_w = max(560, screen_w - 80)
        usable_h = max(420, screen_h - margin_top - margin_bottom)
        width = min(usable_w, max(640, min(self.root.winfo_reqwidth() + 16, 900)))
        height = min(usable_h, max(520, min(self.root.winfo_reqheight() + 24, 760)))
        x = max(20, (screen_w - width) // 2)
        self.root.geometry(f"{int(width)}x{int(height)}+{int(x)}+{margin_top}")

    def _on_map(self, _event=None) -> None:
        if self._placed_on_screen:
            return
        self._placed_on_screen = True
        self._place_on_screen()

    def _build(self) -> None:
        if sys.platform != "darwin":
            style = ttk.Style()
            if "clam" in style.theme_names():
                style.theme_use("clam")
        # pack, not a single weighted grid: the form is packed first so a
        # too-small window keeps the URL, CV, threshold, and run button.
        outer = ttk.Frame(self.root, padding=12)
        outer.pack(side="top", fill="both", expand=True)

        form = ttk.Frame(outer)
        form.pack(side="top", fill="x")
        form.columnconfigure(1, weight=1)

        ttk.Label(form, text=_shape("התאמת משרות"), font=self.font_bold).grid(
            row=0, column=0, columnspan=3, sticky="w"
        )
        ttk.Label(
            form,
            text=_shape("משווים דרישות ממודעות ציבוריות לקורות החיים, אצלכם במחשב."),
            font=self.font,
        ).grid(row=1, column=0, columnspan=3, sticky="w", pady=(0, 8))

        ttk.Label(form, text=_shape("כתובת לוח משרות"), font=self.font).grid(
            row=2, column=0, sticky="e", padx=(0, 8)
        )
        self.url_var = tk.StringVar()
        self.url_entry = ttk.Entry(form, textvariable=self.url_var, font=self.font)
        self.url_entry.grid(row=2, column=1, columnspan=2, sticky="ew")
        self.url_entry.bind("<Return>", lambda _event: self.run_clicked())

        ttk.Label(form, text=_shape("קורות חיים"), font=self.font).grid(
            row=3, column=0, sticky="e", padx=(0, 8), pady=6
        )
        self.cv_var = tk.StringVar()
        ttk.Entry(form, textvariable=self.cv_var, font=self.font).grid(
            row=3, column=1, sticky="ew", pady=6
        )
        ttk.Button(form, text=_shape("עיון…"), command=self._pick_cv).grid(
            row=3, column=2, padx=(8, 0)
        )

        ttk.Label(form, text=_shape("סף התאמה %"), font=self.font).grid(
            row=4, column=0, sticky="e", padx=(0, 8)
        )
        self.threshold_var = tk.IntVar(value=50)
        ttk.Spinbox(form, from_=0, to=100, textvariable=self.threshold_var, width=6).grid(
            row=4, column=1, sticky="w"
        )

        ttk.Label(form, text=_shape("תיקיית דוח"), font=self.font).grid(
            row=5, column=0, sticky="e", padx=(0, 8), pady=6
        )
        self.out_var = tk.StringVar(value=str(self._default_out()))
        ttk.Entry(form, textvariable=self.out_var, font=self.font).grid(
            row=5, column=1, sticky="ew", pady=6
        )
        ttk.Button(form, text=_shape("בחירה…"), command=self._pick_out).grid(
            row=5, column=2, padx=(8, 0)
        )

        actions = ttk.Frame(form)
        actions.grid(row=6, column=0, columnspan=3, sticky="ew", pady=(4, 8))
        self.run_button = ttk.Button(actions, text=_shape("הרץ התאמה"), command=self.run_clicked)
        self.run_button.pack(side="right")
        ttk.Button(actions, text=_shape("פתח דוח HTML"), command=self._open_html).pack(
            side="right", padx=6
        )
        ttk.Button(actions, text=_shape("פתח משרה"), command=self._open_job).pack(side="right", padx=6)
        self.status_var = tk.StringVar(value=_shape("מוכן"))
        ttk.Label(actions, textvariable=self.status_var, font=self.font).pack(side="left")

        results = ttk.Frame(outer)
        results.pack(side="top", fill="both", expand=True)

        ttk.Label(results, text=_shape("תוצאות"), font=self.font).pack(side="top", anchor="w")
        # tk.Frame, not ttk: only tk.Frame honors an explicit height, which
        # stops the Treeview from inflating the window on system Tk.
        tree_holder = tk.Frame(results, width=640, height=150, borderwidth=0, highlightthickness=0)
        tree_holder.pack(side="top", fill="both", expand=True, pady=(2, 0))
        tree_holder.pack_propagate(False)
        columns = ("percent", "title", "company", "location")
        self.tree = ttk.Treeview(tree_holder, columns=columns, show="headings", height=6)
        self.tree.column("#0", width=0, minwidth=0, stretch=False)
        for key, label, width in (
            ("percent", "אחוז", 64),
            ("title", "משרה", 260),
            ("company", "חברה", 150),
            ("location", "מיקום", 140),
        ):
            self.tree.heading(key, text=_shape(label))
            self.tree.column(key, width=width, minwidth=40, anchor="e", stretch=True)
        tree_scroll = ttk.Scrollbar(tree_holder, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=tree_scroll.set)
        tree_scroll.pack(side="right", fill="y")
        self.tree.pack(side="left", fill="both", expand=True)
        self.tree.bind("<<TreeviewSelect>>", self._on_select)

        ttk.Label(results, text=_shape("פרטי המשרה"), font=self.font).pack(
            side="top", anchor="w", pady=(8, 2)
        )
        text_holder = tk.Frame(results, width=640, height=120, borderwidth=0, highlightthickness=0)
        text_holder.pack(side="top", fill="both", expand=True)
        text_holder.pack_propagate(False)
        self.detail = tk.Text(text_holder, wrap="word", font=self.font, height=6, borderwidth=1)
        detail_scroll = ttk.Scrollbar(text_holder, orient="vertical", command=self.detail.yview)
        self.detail.configure(yscrollcommand=detail_scroll.set)
        detail_scroll.pack(side="right", fill="y")
        self.detail.pack(side="left", fill="both", expand=True)

        self.report_var = tk.StringVar(value="")
        ttk.Label(results, textvariable=self.report_var, font=self.font, wraplength=640).pack(
            side="top", fill="x", pady=(6, 0)
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
