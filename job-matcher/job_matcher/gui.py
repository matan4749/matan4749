from __future__ import annotations

import json
import queue
import re
import subprocess
import sys
import threading
import time
import tkinter as tk
import tkinter.font as tkfont
from pathlib import Path
from tkinter import filedialog, messagebox

# Forced colors. Apple's system Tk paints themed widgets as empty space, and
# dark mode paints light text on a white window. Every control below sets its
# own foreground and background so the form stays visible.
BG = "#070b14"
PANEL = "#121826"
FIELD = "#0c121c"
TEXT = "#e8f0ff"
MUTED = "#93a4c3"
ACCENT = "#3d7eff"
ACCENT_HOT = "#6aa2ff"
EDGE = "#2c3a52"
GHOST = "#182338"
GHOST_HOT = "#22304a"

STATE_PATH = Path.home() / ".job-matcher" / "state.json"

from job_matcher.cv_parser import CvReadError, parse_cv
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


class GlassButton(tk.Canvas):
    """Rounded button drawn on a canvas. Classic Tk buttons stay gray and flat."""

    def __init__(
        self,
        parent: tk.Misc,
        text: str,
        command,
        font,
        *,
        accent: bool = False,
    ) -> None:
        self._accent = accent
        self._enabled = True
        self._hover = False
        self._command = command
        self._label = text
        self._font = font
        width = self._measure(text, font)
        super().__init__(
            parent,
            width=width,
            height=34,
            bg=_widget_bg(parent),
            highlightthickness=0,
            bd=0,
            cursor="hand2",
        )
        self.bind("<Button-1>", self._click)
        self.bind("<Enter>", self._enter)
        self.bind("<Leave>", self._leave)
        self.bind("<Configure>", self._draw)
        self._draw()

    @staticmethod
    def _measure(text: str, font) -> int:
        try:
            pixels = tkfont.Font(font=font).measure(text)
        except tk.TclError:
            pixels = len(text) * 9
        return max(84, min(196, pixels + 32))

    def set_enabled(self, enabled: bool) -> None:
        self._enabled = enabled
        tk.Canvas.configure(self, cursor="hand2" if enabled else "arrow")
        self._draw()

    def configure(self, cnf=None, **kwargs):
        if isinstance(cnf, dict) and "state" in cnf:
            cnf = dict(cnf)
            self.set_enabled(str(cnf.pop("state")) != "disabled")
        if "state" in kwargs:
            self.set_enabled(str(kwargs.pop("state")) != "disabled")
        if cnf or kwargs:
            return tk.Canvas.configure(self, cnf, **kwargs)
        if cnf is None and not kwargs:
            return tk.Canvas.configure(self)
        return None

    def _click(self, _event=None) -> None:
        if self._enabled and self._command is not None:
            self._command()

    def _enter(self, _event=None) -> None:
        self._hover = True
        self._draw()

    def _leave(self, _event=None) -> None:
        self._hover = False
        self._draw()

    def _colors(self) -> tuple[str, str, str]:
        if not self._enabled:
            return "#1c2433", "#2a3548", "#6d7b93"
        if self._accent:
            fill = ACCENT_HOT if self._hover else ACCENT
            return fill, fill, "#f7fbff"
        fill = GHOST_HOT if self._hover else GHOST
        return fill, "#4c6fa8", TEXT

    def _draw(self, event=None) -> None:
        self.delete("all")
        width = event.width if event is not None else self.winfo_width()
        height = event.height if event is not None else self.winfo_height()
        if width < 8:
            width = int(self["width"])
        if height < 8:
            height = int(self["height"])
        fill, outline, fg = self._colors()
        radius = 8
        points = [
            radius, 1,
            width - radius, 1,
            width - 2, 1,
            width - 2, radius,
            width - 2, height - radius,
            width - 2, height - 2,
            width - radius, height - 2,
            radius, height - 2,
            2, height - 2,
            2, height - radius,
            2, radius,
            2, 1,
        ]
        self.create_polygon(points, smooth=True, fill=fill, outline=outline, width=1)
        self.create_text(width / 2, height / 2, text=self._label, fill=fg, font=self._font)


