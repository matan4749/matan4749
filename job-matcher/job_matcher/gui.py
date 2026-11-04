from __future__ import annotations

import queue
import sys
import threading
import time
from pathlib import Path

from Cocoa import (
    NSAlert,
    NSApp,
    NSApplication,
    NSApplicationActivationPolicyRegular,
    NSAppearance,
    NSAppearanceNameDarkAqua,
    NSAttributedString,
    NSBackingStoreBuffered,
    NSBezelStyleRounded,
    NSBox,
    NSBoxCustom,
    NSColor,
    NSFocusRingTypeNone,
    NSFont,
    NSFontAttributeName,
    NSForegroundColorAttributeName,
    NSIndexSet,
    NSLineBorder,
    NSMakePoint,
    NSMakeRect,
    NSMakeSize,
    NSMenu,
    NSMenuItem,
    NSModalResponseOK,
    NSMutableParagraphStyle,
    NSNoTitle,
    NSObject,
    NSOpenPanel,
    NSParagraphStyleAttributeName,
    NSProgressIndicator,
    NSProgressIndicatorBarStyle,
    NSScreen,
    NSScrollView,
    NSScrollerKnobStyleLight,
    NSTableColumn,
    NSTableView,
    NSTableViewLastColumnOnlyAutoresizingStyle,
    NSTextAlignmentCenter,
    NSTextField,
    NSTextFieldRoundedBezel,
    NSTextView,
    NSTimer,
    NSView,
    NSURL,
    NSViewHeightSizable,
    NSViewWidthSizable,
    NSVisualEffectBlendingModeWithinWindow,
    NSVisualEffectMaterialHUDWindow,
    NSVisualEffectStateActive,
    NSVisualEffectView,
    NSWindow,
    NSWindowStyleMaskClosable,
    NSWindowStyleMaskMiniaturizable,
    NSWindowStyleMaskResizable,
    NSWindowStyleMaskTitled,
    NSWorkspace,
)
from PyObjCTools import AppHelper

from job_matcher.cv_parser import CvReadError
from job_matcher.pipeline import run_match, validate_http_url
from job_matcher.present import (
    cv_preview_text,
    default_out_dir,
    detail_text,
    jobs_found_label,
    layout_frames,
    load_state,
    result_lines,
    save_state,
    status_text,
    watch_view,
)

# Native macOS window. Apple's older window toolkit draws a blank white pane
# on the Mac mini, so every control here is AppKit.


def _color(red: int, green: int, blue: int, alpha: float = 1.0):
    return NSColor.colorWithCalibratedRed_green_blue_alpha_(red / 255.0, green / 255.0, blue / 255.0, alpha)


NAVY = CARD = FIELD = TEXT = MUTED = ACCENT = ACCENT_DIM = GHOST = GHOST_DIM = EDGE = WHITE = None


def _ensure_colors() -> None:
    """NSColor is only safe after NSApplication exists."""
    global NAVY, CARD, FIELD, TEXT, MUTED, ACCENT, ACCENT_DIM, GHOST, GHOST_DIM, EDGE, WHITE
    if NAVY is not None:
        return
    NAVY = _color(7, 11, 20)
    CARD = _color(18, 24, 38, 0.92)
    FIELD = _color(12, 18, 28)
    TEXT = _color(232, 240, 255)
    MUTED = _color(147, 164, 195)
    ACCENT = _color(61, 126, 255)
    ACCENT_DIM = _color(36, 58, 102)
    GHOST = _color(24, 35, 56)
    GHOST_DIM = _color(20, 26, 38)
    EDGE = _color(44, 58, 82)
    WHITE = _color(247, 251, 255)

_KEEP: dict = {}


def _title(text: str, color: NSColor, size: float = 13) -> NSAttributedString:
    style = NSMutableParagraphStyle.alloc().init()
    style.setAlignment_(NSTextAlignmentCenter)
    return NSAttributedString.alloc().initWithString_attributes_(
        text,
        {
            NSFontAttributeName: NSFont.systemFontOfSize_(size),
            NSForegroundColorAttributeName: color,
            NSParagraphStyleAttributeName: style,
        },
    )


