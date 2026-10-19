import { useEffect, useMemo, useState } from "react";
import type { AppSettings, RunConfig, RunProgress, SearchMode } from "@core/types";
import type { RunPlan } from "@core/chat/types";
import ChatPanel from "./ChatPanel";

type Tab = "home" | "run" | "chat" | "settings" | "report";

const idle: RunProgress = {
  phase: "idle",
  found: 0,
  applied: 0,
  failed: 0,
  skipped: 0,
  logs: [],
  results: [],
};

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [adapters, setAdapters] = useState<
    {
      id: string;
      displayNameHe: string;
      status: "live" | "stub";
      siteKind?: "board" | "career-portal";
    }[]
  >([]);
  const [progress, setProgress] = useState<RunProgress>(idle);
  const [searchMode, setSearchMode] = useState<SearchMode>("keywords");
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [reportHtml, setReportHtml] = useState("");
  const [running, setRunning] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [chromeHint, setChromeHint] = useState(
    "~/Library/Application Support/Google/Chrome",
  );
  const [chromeProbeMsg, setChromeProbeMsg] = useState("");
  const [probing, setProbing] = useState(false);
  const [chromeClosedMsg, setChromeClosedMsg] = useState("");
  const [chromeClosedOk, setChromeClosedOk] = useState(false);
  const [chromeClosedAt, setChromeClosedAt] = useState<number | null>(null);
  const [checkingClosed, setCheckingClosed] = useState(false);

  const api = window.jobbot;
  const chromeReady = Boolean(settings?.chromeUserDataDir?.trim());
  /** Fresh closed-check within last 5 minutes */
  const chromeClosedFresh =
    chromeClosedOk &&
    chromeClosedAt != null &&
    Date.now() - chromeClosedAt < 5 * 60 * 1000;

  useEffect(() => {
    if (!api) {
      setStatusMsg("Electron API לא זמין — הרץ דרך npm run dev");
      return;
    }
    void (async () => {
      const s = await api.getSettings();
      setSettings(s);
      setSelectedKeywords(s.keywords);
      setAdapters(await api.listAdapters());
      try {
        setChromeHint(await api.getChromeHint());
      } catch {
        /* keep default */
      }
      const unsub = api.onProgress(setProgress);
      return unsub;
    })();
  }, [api]);

  useEffect(() => {
    if (!api) return;
    const unsub = api.onProgress(setProgress);
    return unsub;
  }, [api]);

  const phaseHe = useMemo(() => {
    const map: Record<RunProgress["phase"], string> = {
      idle: "ממתין",
      searching: "מחפש…",
      applying: "מגיש…",
      reporting: "מכין דוח…",
      done: "הושלם",
      stopped: "נעצר",
      error: "שגיאה",
    };
    return map[progress.phase];
  }, [progress.phase]);

  async function persist(next: AppSettings) {
    setSettings(next);
    if (api) await api.saveSettings(next);
  }

  async function verifyChromeClosed(): Promise<boolean> {
    if (!api) return false;
    setCheckingClosed(true);
    setChromeClosedMsg("בודק אם Chrome סגור…");
    try {
      const r = await api.checkChromeClosed(settings?.chromeUserDataDir || undefined);
      setChromeClosedMsg(r.messageHe);
      setChromeClosedOk(r.ok);
      setChromeClosedAt(r.ok ? Date.now() : null);
      setStatusMsg(r.messageHe);
      return r.ok;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setChromeClosedMsg(msg);
      setChromeClosedOk(false);
      setChromeClosedAt(null);
      setStatusMsg(msg);
      return false;
    } finally {
      setCheckingClosed(false);
    }
  }

  async function applyPlanToSettings(plan: RunPlan): Promise<{ ok: boolean; messageHe: string }> {
    if (!settings || !api) {
      return { ok: false, messageHe: "הגדרות לא זמינות — נסה שוב" };
    }
    const next: AppSettings = {
      ...settings,
      keywords: plan.keywords.length ? plan.keywords : settings.keywords,
      enabledSites: plan.enabledSites.length ? plan.enabledSites : settings.enabledSites,
      location: plan.location || settings.location,
      jobLimitPerSite: plan.jobLimitPerSite || settings.jobLimitPerSite,
    };
    setSearchMode(plan.searchMode);
    setSelectedKeywords(plan.keywords.length ? plan.keywords : selectedKeywords);
    setSettings(next);
    await api.saveSettings(next);
    const msg = `✓ התוכנית הוחלה להגדרות: ${plan.summaryHe || plan.searchMode}`;
    setStatusMsg(msg);
    return { ok: true, messageHe: msg };
  }

  async function startRun(fromPlan?: RunPlan): Promise<{ ok: boolean; messageHe: string }> {
    if (!api || !settings) {
      return { ok: false, messageHe: "Electron API לא זמין" };
    }
    if (running) {
      return { ok: false, messageHe: "כבר רצה ריצה — לחץ עצור קודם" };
    }

    let activeSettings = settings;
    let mode = searchMode;
    let kws = selectedKeywords;
    let searchOnly = false;
    if (fromPlan) {
      // ChatPanel may already have applied; apply again is idempotent and keeps state fresh
      const applied = await applyPlanToSettings(fromPlan);
      if (!applied.ok) return applied;
      activeSettings = await api.getSettings();
      mode = fromPlan.searchMode;
      kws = fromPlan.keywords.length ? fromPlan.keywords : activeSettings.keywords;
      searchOnly = fromPlan.applyMode === "search-only";
      setSearchMode(mode);
      setSelectedKeywords(kws);
    }

    if (!activeSettings.chromeUserDataDir?.trim()) {
      const msg =
        "נחסם: אין נתיב Chrome. עבור להגדרות, בחר פרופיל Chrome, ואז «הפעל ריצה» שוב.";
      setStatusMsg(msg);
      setTab("settings");
      return { ok: false, messageHe: msg };
    }

    setStatusMsg("בודק ש-Chrome סגור…");
    const safe = await verifyChromeClosed();
    if (!safe) {
      const msg =
        chromeClosedMsg ||
        "Chrome עדיין פתוח — לחץ Cmd+Q ונסה שוב";
      setStatusMsg(msg);
      // Stay/return feedback to chat; also show settings tip
      setTab("settings");
      return { ok: false, messageHe: msg };
    }

    setRunning(true);
    setTab("run");
    setStatusMsg(searchOnly ? "רץ (חיפוש בלבד)…" : "רץ…");
    const config: RunConfig = {
      searchMode: mode,
      keywords: mode === "keywords" ? kws : [],
      enabledSites: activeSettings.enabledSites,
      location: activeSettings.location,
      jobLimitPerSite: activeSettings.jobLimitPerSite,
      perJobTimeoutMs: 45000,
      perSiteTimeoutMs: 120000,
      maxRetries: 1,
      searchOnly,
    };
    try {
      const result = await api.startRun({ settings: activeSettings, config });
      setProgress(result.progress);
      setReportHtml(result.reportHtml);
      if (result.progress.phase === "error" || result.email.error === "CHROME_PROFILE_REQUIRED") {
        const msg = "הריצה נעצרה — חסר נתיב Chrome מחובר";
        setStatusMsg(msg);
        setTab("settings");
        return { ok: false, messageHe: msg };
      }
      if (config.searchOnly) {
        const msg = `✓ חיפוש בלבד — נמצאו ${result.progress.found} (ללא הגשות)`;
        setStatusMsg(msg);
        return { ok: true, messageHe: msg };
      }
      if (result.progress.applied === 0) {
        const msg =
          "הריצה הסתיימה — לא הוגשו מועמדויות מאומתות (בדוק לוגים בטאב ריצה)";
        setStatusMsg(msg);
        return { ok: true, messageHe: msg };
      }
      if (result.email.previewOnly) {
        const msg = `✓ הוגשו ${result.progress.applied} · הדוח נשמר מקומית`;
        setStatusMsg(msg);
        return { ok: true, messageHe: msg };
      }
      if (!result.email.ok) {
        const msg = result.email.error || "שליחת מייל נכשלה";
        setStatusMsg(msg);
        return { ok: true, messageHe: `הוגשו ${result.progress.applied} · ${msg}` };
      }
      const msg = `✓ הוגשו ${result.progress.applied} · הדוח נשלח`;
      setStatusMsg(msg);
      return { ok: true, messageHe: msg };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMsg(msg);
      return { ok: false, messageHe: msg };
    } finally {
      setRunning(false);
    }
  }

  async function stopRun() {
    await api?.stopRun();
  }

  async function pickCv() {
    const p = await api?.pickFile();
    if (p && settings) await persist({ ...settings, cvPath: p });
  }

  async function pickChrome() {
    const p = await api?.pickDir();
    if (p && settings) await persist({ ...settings, chromeUserDataDir: p });
  }

  async function useChromeHint() {
    if (!api || !settings) return;
    const resolved = await api.resolveChromePath(chromeHint);
    await persist({ ...settings, chromeUserDataDir: resolved || chromeHint });
  }

  async function probeChrome(forceSync = false) {
    if (!api || !settings?.chromeUserDataDir?.trim()) {
      setChromeProbeMsg("קודם בחר/הזן נתיב Chrome");
      return;
    }
    setProbing(true);
    setChromeProbeMsg(
      forceSync
        ? "מרענן עותק פרופיל… אם נכשל — סגור Chrome עם Cmd+Q"
        : "בודק דרך עותק Jobbot (Chrome הרגיל יכול להישאר פתוח אחרי סנכרון)…",
    );
    try {
      const r = await api.probeChrome(settings.chromeUserDataDir, { forceSync });
      setChromeProbeMsg(r.messageHe);
    } catch (err) {
      setChromeProbeMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setProbing(false);
    }
  }

  async function analyzeFromCv() {
    if (!api || !settings?.cvPath) return;
    const a = await api.analyzeCv(settings.cvPath);
    setSelectedKeywords(a.suggestedKeywords);
    setSearchMode("cv");
    setStatusMsg(`מקו״ח: ${a.suggestedKeywords.join(", ")}`);
  }

  if (!settings) {
    return (
      <>
        <div className="app-bg" />
        <div className="shell">
          <div className="view">
            <p className="rise">{statusMsg || "טוען…"}</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="app-bg" />
      <div className="shell">
        <header className="topnav">
          <div className="brand-mark">JOBBOT</div>
          <nav className="nav-tabs">
            {(
              [
                ["home", "בית"],
                ["chat", "צ׳אט"],
                ["run", "ריצה"],
                ["settings", "הגדרות"],
                ["report", "דוח"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={tab === id ? "active" : ""}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>
        </header>

        <main className="view">
          {tab === "chat" && (
            <ChatPanel
              settings={settings}
              running={running}
              onApplyPlan={(p) => applyPlanToSettings(p)}
              onStartFromPlan={(p) => startRun(p)}
            />
          )}

          {tab === "home" && (
            <section className="hero">
              <div className="hero-brand rise">Jobbot</div>
              <h1 className="rise-delay">חיפוש והגשת משרות — אוטומטי, מקומי, חכם</h1>
              <p className="rise-delay">
                שלום מתן. דבר עם הצ׳אט בעברית כדי לבחור מה לחפש — או הרץ ישירות.
              </p>
              <div className="cta-row rise-delay">
                <button type="button" className="btn btn-primary" onClick={() => setTab("chat")}>
                  פתח צ׳אט
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={checkingClosed || running}
                  onClick={() => void verifyChromeClosed()}
                >
                  {checkingClosed ? "בודק…" : "וודא ש־Chrome סגור"}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void startRun()}
                  disabled={running || checkingClosed}
                >
                  {running ? "רץ…" : chromeReady ? "התחל ריצה אמיתית" : "הגדר Chrome קודם"}
                </button>
                <button type="button" className="btn" onClick={() => setTab("settings")}>
                  הגדרות
                </button>
              </div>
              {chromeClosedMsg && (
                <p
                  className="hint rise-delay"
                  style={{ color: chromeClosedOk ? "var(--ok, #6bcf8e)" : "var(--danger)" }}
                >
                  {chromeClosedMsg}
                  {chromeClosedFresh ? " · בדיקה תקפה" : ""}
                </p>
              )}
              {!chromeReady && (
                <p className="hint rise-delay" style={{ color: "var(--danger)" }}>
                  להגשות אמיתיות חובה נתיב Chrome מחובר ללינקדאין/אינדיד — לחץ הגדרות.
                </p>
              )}
            </section>
          )}

          {tab === "run" && (
            <div className="grid-2">
              <section className="panel rise">
                <h2>ריצה חיה</h2>
                <p className="sub">
                  מצב: {phaseHe}
                  {progress.currentSite ? ` · ${progress.currentSite}` : ""}
                  {progress.currentJob ? ` · ${progress.currentJob}` : ""}
                </p>

                <div className="mode-toggle">
                  <button
                    type="button"
                    className={searchMode === "keywords" ? "on" : ""}
                    onClick={() => setSearchMode("keywords")}
                    disabled={running}
                  >
                    מילות מפתח
                  </button>
                  <button
                    type="button"
                    className={searchMode === "cv" ? "on" : ""}
                    onClick={() => void analyzeFromCv()}
                    disabled={running}
                  >
                    מקו״ח
                  </button>
                </div>

                <div className="chips" style={{ marginBottom: 16 }}>
                  {(searchMode === "keywords" ? settings.keywords : selectedKeywords).map((kw) => {
                    const on = selectedKeywords.includes(kw);
                    return (
                      <button
                        key={kw}
                        type="button"
                        className={`chip ${on ? "on" : ""}`}
                        disabled={running || searchMode === "cv"}
                        onClick={() =>
                          setSelectedKeywords((prev) =>
                            on ? prev.filter((k) => k !== kw) : [...prev, kw],
                          )
                        }
                      >
                        {kw}
                      </button>
                    );
                  })}
                </div>

                <div className="stats">
                  <div className="stat">
                    <strong>{progress.found}</strong>
                    <span>נמצאו</span>
                  </div>
                  <div className="stat">
                    <strong>{progress.applied}</strong>
                    <span>הוגשו באמת</span>
                  </div>
                  <div className="stat">
                    <strong>{progress.failed}</strong>
                    <span>נכשלו</span>
                  </div>
                  <div className="stat">
                    <strong>{progress.skipped}</strong>
                    <span>לא הוגש</span>
                  </div>
                </div>
                {progress.phase === "done" && progress.applied === 0 && (
                  <p className="hint" style={{ color: "var(--danger)" }}>
                    לא הוגשה אף מועמדות אמיתית בריצה זו — סטטוסים אחרים אינם הצלחה.
                  </p>
                )}

                <div className="cta-row">
                  {!running && (
                    <button
                      type="button"
                      className="btn"
                      disabled={checkingClosed}
                      onClick={() => void verifyChromeClosed()}
                    >
                      {checkingClosed ? "בודק…" : "בדיקה לפני התחלה"}
                    </button>
                  )}
                  {!running ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={checkingClosed}
                      onClick={() => void startRun()}
                    >
                      התחל
                    </button>
                  ) : (
                    <button type="button" className="btn btn-danger" onClick={() => void stopRun()}>
                      עצור
                    </button>
                  )}
                  {reportHtml && (
                    <button type="button" className="btn" onClick={() => setTab("report")}>
                      תצוגת דוח
                    </button>
                  )}
                </div>
                {chromeClosedMsg && !statusMsg && (
                  <p
                    className="hint"
                    style={{ color: chromeClosedOk ? "var(--ok, #6bcf8e)" : "var(--danger)" }}
                  >
                    {chromeClosedMsg}
                  </p>
                )}
                {statusMsg && <p className="hint">{statusMsg}</p>}
              </section>

              <section className="panel rise-delay">
                <h2>לוגים</h2>
                <p className="sub">עדכונים בזמן אמת מכל אדפטר</p>
                <div className="log-stream">
                  {progress.logs.length === 0 && <div className="log-line">ממתין להרצה…</div>}
                  {progress.logs.map((l) => (
                    <div key={l.id} className={`log-line ${l.level}`}>
                      [{l.ts.slice(11, 19)}] {l.message}
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {tab === "settings" && (
            <div className="grid-2">
              <section className="panel rise">
                <h2>הגדרות</h2>
                <p className="sub">קו״ח, Chrome, ומייל יעד לדוח — בלי SMTP מהמשתמש</p>

                <div className="field">
                  <label>נתיב קו״ח (ברירת מחדל: קו״ח של מתן)</label>
                  <div className="row">
                    <input
                      value={settings.cvPath}
                      onChange={(e) => setSettings({ ...settings, cvPath: e.target.value })}
                      placeholder="assets/cv/matan-amar-cv.pdf"
                    />
                    <button type="button" className="btn" onClick={() => void pickCv()}>
                      בחר
                    </button>
                  </div>
                  <p className="hint">
                    מקור: Project store · עותק באפליקציה: assets/cv/matan-amar-cv.pdf
                  </p>
                </div>

                <div className="panel" style={{ marginBottom: 16, padding: 14 }}>
                  <h3 style={{ fontFamily: "var(--font-display)", margin: "0 0 8px" }}>
                    הגשות אמיתיות — Chrome
                  </h3>
                  <ol className="hint" style={{ margin: 0, paddingInlineStart: 18, lineHeight: 1.7 }}>
                    <li>
                      בחר תיקיית הפרופיל — ב־Mac בדרך כלל:
                      <br />
                      <code>{chromeHint}</code>
                      <br />
                      (או <code>/Users/matan_amar/Library/Application Support/Google/Chrome</code>).
                    </li>
                    <li>התחבר ל־LinkedIn ו־Indeed ב-Chrome הרגיל שלך.</li>
                    <li>
                      Jobbot מעתיק את הפרופיל לתיקייה נפרדת (בלי SingletonLock) — אחרי סנכרון
                      מוצלח אפשר להשאיר את Chrome פתוח.
                    </li>
                    <li>
                      אם מופיעה שגיאת «פתיחה בסשן קיים» / נעילה: סגור לגמרי עם{" "}
                      <strong>Cmd+Q</strong> (לא רק חלון), ודא שאין נקודה ב־Dock, ואז «רענון עותק
                      פרופיל».
                    </li>
                  </ol>
                </div>

                <div className="field">
                  <label>Chrome user-data-dir (פרופיל מחובר)</label>
                  <div className="row">
                    <input
                      value={settings.chromeUserDataDir}
                      onChange={(e) =>
                        setSettings({ ...settings, chromeUserDataDir: e.target.value })
                      }
                      placeholder={chromeHint}
                    />
                    <button type="button" className="btn" onClick={() => void pickChrome()}>
                      בחר
                    </button>
                  </div>
                  <div className="cta-row" style={{ marginTop: 8 }}>
                    <button type="button" className="btn" onClick={() => void useChromeHint()}>
                      מלא נתיב Mac ברירת מחדל
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={checkingClosed || running}
                      onClick={() => void verifyChromeClosed()}
                    >
                      {checkingClosed ? "בודק…" : "וודא ש־Chrome סגור"}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={probing || !settings.chromeUserDataDir.trim()}
                      onClick={() => void probeChrome(false)}
                    >
                      {probing ? "בודק…" : "בדיקת חיבור Chrome"}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={probing || !settings.chromeUserDataDir.trim()}
                      onClick={() => void probeChrome(true)}
                    >
                      רענון עותק פרופיל
                    </button>
                  </div>
                  {chromeClosedMsg && (
                    <p
                      className="hint"
                      style={{ color: chromeClosedOk ? "var(--ok, #6bcf8e)" : "var(--danger)" }}
                    >
                      {chromeClosedMsg}
                    </p>
                  )}
                  {chromeProbeMsg && <p className="hint">{chromeProbeMsg}</p>}
                  <p className="hint">
                    לפני התחלה: «וודא ש־Chrome סגור» (או שההתחלה תבדוק אוטומטית). Jobbot לא מבקש
                    סיסמאות — מעתיק סשן לעותק פרטי.
                  </p>
                </div>

                <div className="field">
                  <label>מייל לקבלת דוח (שליחה מובנית באפליקציה)</label>
                  <input
                    value={settings.reportEmail}
                    onChange={(e) => setSettings({ ...settings, reportEmail: e.target.value })}
                    placeholder="matan4749@gmail.com"
                  />
                  <p className="hint">ברירת מחדל: matan4749@gmail.com · אין צורך ב-SMTP.</p>
                </div>

                <div className="field">
                  <label>מיקום חיפוש</label>
                  <input
                    value={settings.location}
                    onChange={(e) => setSettings({ ...settings, location: e.target.value })}
                  />
                </div>

                <div className="field">
                  <label>מקסימום משרות לאתר</label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={settings.jobLimitPerSite}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        jobLimitPerSite: Number(e.target.value) || 5,
                      })
                    }
                  />
                </div>

                <div className="field">
                  <label>מילות מפתח (מופרדות בפסיק)</label>
                  <textarea
                    rows={3}
                    value={settings.keywords.join(", ")}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        keywords: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </div>

                <label className="row" style={{ marginBottom: 14 }}>
                  <input
                    type="checkbox"
                    checked={settings.sendEmailAfterRun}
                    onChange={(e) =>
                      setSettings({ ...settings, sendEmailAfterRun: e.target.checked })
                    }
                  />
                  שלח מייל מובנה בסוף ריצה
                </label>

                <div className="field">
                  <label>מפתח LLM לצ׳אט (אופציונלי)</label>
                  <input
                    type="password"
                    value={settings.llmApiKey || ""}
                    onChange={(e) => setSettings({ ...settings, llmApiKey: e.target.value })}
                    placeholder="JOBBOT_LLM_API_KEY / sk-…"
                    autoComplete="off"
                  />
                  <p className="hint">
                    OpenAI-compatible. בלי מפתח — צ׳אט עובד בכללי עברית מקומיים (לא Cursor Composer
                    בענן).
                  </p>
                </div>
                <div className="field">
                  <label>LLM base URL</label>
                  <input
                    value={settings.llmBaseUrl || "https://api.openai.com/v1"}
                    onChange={(e) => setSettings({ ...settings, llmBaseUrl: e.target.value })}
                    placeholder="https://api.openai.com/v1"
                  />
                </div>
                <div className="field">
                  <label>מודל</label>
                  <input
                    value={settings.llmModel || "gpt-4o-mini"}
                    onChange={(e) => setSettings({ ...settings, llmModel: e.target.value })}
                    placeholder="gpt-4o-mini"
                  />
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void persist(settings).then(() => setStatusMsg("נשמר"))}
                >
                  שמור הגדרות
                </button>
                {statusMsg && <p className="hint">{statusMsg}</p>}
              </section>

              <section className="panel rise-delay">
                <h2>אתרים</h2>
                <p className="sub">לוחות משרות + פורטלי קריירה (אלביט, תע״א)</p>
                <div className="adapter-list">
                  {adapters.map((a) => {
                    const on = settings.enabledSites.includes(a.id);
                    const kindHe =
                      a.siteKind === "career-portal" ? "פורטל קריירה" : "לוח משרות";
                    return (
                      <div key={a.id} className="adapter-row">
                        <div>
                          <strong>{a.displayNameHe}</strong>{" "}
                          <span className={`badge ${a.status}`}>{a.status}</span>{" "}
                          <span className="badge">{kindHe}</span>
                        </div>
                        <button
                          type="button"
                          className={`chip ${on ? "on" : ""}`}
                          onClick={() =>
                            setSettings({
                              ...settings,
                              enabledSites: on
                                ? settings.enabledSites.filter((id) => id !== a.id)
                                : [...settings.enabledSites, a.id],
                            })
                          }
                        >
                          {on ? "פעיל" : "כבוי"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          )}

          {tab === "report" && (
            <section className="panel rise">
              <h2>תצוגת דוח</h2>
              <p className="sub">HTML זהה לדוח המייל המובנה (ונשמר גם ב-outbox מקומי)</p>
              {reportHtml ? (
                <iframe className="report-frame" title="report" srcDoc={reportHtml} />
              ) : (
                <p className="hint">עדיין אין דוח — הרץ חיפוש קודם.</p>
              )}
            </section>
          )}
        </main>
      </div>
    </>
  );
}