def _widget_bg(widget: tk.Misc) -> str:
    try:
        return str(widget.cget("bg"))
    except tk.TclError:
        return BG


class JobMatcherApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("Job Matcher")
        self.root.configure(bg=BG)
        self.font = self._pick_font(12)
        self.font_bold = self._pick_font(16, "bold")
        self.font_url = self._pick_font(14)
        self.queue: queue.Queue = queue.Queue()
        self.visible = []
        self.markdown_path = ""
        self.html_path = ""
        self._running = False
        self._started = 0.0
        self._fraction = 0.0
        self._build()
        self._load_state()
        # Size from the screen only. Flushing the event queue before the
        # window loop starts leaves a permanently blank window on macOS.
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
        width = min(1000, max(760, screen_w - 60))
        height = min(920, max(700, screen_h - 100))
        if width > screen_w - 20:
            width = max(320, screen_w - 20)
        if height > screen_h - 80:
            height = max(320, screen_h - 80)
        x = max(20, (screen_w - width) // 2)
        self.root.geometry(f"{int(width)}x{int(height)}+{int(x)}+40")

    def _label(self, parent: tk.Misc, text: str, *, bold: bool = False, muted: bool = False) -> tk.Label:
        return tk.Label(
            parent,
            text=_shape(text),
            bg=_widget_bg(parent),
            fg=MUTED if muted else TEXT,
            font=self.font_bold if bold else self.font,
            anchor="w",
            justify="left",
        )

    def _panel(self, parent: tk.Misc) -> tk.Frame:
        return tk.Frame(
            parent,
            bg=PANEL,
            highlightbackground=EDGE,
            highlightthickness=1,
            bd=0,
            padx=10,
            pady=6,
        )

    def _entry(self, parent: tk.Misc, variable: tk.Variable, font=None) -> tk.Entry:
        return tk.Entry(
            parent,
            textvariable=variable,
            bg=FIELD,
            fg=TEXT,
            insertbackground=TEXT,
            disabledbackground=FIELD,
            disabledforeground=MUTED,
            font=font or self.font,
            relief="flat",
            highlightbackground=EDGE,
            highlightcolor=ACCENT,
            highlightthickness=1,
        )

    def _button(self, parent: tk.Misc, text: str, command, *, accent: bool = False) -> GlassButton:
        return GlassButton(parent, _shape(text), command, self.font, accent=accent)

    def _readout(self, parent: tk.Misc, height: int) -> tk.Text:
        widget = tk.Text(
            parent,
            wrap="word",
            font=self.font,
            height=height,
            bg=FIELD,
            fg=TEXT,
            insertbackground=TEXT,
            relief="flat",
            highlightbackground=EDGE,
            highlightthickness=1,
            padx=6,
            pady=4,
        )
        return widget

    def _fill_readout(self, widget: tk.Text, text: str) -> None:
        widget.configure(state="normal")
        widget.delete("1.0", "end")
        widget.insert("1.0", text)
        widget.configure(state="disabled")

    def _build(self) -> None:
        pad = tk.Frame(self.root, bg=BG, padx=14, pady=8)
        pad.pack(side="top", fill="both", expand=True)

        self._label(pad, "התאמת משרות", bold=True).pack(anchor="w")
        self._label(
            pad,
            "משווים דרישות ממשרות ציבוריות לקורות החיים, אצלכם במחשב.",
            muted=True,
        ).pack(anchor="w", pady=(0, 6))

        url_card = self._panel(pad)
        url_card.pack(fill="x", pady=(0, 6))
        self._label(url_card, "לוח משרות").pack(anchor="w")
        self._label(url_card, "הדבק כאן כתובת http או https של לוח המשרות.", muted=True).pack(
            anchor="w", pady=(0, 4)
        )
        self.url_var = tk.StringVar()
        self.url_entry = self._entry(url_card, self.url_var, self.font_url)
        self.url_entry.pack(fill="x", ipady=4)
        self.url_entry.bind("<Return>", lambda _event: self.run_clicked())

        cv_card = self._panel(pad)
        cv_card.pack(fill="x", pady=(0, 6))
        self._label(cv_card, "קורות חיים").pack(anchor="w")
        cv_row = tk.Frame(cv_card, bg=PANEL)
        cv_row.pack(fill="x", pady=(4, 6))
        self._button(cv_row, "עיון…", self._pick_cv).pack(side="right")
        self.cv_var = tk.StringVar()
        self.cv_entry = self._entry(cv_row, self.cv_var)
        self.cv_entry.pack(side="left", fill="x", expand=True, padx=(0, 8), ipady=3)
        self.cv_entry.bind("<FocusOut>", lambda _event: self._show_cv(self.cv_var.get()))
        self.cv_entry.bind("<Return>", lambda _event: self._show_cv(self.cv_var.get()))
        self._label(cv_card, "תצוגה מקדימה", muted=True).pack(anchor="w")
        self.cv_preview = self._readout(cv_card, 3)
        self.cv_preview.pack(fill="x", pady=(2, 0))
        self._show_cv("")

        options = tk.Frame(pad, bg=BG)
        options.pack(fill="x", pady=(0, 6))
        self._label(options, "סף התאמה %").pack(side="left")
        self.threshold_var = tk.IntVar(value=50)
        tk.Spinbox(
            options,
            from_=0,
            to=100,
            textvariable=self.threshold_var,
            width=5,
            font=self.font,
            bg=FIELD,
            fg=TEXT,
            buttonbackground=PANEL,
            insertbackground=TEXT,
            highlightbackground=EDGE,
            highlightthickness=1,
            relief="flat",
        ).pack(side="left", padx=(8, 16))
        self._label(options, "תיקיית דוח").pack(side="left")
        self.out_var = tk.StringVar(value=str(self._default_out()))
        self._entry(options, self.out_var).pack(side="left", fill="x", expand=True, padx=8, ipady=3)
        self._button(options, "בחירה…", self._pick_out).pack(side="right")

        actions = tk.Frame(pad, bg=BG)
        actions.pack(fill="x", pady=(0, 6))
        self.run_button = self._button(actions, "הרץ התאמה", self.run_clicked, accent=True)
        self.run_button.pack(side="right")
        self._button(actions, "פתח דוח", self._open_html).pack(side="right", padx=8)
        self._button(actions, "פתח משרה", self._open_job).pack(side="right", padx=(0, 8))
        self._button(actions, "נקה", self._clear_run).pack(side="right", padx=(0, 8))

        progress_card = self._panel(pad)
        progress_card.pack(fill="x", pady=(0, 6))
        meta = tk.Frame(progress_card, bg=PANEL)
        meta.pack(fill="x")
        self.elapsed_var = tk.StringVar(value="0:00")
        self.jobs_var = tk.StringVar(value=_shape("נמצאו 0"))
        tk.Label(meta, textvariable=self.elapsed_var, bg=PANEL, fg=TEXT, font=self.font).pack(side="right")
        tk.Label(meta, textvariable=self.jobs_var, bg=PANEL, fg=TEXT, font=self.font).pack(side="right", padx=(0, 16))
        self.status_var = tk.StringVar(value=_shape("מוכן"))
        tk.Label(
            meta,
            textvariable=self.status_var,
            bg=PANEL,
            fg=MUTED,
            font=self.font,
            anchor="w",
        ).pack(side="left", fill="x", expand=True)
        self.progress = tk.Canvas(
            progress_card,
            height=10,
            bg=FIELD,
            highlightthickness=0,
            bd=0,
        )
        self.progress.pack(fill="x", pady=(8, 0))
        self.progress.bind("<Configure>", self._draw_bar)
        self._draw_bar()

        live_card = self._panel(pad)
        live_card.pack(fill="x", pady=(0, 6))
        self._label(live_card, "העמוד שנשלף עכשיו", muted=True).pack(anchor="w")
        self.live_url = tk.StringVar(value="")
        tk.Label(
            live_card,
            textvariable=self.live_url,
            bg=PANEL,
            fg=ACCENT_HOT,
            font=self.font,
            anchor="w",
            justify="left",
            wraplength=760,
        ).pack(fill="x", pady=(2, 4))
        self.live_snippet = self._readout(live_card, 2)
        self.live_snippet.pack(fill="x")
        self._set_snippet("מחכה לשליפה.")

        split = tk.Frame(pad, bg=BG)
        split.pack(fill="both", expand=True)
        left = tk.Frame(split, bg=BG)
        left.pack(side="left", fill="both", expand=True, padx=(0, 8))
        right = tk.Frame(split, bg=BG)
        right.pack(side="left", fill="both", expand=True)

        self._label(left, "תוצאות").pack(anchor="w")
        list_row = tk.Frame(left, bg=BG)
        list_row.pack(fill="both", expand=True)
        scroll = tk.Scrollbar(
            list_row,
            bg=PANEL,
            troughcolor=BG,
            activebackground=ACCENT,
            highlightthickness=0,
            bd=0,
        )
        scroll.pack(side="right", fill="y")
        self.results = tk.Listbox(
            list_row,
            font=self.font,
            height=6,
            bg=FIELD,
            fg=TEXT,
            selectbackground=ACCENT,
            selectforeground="#ffffff",
            activestyle="dotbox",
            exportselection=False,
            relief="flat",
            highlightbackground=EDGE,
            highlightthickness=1,
            yscrollcommand=scroll.set,
        )
        self.results.pack(side="left", fill="both", expand=True)
        scroll.configure(command=self.results.yview)
        self.results.bind("<<ListboxSelect>>", self._on_select)

        self._label(right, "פרטי המשרה").pack(anchor="w")
        text_row = tk.Frame(right, bg=BG)
        text_row.pack(fill="both", expand=True)
        detail_scroll = tk.Scrollbar(
            text_row,
            bg=PANEL,
            troughcolor=BG,
            activebackground=ACCENT,
            highlightthickness=0,
            bd=0,
        )
        detail_scroll.pack(side="right", fill="y")
        self.detail = self._readout(text_row, 6)
        self.detail.configure(state="normal", yscrollcommand=detail_scroll.set)
        self.detail.pack(side="left", fill="both", expand=True)
        detail_scroll.configure(command=self.detail.yview)

        self.report_var = tk.StringVar(value="")
        tk.Label(
            pad,
            textvariable=self.report_var,
            bg=BG,
            fg=MUTED,
            font=self.font,
            wraplength=780,
            justify="left",
            anchor="w",
        ).pack(fill="x", pady=(6, 0))

    def _draw_bar(self, event=None) -> None:
        width = event.width if event is not None else self.progress.winfo_width()
        height = event.height if event is not None else self.progress.winfo_height()
        if width < 4:
            width = 480
        if height < 4:
            height = 10
        self.progress.delete("bar")
        self.progress.create_rectangle(0, 0, width, height, fill="#172033", outline="", tags="bar")
        filled = max(0, int(width * self._fraction))
        if filled > 0:
            self.progress.create_rectangle(0, 0, filled, height, fill=ACCENT, outline="", tags="bar")

    def _set_snippet(self, text: str) -> None:
        cleaned = re.sub(r"\s+", " ", text or "").strip()
        self._fill_readout(self.live_snippet, _shape(cleaned or "מחכה לשליפה."))

    def _show_cv(self, path: str) -> None:
        path = (path or "").strip()
        file = Path(path) if path else None
        if file is None or not file.is_file():
            self._fill_readout(self.cv_preview, _shape("לא נבחר קובץ."))
            return
        kind = {".pdf": "PDF", ".docx": "DOCX", ".txt": "TXT"}.get(file.suffix.lower(), "FILE")
        if file.suffix.lower() not in {".pdf", ".docx", ".txt"}:
            self._fill_readout(
                self.cv_preview,
                _shape_block(f"{file.name}\n{kind}\nבחרו קובץ PDF, DOCX או TXT."),
            )
            return
        try:
            profile = parse_cv(file)
        except CvReadError as exc:
            body = f"{file.name}\n{kind}\n{exc}"
        else:
            excerpt = re.sub(r"\s+", " ", profile.text).strip()[:420]
            body = f"{file.name}  ·  {kind}\n{excerpt}"
        self._fill_readout(self.cv_preview, _shape_block(body))

    def _default_out(self) -> Path:
        documents = Path.home() / "Documents"
        base = documents if documents.is_dir() else Path.home()
        return base / "job-matcher-reports"

    def _load_state(self) -> None:
        try:
            data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        if not isinstance(data, dict):
            return
        url = data.get("url")
        if isinstance(url, str) and url.strip():
            self.url_var.set(url.strip())
        out = data.get("out")
        if isinstance(out, str) and out.strip():
            self.out_var.set(out.strip())
        cv = data.get("cv")
        if isinstance(cv, str) and cv.strip():
            self.cv_var.set(cv.strip())
            self._show_cv(cv.strip())
        try:
            threshold = int(data.get("threshold"))
        except (TypeError, ValueError):
            threshold = None
        if threshold is not None and 0 <= threshold <= 100:
            try:
                self.threshold_var.set(threshold)
            except tk.TclError:
                pass

    def _remember(self) -> None:
        payload = {
            "url": self.url_var.get().strip(),
            "cv": self.cv_var.get().strip(),
            "out": self.out_var.get().strip(),
            "threshold": 50,
        }
        try:
            payload["threshold"] = int(self.threshold_var.get())
        except (tk.TclError, TypeError, ValueError):
            pass
        try:
            STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
            STATE_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        except OSError:
            pass

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
            self._show_cv(chosen)
            self._remember()

    def _pick_out(self) -> None:
        chosen = filedialog.askdirectory(title=_shape("תיקיית שמירה"))
        if chosen:
            self.out_var.set(chosen)
            self._remember()

    def _clear_run(self) -> None:
        self._running = False
        self.visible = []
        self.markdown_path = ""
        self.html_path = ""
        self.results.delete(0, "end")
        self.detail.configure(state="normal")
        self.detail.delete("1.0", "end")
        self.report_var.set("")
        self.status_var.set(_shape("מוכן"))
        self.jobs_var.set(_shape("נמצאו 0"))
        self.elapsed_var.set("0:00")
        self.live_url.set("")
        self._set_snippet("מחכה לשליפה.")
        self._fraction = 0.0
        self._draw_bar()

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
        self._show_cv(str(cv_path))
        self._remember()
        self.run_button.configure(state="disabled")
        self._running = True
        self._started = time.monotonic()
        self._fraction = 0.04
        self._draw_bar()
        self.jobs_var.set(_shape("נמצאו 0"))
        self.elapsed_var.set("0:00")
        self.status_var.set(_shape("מתחיל…"))
        self.live_url.set(url)
        self._set_snippet("מתחיל שליפה…")
        self.detail.configure(state="normal")
        self.detail.delete("1.0", "end")

        def worker() -> None:
            try:
                result = run_match(
                    url=url,
                    cv_path=cv_path,
                    threshold=threshold,
                    out_dir=out_dir,
                    progress=lambda message: self.queue.put(("progress", message)),
                    watch=lambda event: self.queue.put(("watch", event)),
                )
            except CvReadError as exc:
                self.queue.put(("err", str(exc)))
            except Exception as exc:
                self.queue.put(("err", f"הריצה נכשלה: {exc}"))
            else:
                self.queue.put(("ok", result))

        threading.Thread(target=worker, daemon=True).start()

    def present(self, result) -> None:
        if self._running and self._started:
            self.elapsed_var.set(self._clock())
        self._running = False
        self._fraction = 1.0
        self._draw_bar()
        self.jobs_var.set(_shape(f"נמצאו {len(result.jobs)}"))
        self.visible = result.included_jobs()
        self.markdown_path = result.markdown_path
        self.html_path = result.html_path
        self.results.delete(0, "end")
        for scored in self.visible:
            job = scored.job
            company = job.company or "—"
            location = job.location or ""
            # Percent stays at the start. Shaping the whole line would move it.
            self.results.insert(
                "end",
                f"{scored.match_percent}%   {_shape(job.title)}   {_shape(company)}   {_shape(location)}",
            )
        below = len(result.below_threshold())
        unscored = len(result.unscored())
        if result.errors and not self.visible:
            status = "השליפה נעצרה. הפירוט בפרטי המשרה."
        elif not self.visible:
            status = f"אין משרות מעל {result.threshold}%. מתחת לסף: {below}. בלי ציון: {unscored}."
        else:
            status = (
                f"{len(self.visible)} משרות מעל {result.threshold}%, "
                f"לפי אחוז. מתחת לסף: {below}. בלי ציון: {unscored}."
            )
        self.status_var.set(_shape(status))
        self.report_var.set(f"נשמר  {result.markdown_path}    {result.html_path}")
        self.detail.configure(state="normal")
        if self.visible:
            self.results.selection_clear(0, "end")
            self.results.selection_set(0)
            self.results.activate(0)
            self._show(0)
        elif result.errors or result.notes:
            self.detail.delete("1.0", "end")
            self.detail.insert("1.0", _shape_block("\n".join(result.errors + result.notes)))
        self.run_button.configure(state="normal")

    def _show(self, index: int) -> None:
        if index < 0 or index >= len(self.visible):
            return
        self.detail.configure(state="normal")
        self.detail.delete("1.0", "end")
        self.detail.insert("1.0", _shape_block(format_job_plain(self.visible[index])))
        self.detail.see("1.0")

    def _on_select(self, _event=None) -> None:
        selected = self.results.curselection()
        if not selected:
            return
        self._show(int(selected[0]))

    def _apply_watch(self, event: dict) -> None:
        url = str(event.get("url") or "")
        if len(url) > 110:
            url = url[:107] + "…"
        if url:
            self.live_url.set(url)
        snippet = str(event.get("snippet") or "")
        if snippet:
            self._set_snippet(snippet)
        jobs = event.get("jobs")
        if jobs is not None:
            self.jobs_var.set(_shape(f"נמצאו {int(jobs)}"))
        fraction = event.get("fraction")
        if fraction is not None:
            self._fraction = max(0.0, min(1.0, float(fraction)))
            self._draw_bar()

    def _clock(self) -> str:
        seconds = max(0, int(time.monotonic() - self._started))
        return f"{seconds // 60}:{seconds % 60:02d}"

    def _poll(self) -> None:
        if self._running:
            self.elapsed_var.set(self._clock())
        try:
            while True:
                kind, payload = self.queue.get_nowait()
                if kind == "progress":
                    self.status_var.set(_shape(str(payload)))
                elif kind == "watch":
                    self._apply_watch(payload)
                elif kind == "ok":
                    self.present(payload)
                elif kind == "err":
                    self._running = False
                    self.run_button.configure(state="normal")
                    self.status_var.set(_shape("הריצה נעצרה"))
                    self._set_snippet(str(payload))
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