class JobMatcherWindow(NSObject):
    def applicationDidFinishLaunching_(self, _notification) -> None:
        self.show()

    def applicationShouldTerminateAfterLastWindowClosed_(self, _sender) -> bool:
        return True

    def show(self) -> None:
        if getattr(self, "_shown", False):
            return
        self._shown = True
        _ensure_colors()
        self.lines: list[str] = []
        self.visible = []
        self.queue: queue.Queue = queue.Queue()
        self.running = False
        self.started = 0.0
        self.markdown_path = ""
        self.html_path = ""
        self._ready = False
        self._scrolled = False
        self.views = {}
        self.buttons = {}
        self._build()
        self._ready = True
        self.window.makeKeyAndOrderFront_(None)
        self.layout(scroll=True)
        NSApp.activateIgnoringOtherApps_(True)

    def windowDidResize_(self, _notification) -> None:
        if getattr(self, "_ready", False):
            self.layout(scroll=False)

    def windowWillClose_(self, _notification) -> None:
        timer = getattr(self, "timer", None)
        if timer is not None:
            timer.invalidate()

    def _build(self) -> None:
        screen = NSScreen.mainScreen()
        if screen is None:
            visible_w, visible_h, base_x, base_y = 1440.0, 900.0, 0.0, 0.0
        else:
            frame = screen.visibleFrame()
            visible_w, visible_h = frame.size.width, frame.size.height
            base_x, base_y = frame.origin.x, frame.origin.y
        width = min(1040, max(780, visible_w - 80))
        height = min(900, max(680, visible_h - 90))
        origin_x = base_x + max(20, (visible_w - width) / 2)
        origin_y = base_y + max(20, (visible_h - height) / 2)
        style = (
            NSWindowStyleMaskTitled
            | NSWindowStyleMaskClosable
            | NSWindowStyleMaskMiniaturizable
            | NSWindowStyleMaskResizable
        )
        self.window = NSWindow.alloc().initWithContentRect_styleMask_backing_defer_(
            NSMakeRect(origin_x, origin_y, width, height),
            style,
            NSBackingStoreBuffered,
            False,
        )
        self.window.setTitle_("Job Matcher")
        self.window.setMinSize_(NSMakeSize(760, 620))
        self.window.setBackgroundColor_(NAVY)
        self.window.setDelegate_(self)
        content = self.window.contentView()
        appearance = NSAppearance.appearanceNamed_(NSAppearanceNameDarkAqua)
        self.appearance = appearance
        if appearance is not None:
            self.window.setAppearance_(appearance)
            content.setAppearance_(appearance)
        self.effect = NSVisualEffectView.alloc().initWithFrame_(content.bounds())
        self.effect.setMaterial_(NSVisualEffectMaterialHUDWindow)
        self.effect.setBlendingMode_(NSVisualEffectBlendingModeWithinWindow)
        self.effect.setState_(NSVisualEffectStateActive)
        self.effect.setAutoresizingMask_(NSViewWidthSizable | NSViewHeightSizable)
        content.addSubview_(self.effect)

        self.scroll = self._scroll(content.bounds())
        self.scroll.setAutoresizingMask_(NSViewWidthSizable | NSViewHeightSizable)
        content.addSubview_(self.scroll)
        self.doc = NSView.alloc().initWithFrame_(content.bounds())
        self.scroll.setDocumentView_(self.doc)

        self._card("url_card")
        self._card("cv_card")
        self._card("progress_card")
        self._card("live_card")

        self._label("title", "התאמת משרות", 22, bold=True, color=TEXT)
        self._label("subtitle", "משווים דרישות ממשרות ציבוריות לקורות החיים, אצלכם במחשב.", 13, color=MUTED)
        self._label("url_label", "לוח משרות", 14, bold=True, color=TEXT)
        self._label("url_hint", "הדבק כאן כתובת http או https של לוח המשרות.", 12, color=MUTED)
        self.url_field = self._field(16)
        self.url_field.setPlaceholderString_("https://")
        self.url_field.setDelegate_(self)
        self.url_field.setTarget_(self)
        self.url_field.setAction_("runClicked:")
        self.views["url_field"] = self.url_field
        self.doc.addSubview_(self.url_field)

        self._label("cv_label", "קורות חיים", 14, bold=True, color=TEXT)
        self.cv_field = self._field(13)
        self.cv_field.setDelegate_(self)
        self.views["cv_field"] = self.cv_field
        self.doc.addSubview_(self.cv_field)
        self._button("cv_button", "עיון…", "pickCv:", GHOST, TEXT)
        self._label("preview_label", "תצוגה מקדימה", 12, color=MUTED)
        self.preview_scroll, self.preview = self._reader()
        self.views["preview"] = self.preview_scroll
        self.doc.addSubview_(self.preview_scroll)

        self._label("threshold_label", "סף התאמה %", 13, color=TEXT)
        self.threshold_field = self._field(13)
        self.threshold_field.setStringValue_("50")
        self.threshold_field.setDelegate_(self)
        self.views["threshold_field"] = self.threshold_field
        self.doc.addSubview_(self.threshold_field)
        self._label("out_label", "תיקיית דוח", 13, color=TEXT)
        self.out_field = self._field(13)
        self.out_field.setStringValue_(str(default_out_dir()))
        self.out_field.setDelegate_(self)
        self.views["out_field"] = self.out_field
        self.doc.addSubview_(self.out_field)
        self._button("out_button", "בחירה…", "pickOut:", GHOST, TEXT)

        self._button("clear", "נקה", "clearClicked:", GHOST, TEXT)
        self._button("open_job", "פתח משרה", "openJob:", GHOST, TEXT)
        self._button("open_report", "פתח דוח", "openReport:", GHOST, TEXT)
        self._button("run", "הרץ התאמה", "runClicked:", ACCENT, WHITE, accent=True)

        self._label("status", "מוכן", 12, color=MUTED)
        self._label("jobs", "נמצאו 0", 13, color=TEXT)
        self._label("elapsed", "0:00", 13, color=TEXT)
        self.bar = NSProgressIndicator.alloc().initWithFrame_(NSMakeRect(0, 0, 10, 12))
        self.bar.setStyle_(NSProgressIndicatorBarStyle)
        self.bar.setIndeterminate_(False)
        self.bar.setMinValue_(0.0)
        self.bar.setMaxValue_(1.0)
        self.bar.setDoubleValue_(0.0)
        self.views["bar"] = self.bar
        self.doc.addSubview_(self.bar)

        self._label("live_label", "העמוד שנשלף עכשיו", 12, color=MUTED)
        self.live_url = self._label_view("live_url", "", 13, ACCENT)
        self.views["live_url"] = self.live_url
        self.live_url.setSelectable_(True)
        self.live_scroll, self.live_snippet = self._reader()
        self.views["live_snippet"] = self.live_scroll
        self.doc.addSubview_(self.live_scroll)

        self._label("results_label", "תוצאות", 14, bold=True, color=TEXT)
        self._label("detail_label", "פרטי המשרה", 14, bold=True, color=TEXT)
        self.results_scroll, self.table = self._table()
        self.views["results"] = self.results_scroll
        self.doc.addSubview_(self.results_scroll)
        self.detail_scroll, self.detail = self._reader()
        self.views["detail"] = self.detail_scroll
        self.doc.addSubview_(self.detail_scroll)
        self.report_label = self._label_view("report", "", 12, MUTED)
        self.views["report"] = self.report_label
        self.report_label.setSelectable_(True)

        self._set_text(self.preview, "לא נבחר קובץ.")
        self._set_text(self.live_snippet, "מחכה לשליפה.")
        self._load()
        self.timer = NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
            0.2, self, "tick:", None, True
        )

    def _scroll(self, frame):
        scroll = NSScrollView.alloc().initWithFrame_(frame)
        scroll.setHasVerticalScroller_(True)
        scroll.setAutohidesScrollers_(True)
        scroll.setDrawsBackground_(False)
        scroll.setBorderType_(0)
        scroll.setScrollerKnobStyle_(NSScrollerKnobStyleLight)
        clip = scroll.contentView()
        clip.setDrawsBackground_(False)
        try:
            clip.setBackgroundColor_(NAVY)
        except AttributeError:
            pass
        self._apply_appearance(scroll)
        return scroll

    def _apply_appearance(self, view) -> None:
        appearance = getattr(self, "appearance", None)
        if appearance is not None and view is not None:
            try:
                view.setAppearance_(appearance)
            except AttributeError:
                pass

    def _card(self, name: str) -> None:
        box = NSBox.alloc().initWithFrame_(NSMakeRect(0, 0, 10, 10))
        box.setBoxType_(NSBoxCustom)
        box.setTitlePosition_(NSNoTitle)
        box.setBorderType_(NSLineBorder)
        box.setBorderWidth_(1)
        box.setFillColor_(CARD)
        box.setBorderColor_(EDGE)
        box.setContentViewMargins_(NSMakeSize(0, 0))
        try:
            box.setCornerRadius_(14)
        except AttributeError:
            pass
        self.views[name] = box
        self.doc.addSubview_(box)

    def _label(self, name: str, text: str, size: float, bold: bool = False, color: NSColor = TEXT) -> None:
        self.views[name] = self._label_view(name, text, size, color, bold=bold)

    def _label_view(self, name: str, text: str, size: float, color: NSColor, bold: bool = False):
        try:
            field = NSTextField.labelWithString_(text)
        except AttributeError:
            field = NSTextField.alloc().initWithFrame_(NSMakeRect(0, 0, 10, 10))
            field.setStringValue_(text)
            field.setBezeled_(False)
            field.setDrawsBackground_(False)
            field.setEditable_(False)
            field.setSelectable_(False)
        field.setStringValue_(text)
        field.setBezeled_(False)
        field.setDrawsBackground_(False)
        field.setEditable_(False)
        field.setSelectable_(False)
        field.setTextColor_(color)
        field.setFont_(NSFont.boldSystemFontOfSize_(size) if bold else NSFont.systemFontOfSize_(size))
        self._apply_appearance(field)
        try:
            field.cell().setTextColor_(color)
        except AttributeError:
            pass
        self.doc.addSubview_(field)
        return field

    def _field(self, size: float):
        field = NSTextField.alloc().initWithFrame_(NSMakeRect(0, 0, 10, 10))
        field.setBezelStyle_(NSTextFieldRoundedBezel)
        field.setBezeled_(True)
        field.setDrawsBackground_(True)
        field.setBackgroundColor_(FIELD)
        field.setTextColor_(TEXT)
        field.setFont_(NSFont.systemFontOfSize_(size))
        field.setFocusRingType_(NSFocusRingTypeNone)
        self._apply_appearance(field)
        try:
            field.cell().setScrollable_(True)
            field.cell().setTextColor_(TEXT)
        except AttributeError:
            pass
        return field

    def _button(self, name: str, text: str, action: str, fill: NSColor, title_color: NSColor, accent: bool = False) -> None:
        box = NSBox.alloc().initWithFrame_(NSMakeRect(0, 0, 10, 10))
        box.setBoxType_(NSBoxCustom)
        box.setTitlePosition_(NSNoTitle)
        box.setBorderType_(NSLineBorder)
        box.setBorderWidth_(1)
        box.setFillColor_(fill)
        box.setBorderColor_(ACCENT if accent else EDGE)
        box.setContentViewMargins_(NSMakeSize(0, 0))
        try:
            box.setCornerRadius_(8)
        except AttributeError:
            pass
        button = NSButton.alloc().initWithFrame_(NSMakeRect(0, 0, 10, 10))
        button.setBordered_(False)
        button.setBezelStyle_(NSBezelStyleRounded)
        button.setFocusRingType_(NSFocusRingTypeNone)
        button.setAttributedTitle_(_title(text, title_color))
        button.setTarget_(self)
        button.setAction_(action)
        self.buttons[name] = {
            "button": button,
            "box": box,
            "text": text,
            "fill": fill,
            "dim": ACCENT_DIM if accent else GHOST_DIM,
            "title": title_color,
        }
        self.views[name] = button
        self.doc.addSubview_(box)
        self.doc.addSubview_(button)

    def _reader(self):
        scroll = self._scroll(NSMakeRect(0, 0, 10, 10))
        text = NSTextView.alloc().initWithFrame_(NSMakeRect(0, 0, 10, 10))
        text.setEditable_(False)
        text.setSelectable_(True)
        text.setRichText_(False)
        text.setDrawsBackground_(True)
        text.setBackgroundColor_(FIELD)
        text.setTextColor_(TEXT)
        text.setFont_(NSFont.systemFontOfSize_(13))
        self._apply_appearance(text)
        self._apply_appearance(scroll)
        text.setVerticallyResizable_(True)
        text.setHorizontallyResizable_(False)
        text.setAutoresizingMask_(NSViewWidthSizable)
        container = text.textContainer()
        if container is not None:
            container.setWidthTracksTextView_(True)
        scroll.setDocumentView_(text)
        return scroll, text

    def _table(self):
        scroll = self._scroll(NSMakeRect(0, 0, 10, 10))
        table = NSTableView.alloc().initWithFrame_(NSMakeRect(0, 0, 10, 10))
        column = NSTableColumn.alloc().initWithIdentifier_("job")
        column.setEditable_(False)
        try:
            column.dataCell().setTextColor_(TEXT)
            column.dataCell().setFont_(NSFont.systemFontOfSize_(13))
        except AttributeError:
            pass
        table.addTableColumn_(column)
        table.setHeaderView_(None)
        table.setBackgroundColor_(FIELD)
        table.setRowHeight_(28)
        table.setUsesAlternatingRowBackgroundColors_(False)
        table.setColumnAutoresizingStyle_(NSTableViewLastColumnOnlyAutoresizingStyle)
        table.setDataSource_(self)
        table.setDelegate_(self)
        scroll.setDocumentView_(table)
        return scroll, table

    def layout(self, scroll: bool = False) -> None:
        bounds = self.window.contentView().bounds()
        self.effect.setFrame_(bounds)
        self.scroll.setFrame_(bounds)
        width = bounds.size.width
        frames, height = layout_frames(width)
        self.doc.setFrame_(NSMakeRect(0, 0, width, height))
        for name, rect in frames.items():
            view = self.views.get(name)
            if view is not None:
                view.setFrame_(NSMakeRect(*rect))
            meta = self.buttons.get(name)
            if meta is not None:
                meta["box"].setFrame_(NSMakeRect(*rect))
        self._fit_reader(self.preview_scroll, self.preview)
        self._fit_reader(self.live_scroll, self.live_snippet)
        self._fit_reader(self.detail_scroll, self.detail)
        if self.table.tableColumns():
            column = self.table.tableColumns()[0]
            column.setWidth_(max(80, frames["results"][2] - 8))
        if scroll or not self._scrolled:
            self._scroll_to_top(height)
            self._scrolled = True

    def _fit_reader(self, scroll, text) -> None:
        size = scroll.contentSize()
        text.setFrame_(NSMakeRect(0, 0, max(40, size.width), max(20, size.height)))

    def _scroll_to_top(self, doc_height: float) -> None:
        clip = self.scroll.contentView()
        visible = clip.bounds().size.height
        clip.scrollToPoint_(NSMakePoint(0, max(0, doc_height - visible)))
        self.scroll.reflectScrolledClipView_(clip)

    def _set_text(self, view, value: str) -> None:
        view.setString_(value or "")
        view.setFont_(NSFont.systemFontOfSize_(13))
        view.setTextColor_(TEXT)
        view.setBackgroundColor_(FIELD)

    def _set_enabled(self, name: str, enabled: bool) -> None:
        meta = self.buttons[name]
        meta["button"].setEnabled_(enabled)
        meta["box"].setFillColor_(meta["fill"] if enabled else meta["dim"])
        color = meta["title"] if enabled else MUTED
        meta["button"].setAttributedTitle_(_title(meta["text"], color))

    def _load(self) -> None:
        data = load_state()
        url = data.get("url")
        if isinstance(url, str) and url.strip():
            self.url_field.setStringValue_(url.strip())
        out = data.get("out")
        if isinstance(out, str) and out.strip():
            self.out_field.setStringValue_(out.strip())
        cv = data.get("cv")
        if isinstance(cv, str) and cv.strip():
            self.cv_field.setStringValue_(cv.strip())
            self._set_text(self.preview, cv_preview_text(cv.strip()))
        try:
            threshold = int(data.get("threshold"))
        except (TypeError, ValueError):
            threshold = None
        if threshold is not None and 0 <= threshold <= 100:
            self.threshold_field.setStringValue_(str(threshold))

    def _remember(self) -> None:
        try:
            threshold = int(float(self.threshold_field.stringValue()))
        except (TypeError, ValueError):
            threshold = 50
        save_state(
            {
                "url": str(self.url_field.stringValue() or "").strip(),
                "cv": str(self.cv_field.stringValue() or "").strip(),
                "out": str(self.out_field.stringValue() or "").strip(),
                "threshold": threshold,
            }
        )

    def _show_cv(self, path: str) -> None:
        self._set_text(self.preview, cv_preview_text(path))

    def controlTextDidEndEditing_(self, notification) -> None:
        if notification.object() == self.cv_field:
            self._show_cv(str(self.cv_field.stringValue() or ""))
        self._remember()

    def pickCv_(self, _sender) -> None:
        panel = NSOpenPanel.openPanel()
        panel.setCanChooseFiles_(True)
        panel.setCanChooseDirectories_(False)
        panel.setAllowsMultipleSelection_(False)
        panel.setAllowedFileTypes_(["pdf", "docx", "txt"])
        panel.setTitle_("בחירת קורות חיים")
        if panel.runModal() != NSModalResponseOK or not panel.URLs():
            return
        path = str(panel.URLs()[0].path())
        self.cv_field.setStringValue_(path)
        self._show_cv(path)
        self._remember()

    def pickOut_(self, _sender) -> None:
        panel = NSOpenPanel.openPanel()
        panel.setCanChooseFiles_(False)
        panel.setCanChooseDirectories_(True)
        panel.setCanCreateDirectories_(True)
        panel.setAllowsMultipleSelection_(False)
        panel.setTitle_("תיקיית שמירה")
        if panel.runModal() != NSModalResponseOK or not panel.URLs():
            return
        self.out_field.setStringValue_(str(panel.URLs()[0].path()))
        self._remember()

    def clearClicked_(self, _sender) -> None:
        self.running = False
        self.lines = []
        self.visible = []
        self.markdown_path = ""
        self.html_path = ""
        self.table.reloadData()
        self._set_text(self.detail, "")
        self.report_label.setStringValue_("")
        self.views["status"].setStringValue_("מוכן")
        self.views["jobs"].setStringValue_("נמצאו 0")
        self.views["elapsed"].setStringValue_("0:00")
        self.live_url.setStringValue_("")
        self._set_text(self.live_snippet, "מחכה לשליפה.")
        self.bar.setDoubleValue_(0.0)

    def runClicked_(self, _sender) -> None:
        if self.running:
            return
        try:
            url = validate_http_url(str(self.url_field.stringValue() or ""))
        except ValueError as exc:
            self._alert("כתובת", str(exc))
            return
        cv_path = Path(str(self.cv_field.stringValue() or "").strip())
        if cv_path.suffix.lower() not in {".pdf", ".docx", ".txt"} or not cv_path.is_file():
            self._alert("קורות חיים", "בחרו קובץ PDF, DOCX או TXT קיים.")
            return
        try:
            threshold = float(self.threshold_field.stringValue())
        except (TypeError, ValueError):
            self._alert("סף", "הסף צריך להיות מספר בין 0 ל-100.")
            return
        out_dir = Path(str(self.out_field.stringValue() or "").strip() or default_out_dir())
        self._show_cv(str(cv_path))
        self._remember()
        self.running = True
        self.started = time.monotonic()
        self._set_enabled("run", False)
        self.bar.setDoubleValue_(0.04)
        self.views["jobs"].setStringValue_("נמצאו 0")
        self.views["elapsed"].setStringValue_("0:00")
        self.views["status"].setStringValue_("מתחיל…")
        self.live_url.setStringValue_(url)
        self._set_text(self.live_snippet, "מתחיל שליפה…")
        self._set_text(self.detail, "")

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

    def tick_(self, _timer) -> None:
        if self.running:
            seconds = max(0, int(time.monotonic() - self.started))
            self.views["elapsed"].setStringValue_(f"{seconds // 60}:{seconds % 60:02d}")
        try:
            while True:
                kind, payload = self.queue.get_nowait()
                if kind == "progress":
                    self.views["status"].setStringValue_(str(payload))
                elif kind == "watch":
                    self._apply_watch(payload)
                elif kind == "ok":
                    self._present(payload)
                elif kind == "err":
                    self.running = False
                    self._set_enabled("run", True)
                    self.views["status"].setStringValue_("הריצה נעצרה")
                    self._set_text(self.live_snippet, str(payload))
                    self._alert("שגיאה", str(payload))
        except queue.Empty:
            pass

    def _apply_watch(self, event: dict) -> None:
        view = watch_view(event if isinstance(event, dict) else {})
        if view["url"]:
            self.live_url.setStringValue_(view["url"])
        if view["snippet"]:
            self._set_text(self.live_snippet, view["snippet"])
        if view["jobs"] is not None:
            self.views["jobs"].setStringValue_(jobs_found_label(view["jobs"]))
        if view["fraction"] is not None:
            self.bar.setDoubleValue_(view["fraction"])

    def _present(self, result) -> None:
        if self.running and self.started:
            seconds = max(0, int(time.monotonic() - self.started))
            self.views["elapsed"].setStringValue_(f"{seconds // 60}:{seconds % 60:02d}")
        self.running = False
        self._set_enabled("run", True)
        self.bar.setDoubleValue_(1.0)
        self.views["jobs"].setStringValue_(jobs_found_label(len(result.jobs)))
        self.visible = result.included_jobs()
        self.lines = result_lines(result)
        self.markdown_path = result.markdown_path or ""
        self.html_path = result.html_path or ""
        self.table.reloadData()
        self.views["status"].setStringValue_(status_text(result))
        self.report_label.setStringValue_(f"נשמר  {result.markdown_path}    {result.html_path}")
        if self.visible:
            try:
                self.table.selectRowIndexes_byExtendingSelection_(NSIndexSet.indexSetWithIndex_(0), False)
            except Exception:
                pass
            self._show_row(0)
        else:
            self._set_text(self.detail, detail_text(result, -1))

    def _show_row(self, index: int) -> None:
        if index < 0 or index >= len(self.visible):
            return
        self._set_text(self.detail, detail_text_for(self.visible[index]))

    def numberOfRowsInTableView_(self, _table) -> int:
        return len(self.lines)

    def tableView_objectValueForTableColumn_row_(self, _table, _column, row: int) -> str:
        if row < 0 or row >= len(self.lines):
            return ""
        return self.lines[row]

    def tableViewSelectionDidChange_(self, _notification) -> None:
        row = self.table.selectedRow()
        if row < 0:
            return
        self._show_row(int(row))

    def openReport_(self, _sender) -> None:
        if not self.html_path:
            self._alert("דוח", "עדיין אין דוח. הריצו התאמה קודם.")
            return
        _open_target(self.html_path)

    def openJob_(self, _sender) -> None:
        row = self.table.selectedRow()
        if row < 0 or row >= len(self.visible):
            self._alert("משרה", "בחרו משרה מהרשימה.")
            return
        _open_target(self.visible[int(row)].job.url)

    def _alert(self, title: str, message: str) -> None:
        alert = NSAlert.alloc().init()
        alert.setMessageText_(title)
        alert.setInformativeText_(message)
        alert.addButtonWithTitle_("אישור")
        alert.runModal()


