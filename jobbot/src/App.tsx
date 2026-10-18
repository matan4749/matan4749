import { useEffect, useMemo, useState } from "react";
import type { AppSettings, RunConfig, RunProgress, SearchMode } from "@core/types";

type Tab = "home" | "run" | "settings" | "report";

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

  const api = window.jobbot;

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

  async function startRun() {
    if (!api || !settings || running) return;
    setRunning(true);
    setTab("run");
    setStatusMsg("");
    const config: RunConfig = {
      searchMode,
      keywords: searchMode === "keywords" ? selectedKeywords : [],
      enabledSites: settings.enabledSites,
      location: settings.location,
      jobLimitPerSite: settings.jobLimitPerSite,
      perJobTimeoutMs: 45000,
      perSiteTimeoutMs: 120000,
      maxRetries: 1,
    };
    try {
      const result = await api.startRun({ settings, config });
      setProgress(result.progress);
      setReportHtml(result.reportHtml);
      if (result.email.previewOnly) {
        setStatusMsg(
          settings.reportEmail
            ? "הדוח נשמר מקומית (outbox) — שליחה מובנית תעבוד כשמפתח האפליקציה מוגדר"
            : "מלא כתובת מייל בהגדרות לקבלת דוח",
        );
      } else if (!result.email.ok) {
        setStatusMsg(result.email.error || "שליחת מייל נכשלה");
      } else {
        setStatusMsg("הדוח נשלח במייל המובנה");
      }
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
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
          {tab === "home" && (
            <section className="hero">
              <div className="hero-brand rise">Jobbot</div>
              <h1 className="rise-delay">חיפוש והגשת משרות — אוטומטי, מקומי, חכם</h1>
              <p className="rise-delay">
                שלום מתן. Jobbot סורק לוחות משרות, מגיש קו״ח דרך פרופיל Chrome שלך, לומד
                מכישלונות, ושולח דוח מייל מפורט בסוף כל ריצה.
              </p>
              <div className="cta-row rise-delay">
                <button type="button" className="btn btn-primary" onClick={() => void startRun()} disabled={running}>
                  {running ? "רץ…" : "התחל ריצה"}
                </button>
                <button type="button" className="btn" onClick={() => setTab("settings")}>
                  הגדרות
                </button>
              </div>
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
                    <span>הוגשו</span>
                  </div>
                  <div className="stat">
                    <strong>{progress.failed}</strong>
                    <span>נכשלו</span>
                  </div>
                </div>

                <div className="cta-row">
                  {!running ? (
                    <button type="button" className="btn btn-primary" onClick={() => void startRun()}>
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

                <div className="field">
                  <label>Chrome user-data-dir (פרופיל מחובר)</label>
                  <div className="row">
                    <input
                      value={settings.chromeUserDataDir}
                      onChange={(e) =>
                        setSettings({ ...settings, chromeUserDataDir: e.target.value })
                      }
                      placeholder="~/Library/Application Support/Google/Chrome"
                    />
                    <button type="button" className="btn" onClick={() => void pickChrome()}>
                      בחר
                    </button>
                  </div>
                  <p className="hint">
                    התחבר בעצמך לאתרים ב-Chrome. סגור את Chrome לפני ריצה. Jobbot לא מבקש סיסמאות.
                  </p>
                </div>

                <div className="field">
                  <label>מייל לקבלת דוח (שליחה מובנית באפליקציה)</label>
                  <input
                    value={settings.reportEmail}
                    onChange={(e) => setSettings({ ...settings, reportEmail: e.target.value })}
                    placeholder="you@example.com"
                  />
                  <p className="hint">אין צורך בהגדרת SMTP — רק כתובת היעד.</p>
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