def detail_text_for(scored) -> str:
    from job_matcher.report import format_job_plain

    return format_job_plain(scored)


def _open_target(target: str) -> None:
    workspace = NSWorkspace.sharedWorkspace()
    if target.startswith("http://") or target.startswith("https://"):
        url = NSURL.URLWithString_(target)
        if url is not None:
            workspace.openURL_(url)
        return
    workspace.openFile_(target)


def _install_menu(app) -> None:
    main = NSMenu.alloc().init()
    app_item = NSMenuItem.alloc().init()
    main.addItem_(app_item)
    app_menu = NSMenu.alloc().init()
    app_menu.addItem_(NSMenuItem.alloc().initWithTitle_action_keyEquivalent_("Quit Job Matcher", "terminate:", "q"))
    app_item.setSubmenu_(app_menu)

    edit_item = NSMenuItem.alloc().init()
    main.addItem_(edit_item)
    edit = NSMenu.alloc().initWithTitle_("Edit")
    for title, action, key in (
        ("Cut", "cut:", "x"),
        ("Copy", "copy:", "c"),
        ("Paste", "paste:", "v"),
        ("Select All", "selectAll:", "a"),
    ):
        edit.addItem_(NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(title, action, key))
    edit_item.setSubmenu_(edit)
    app.setMainMenu_(main)


def run_gui() -> None:
    if sys.platform != "darwin":
        raise SystemExit(
            "חלון האפליקציה הוא חלון macOS ‏(AppKit). "
            "במחשב הזה הריצו עם --url או --html ועם --cv."
        )
    app = NSApplication.sharedApplication()
    _ensure_colors()
    app.setActivationPolicy_(NSApplicationActivationPolicyRegular)
    window = JobMatcherWindow.alloc().init()
    _KEEP["window"] = window
    app.setDelegate_(window)
    _install_menu(app)
    window.show()
    AppHelper.runEventLoop()
