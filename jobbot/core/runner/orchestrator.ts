import { randomUUID } from "node:crypto";
import { listAdapters } from "../adapters/registry";
import { sanitizeApplyResult, isRealApplied } from "../adapters/sanitize";
import { LearningEngine } from "../learning/engine";
import { buildReportHtml } from "../email/report";
import { sendReportEmail } from "../email/send";
import { analyzeCv } from "../cv/analyze";
import { checkChromeClosed, CHROME_QUIT_MSG_HE, isChromeLockError } from "../browser/chrome-lock";
import {
  detectChromeProfileName,
  normalizeChromeUserDataDir,
} from "../browser/chrome-paths";
import { jobbotBrowserProfileRoot } from "../browser/jobbot-profile";
import { launchChromePersistent, type LaunchedChrome } from "../browser/launch-chrome";
import {
  COOKIES_NOT_SAVED_HE,
  LOGGED_IN_SKIP_HE,
  openLoginGatePages,
  shouldSkipLoginGate,
  verifyCookiesPersisted,
} from "../browser/login-gate";
import { ensureJobbotChromeProfile, jobbotCloneRoot } from "../browser/profile-clone";
import { assertChromeSessionArtifacts } from "../browser/session-artifacts";
import {
  BROWSER_CLOSED_CODE,
  BROWSER_CLOSED_MSG_HE,
  isBrowserClosedError,
  isSharedBrowserAlive,
} from "../browser/session";
import type {
  AppSettings,
  ApplyResult,
  RunConfig,
  RunLogEntry,
  RunProgress,
  SiteAdapterContext,
} from "../types";

/** Stability cap — Matan's logs showed 20 was too high for flaky Easy Apply */
export const STABLE_JOB_LIMIT_PER_SITE = 5;
export const MAX_JOB_LIMIT_PER_SITE = 10;

export type ProgressListener = (progress: RunProgress) => void;

export class JobRunner {
  private abort: AbortController | null = null;
  private progress: RunProgress = idleProgress();
  private listeners = new Set<ProgressListener>();
  private learning: LearningEngine;
  private demo: boolean;
  private loginGateWait: {
    resolve: (action: "continue" | "cancel") => void;
  } | null = null;

  constructor(
    private dataDir: string,
    opts?: { demo?: boolean; allowDemo?: boolean },
  ) {
    this.learning = new LearningEngine(dataDir);
    // Packaged apps must pass allowDemo:false so JOBBOT_DEMO never fakes applies
    const allowDemo = opts?.allowDemo !== false;
    this.demo = Boolean(opts?.demo) && allowDemo;
  }

  onProgress(fn: ProgressListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getProgress(): RunProgress {
    return structuredClone(this.progress);
  }

  stop(): void {
    this.abort?.abort();
    this.loginGateWait?.resolve("cancel");
    this.loginGateWait = null;
    this.patch({ phase: "stopped" });
    this.log("warn", "הריצה נעצרה לפי בקשת המשתמש");
  }

  /** UI: «המשך לריצה» / «ביטול» during awaiting-login */
  resolveLoginGate(action: "continue" | "cancel"): boolean {
    if (!this.loginGateWait) return false;
    this.loginGateWait.resolve(action);
    this.loginGateWait = null;
    return true;
  }

  async run(settings: AppSettings, config: RunConfig): Promise<{
    progress: RunProgress;
    reportHtml: string;
    email: { ok: boolean; previewOnly?: boolean; messageId?: string; error?: string };
    learningNotes: string[];
  }> {
    this.abort = new AbortController();
    const signal = this.abort.signal;

    this.progress = {
      ...idleProgress(),
      phase: "searching",
      startedAt: new Date().toISOString(),
      logs: [],
      results: [],
    };
    this.emit();

    const browserMode = settings.browserMode === "live" ? "live" : "jobbot";
    const chromePath = normalizeChromeUserDataDir(settings.chromeUserDataDir || "");

    if (!this.demo && browserMode === "live" && !chromePath) {
      this.log("error", "מצב Chrome מערכת — חסר נתיב …/Google/Chrome בהגדרות");
      this.patch({ phase: "error", finishedAt: new Date().toISOString() });
      const reportHtml = buildReportHtml({
        userName: "מתן עמר",
        progress: this.progress,
        results: [],
      });
      return {
        progress: this.getProgress(),
        reportHtml,
        email: { ok: false, previewOnly: true, error: "CHROME_PROFILE_REQUIRED" },
        learningNotes: ["נדרש נתיב Chrome במצב מערכת"],
      };
    }

    const keywords = await this.resolveKeywords(settings, config);
    const jobLimitPerSite = clampJobLimit(config.jobLimitPerSite);
    if (jobLimitPerSite !== config.jobLimitPerSite) {
      this.log(
        "warn",
        `מגבלת משרות לאתר הורדה מ-${config.jobLimitPerSite} ל-${jobLimitPerSite} ליציבות`,
      );
    }
    this.log(
      "info",
      `מצב חיפוש: ${config.searchMode === "cv" ? "מקו״ח" : "מילות מפתח"} · ${keywords.join(", ")} · עד ${jobLimitPerSite} לאתר`,
    );

    const enabled = config.enabledSites.length
      ? config.enabledSites
      : settings.enabledSites;
    const adapters = listAdapters().filter((a) => enabled.includes(a.id));

    let sharedBrowser: LaunchedChrome | undefined;
    let profilePath = "";
    let chromeProfileDirectory = "Default";

    if (this.demo) {
      this.log("warn", "מצב הדגמה פעיל — לא יוגשו מועמדויות אמיתיות");
    } else {
      try {
        if (browserMode === "jobbot") {
          profilePath = jobbotBrowserProfileRoot(this.dataDir);
          chromeProfileDirectory = "Default";
          this.log(
            "info",
            `פרופיל Jobbot קבוע: ${profilePath} (ההתחברויות נשמרות בין ריצות — Chrome הרגיל יכול להישאר פתוח)`,
          );
        } else if (settings.useChromeClone) {
          this.log("info", "מצב מתקדם: עותק מפרופיל המערכת…");
          const closed = await checkChromeClosed(chromePath);
          if (!closed.ok) {
            this.log("error", closed.messageHe);
            this.patch({ phase: "error", finishedAt: new Date().toISOString() });
            return earlyError(this, closed.messageHe, "CHROME_STILL_OPEN");
          }
          const clone = await ensureJobbotChromeProfile({
            sourceUserDataDir: chromePath,
            cloneRoot: jobbotCloneRoot(this.dataDir),
            log: (m) => this.log("info", m),
          });
          assertChromeSessionArtifacts(clone.path);
          profilePath = clone.path;
          chromeProfileDirectory = detectChromeProfileName(chromePath);
          this.log("info", clone.messageHe);
        } else {
          this.log("info", "מצב Chrome מערכת — חובה Cmd+Q לפני ריצה");
          const closed = await checkChromeClosed(chromePath);
          if (!closed.ok) {
            this.log("error", closed.messageHe || CHROME_QUIT_MSG_HE);
            this.patch({ phase: "error", finishedAt: new Date().toISOString() });
            return earlyError(this, closed.messageHe, "CHROME_STILL_OPEN");
          }
          profilePath = chromePath;
          chromeProfileDirectory = detectChromeProfileName(chromePath);
        }

        sharedBrowser = await launchChromePersistent({
          userDataDir: profilePath,
          profileDirectory: chromeProfileDirectory,
          log: (m) => this.log("info", m),
          // Jobbot dedicated profile — Matan's normal Chrome may stay open
          allowWhileChromeRunning: browserMode === "jobbot",
        });

        const gateSites = adapters.map((a) => ({
          id: a.id,
          displayNameHe: a.displayNameHe,
        }));
        const enabledIds = adapters.map((a) => a.id);

        // Fast probe: LinkedIn first — if already logged in, skip the gate entirely
        let statuses = await openLoginGatePages(
          sharedBrowser,
          gateSites,
          (m) => this.log("info", m),
          { probeOnlyPrimary: true },
        );

        if (shouldSkipLoginGate(statuses, enabledIds)) {
          this.log("info", LOGGED_IN_SKIP_HE);
          this.patch({ phase: "searching", loginGate: undefined });
        } else {
          // Need login — open all enabled site tabs for Matan
          this.log("info", "נדרשת התחברות — פותח לשוניות לאתרים…");
          statuses = await openLoginGatePages(sharedBrowser, gateSites, (m) =>
            this.log("info", m),
          );
          this.patch({
            phase: "awaiting-login",
            loginGate: {
              sites: statuses,
              messageHe:
                "התחבר לאתרים בחלון Chrome שנפתח. כשסיימת — לחץ «המשך לריצה». ההתחברות נשמרת בפרופיל Jobbot לפעם הבאה (בלי שער אם כבר מחובר).",
            },
          });
          this.log("info", "ממתין להתחברות ידנית… («המשך לריצה» / «ביטול»)");

          const gateAction = await this.waitForLoginGate(signal);
          this.patch({ loginGate: undefined });
          if (gateAction !== "continue" || signal.aborted) {
            this.log("warn", "הריצה בוטלה בשער ההתחברות");
            await sharedBrowser.close().catch(() => undefined);
            sharedBrowser = undefined;
            this.patch({
              phase: "stopped",
              finishedAt: new Date().toISOString(),
            });
            const reportHtml = buildReportHtml({
              userName: "מתן עמר",
              progress: this.progress,
              results: [],
            });
            return {
              progress: this.getProgress(),
              reportHtml,
              email: { ok: false, previewOnly: true, error: "LOGIN_GATE_CANCELLED" },
              learningNotes: ["בוטל בשער התחברות"],
            };
          }

          // Give Chrome a moment to flush cookies to the Jobbot profile
          await new Promise((r) => setTimeout(r, 1500));
          const cookieCheck = verifyCookiesPersisted(profilePath, chromeProfileDirectory);
          if (!cookieCheck.ok && browserMode === "jobbot") {
            this.log("error", cookieCheck.messageHe || COOKIES_NOT_SAVED_HE);
            await sharedBrowser.close().catch(() => undefined);
            sharedBrowser = undefined;
            this.patch({ phase: "error", finishedAt: new Date().toISOString() });
            return earlyError(
              this,
              cookieCheck.messageHe || COOKIES_NOT_SAVED_HE,
              "COOKIES_NOT_SAVED",
            );
          }
          this.log(
            "info",
            cookieCheck.ok
              ? `המשתמש אישר התחברות — ${cookieCheck.messageHe}`
              : "המשתמש אישר התחברות — ממשיכים לחיפוש/הגשה באותו חלון Chrome",
          );

          // Re-probe LinkedIn after continue — warn if still on login wall
          const after = await openLoginGatePages(
            sharedBrowser,
            gateSites.filter((s) => s.id === "linkedin").length
              ? gateSites.filter((s) => s.id === "linkedin")
              : gateSites.slice(0, 1),
            (m) => this.log("info", m),
          );
          const stillWall = after.some((s) => s.loggedIn === false);
          if (stillWall) {
            this.log(
              "warn",
              "עדיין נראה מסך התחברות אחרי «המשך» — ההגשות עלולות להיכשל. התחבר ושמור סשן בפרופיל Jobbot.",
            );
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log("error", isChromeLockError(err) ? CHROME_QUIT_MSG_HE : msg.split("\n")[0] || msg);
        await sharedBrowser?.close().catch(() => undefined);
        sharedBrowser = undefined;
        this.patch({ phase: "error", finishedAt: new Date().toISOString() });
        return earlyError(this, msg, "CHROME_LAUNCH_FAILED");
      }
    }

    const allResults: ApplyResult[] = [];

    const buildCtx = (adapterId: string): SiteAdapterContext => ({
      demo: this.demo,
      chromeUserDataDir: profilePath || chromePath || undefined,
      jobbotChromeProfileDir: browserMode === "jobbot" ? profilePath : undefined,
      chromeProfileDirectory,
      sharedBrowser,
      cvPath: settings.cvPath || undefined,
      timeoutMs: config.perJobTimeoutMs,
      knowledge: this.learning.getSiteKnowledge(adapterId),
      log: (level, message) => this.log(level, message),
      signal,
    });

    const recoverBrowserIfNeeded = async (err: unknown): Promise<boolean> => {
      if (!isBrowserClosedError(err) && isSharedBrowserAlive(sharedBrowser)) {
        return false;
      }
      this.log("warn", BROWSER_CLOSED_MSG_HE);
      sharedBrowser = undefined;
      this.patch({
        phase: "awaiting-login",
        loginGate: {
          sites: adapters.map((a) => ({
            id: a.id,
            displayNameHe: a.displayNameHe,
            url: "",
            loggedIn: null,
          })),
          messageHe: BROWSER_CLOSED_MSG_HE,
        },
      });
      const action = await this.waitForLoginGate(signal);
      this.patch({ loginGate: undefined });
      if (action !== "continue" || signal.aborted) {
        this.log("warn", "הריצה בוטלה אחרי סגירת הדפדפן");
        return false;
      }
      try {
        sharedBrowser = await launchChromePersistent({
          userDataDir: profilePath,
          profileDirectory: chromeProfileDirectory,
          log: (m) => this.log("info", m),
          allowWhileChromeRunning: browserMode === "jobbot",
        });
        const gateSites = adapters.map((a) => ({
          id: a.id,
          displayNameHe: a.displayNameHe,
        }));
        const statuses = await openLoginGatePages(sharedBrowser, gateSites, (m) =>
          this.log("info", m),
        );
        // After browser death: if LinkedIn already logged in again, skip second gate
        if (shouldSkipLoginGate(statuses, adapters.map((a) => a.id))) {
          this.log("info", LOGGED_IN_SKIP_HE);
          return true;
        }
        this.patch({
          phase: "awaiting-login",
          loginGate: {
            sites: statuses,
            messageHe: BROWSER_CLOSED_MSG_HE,
          },
        });
        const again = await this.waitForLoginGate(signal);
        this.patch({ loginGate: undefined });
        if (again !== "continue" || signal.aborted) {
          await sharedBrowser.close().catch(() => undefined);
          sharedBrowser = undefined;
          return false;
        }
        this.log("info", "הדפדפן חזר — ממשיכים בריצה");
        return true;
      } catch (relaunchErr) {
        this.log(
          "error",
          `פתיחה מחדש נכשלה: ${errMsg(relaunchErr).split("\n")[0]}`,
        );
        sharedBrowser = undefined;
        return false;
      }
    };

    try {
    for (const adapter of adapters) {
      if (signal.aborted) break;

      this.patch({ phase: "searching", currentSite: adapter.id, currentJob: undefined });
      this.log(
        "info",
        `── ${adapter.displayNameHe} (${adapter.status === "live" ? "חי" : "stub"}) ──`,
      );

      let ctx = buildCtx(adapter.id);

      let jobs = [];
      try {
        jobs = await withTimeout(
          adapter.search(
            {
              keywords,
              location: config.location || settings.location,
              limit: jobLimitPerSite,
            },
            ctx,
          ),
          config.perSiteTimeoutMs,
          `${adapter.id} search timeout`,
          signal,
        );
      } catch (err) {
        if (isBrowserClosedError(err)) {
          const recovered = await recoverBrowserIfNeeded(err);
          if (!recovered) {
            this.patch({
              phase: signal.aborted ? "stopped" : "stopped",
              finishedAt: new Date().toISOString(),
            });
            break;
          }
          ctx = buildCtx(adapter.id);
          try {
            jobs = await withTimeout(
              adapter.search(
                {
                  keywords,
                  location: config.location || settings.location,
                  limit: jobLimitPerSite,
                },
                ctx,
              ),
              config.perSiteTimeoutMs,
              `${adapter.id} search timeout`,
              signal,
            );
          } catch (err2) {
            this.log("error", `${adapter.displayNameHe}: חיפוש נכשל — ${errMsg(err2)}`);
            if (isBrowserClosedError(err2)) {
              // Abort remaining sites cleanly — don't spam newPage on dead browser
              this.log("warn", `${adapter.displayNameHe}: מדלג על שאר האתר אחרי סגירת דפדפן`);
              break;
            }
            continue;
          }
        } else {
          this.log("error", `${adapter.displayNameHe}: חיפוש נכשל — ${errMsg(err)}`);
          continue;
        }
      }

      this.patch({ found: this.progress.found + jobs.length });
      this.log("info", `נמצאו ${jobs.length} משרות ב-${adapter.displayNameHe}`);

      if (config.searchOnly) {
        for (const job of jobs) {
          const result: ApplyResult = {
            job,
            status: "skipped",
            method: adapter.defaultApplyMethod,
            reason: "חיפוש בלבד — לא הוגשה מועמדות",
            durationMs: 0,
            confirmed: false,
            simulated: false,
          };
          allResults.push(result);
          this.progress.results = [...allResults];
          this.patch({ skipped: this.progress.skipped + 1 });
          this.log("info", `○ נמצא (חיפוש בלבד): ${job.title}`);
        }
        continue;
      }

      this.patch({ phase: "applying" });

      let abortSite = false;
      for (const job of jobs) {
        if (signal.aborted || abortSite) break;
        this.patch({ currentJob: job.title, currentSite: adapter.id });

        // Don't call apply/newPage if browser already dead
        if (sharedBrowser && !isSharedBrowserAlive(sharedBrowser)) {
          const recovered = await recoverBrowserIfNeeded(new Error(BROWSER_CLOSED_CODE));
          if (!recovered) {
            abortSite = true;
            this.patch({
              phase: signal.aborted ? "stopped" : "stopped",
              finishedAt: new Date().toISOString(),
            });
            break;
          }
          ctx = buildCtx(adapter.id);
        }

        let result: ApplyResult | null = null;
        let attempt = 0;
        const max = Math.max(1, config.maxRetries + 1);

        while (attempt < max) {
          attempt++;
          try {
            result = await withTimeout(
              adapter.apply(job, ctx),
              config.perJobTimeoutMs,
              `${adapter.id} apply timeout`,
              signal,
            );
            if (result.status !== "failed" || attempt >= max) break;
            this.log("warn", `ניסיון חוזר ${attempt}/${max} ל-${job.title}`);
          } catch (err) {
            if (isBrowserClosedError(err)) {
              const recovered = await recoverBrowserIfNeeded(err);
              if (!recovered) {
                result = {
                  job,
                  status: "skipped",
                  method: adapter.defaultApplyMethod,
                  reason: BROWSER_CLOSED_MSG_HE,
                  durationMs: 0,
                  confirmed: false,
                };
                abortSite = true;
                break;
              }
              ctx = buildCtx(adapter.id);
              // Retry this job once after recover
              attempt = Math.max(0, attempt - 1);
              continue;
            }
            result = {
              job,
              status: "failed",
              method: adapter.defaultApplyMethod,
              reason: errMsg(err),
              durationMs: 0,
            };
            if (attempt >= max || signal.aborted) break;
            this.log("warn", `שגיאה — ניסיון חוזר: ${errMsg(err)}`);
          }
        }

        if (!result) continue;
        result = sanitizeApplyResult(result, adapter, ctx.demo);
        allResults.push(result);
        this.progress.results = [...allResults];

        if (isRealApplied(result)) {
          this.patch({ applied: this.progress.applied + 1 });
          this.log("info", `✓ הוגש באמת (אומת): ${job.title}`);
        } else if (result.status === "failed") {
          this.patch({ failed: this.progress.failed + 1 });
          this.log("error", `✗ נכשל: ${job.title} — ${result.reason}`);
        } else if (result.status === "unknown") {
          this.patch({ skipped: this.progress.skipped + 1 });
          this.log("warn", `? לא אומת: ${job.title} — ${result.reason}`);
        } else if (result.status === "not_implemented") {
          this.patch({ skipped: this.progress.skipped + 1 });
          this.log("warn", `○ לא מיושם: ${job.title} — ${result.reason}`);
        } else {
          this.patch({ skipped: this.progress.skipped + 1 });
          this.log(
            "warn",
            `○ לא הוגש: ${job.title} — ${result.reason || result.status}${result.simulated ? " [הדגמה]" : ""}`,
          );
        }
      }

      if (abortSite && !isSharedBrowserAlive(sharedBrowser)) {
        this.log("warn", "עוצר אתרי המשך — הדפדפן עדיין סגור");
        break;
      }
    }
    } finally {
      if (sharedBrowser) {
        this.log("info", "סוגר חלון Chrome של Jobbot (הפרופיל נשמר לדיסק)");
        await sharedBrowser.close().catch(() => undefined);
        sharedBrowser = undefined;
      }
    }

    const realApplied = allResults.filter(isRealApplied).length;
    if (realApplied === 0) {
      this.log(
        "warn",
        "סיכום אמין: לא הוגשה אף מועמדות אמיתית בריצה זו (0 הגשות מאומתות)",
      );
    }

    // Learning loop
    this.learning.recordResults(allResults);
    const analysis = this.learning.analyze();
    for (const n of analysis.notes) this.log("info", `למידה: ${n}`);

    this.patch({ phase: "reporting", currentJob: undefined, currentSite: undefined });

    const reportHtml = buildReportHtml({
      userName: "מתן עמר",
      progress: this.progress,
      results: allResults,
    });

    let email: {
      ok: boolean;
      previewOnly?: boolean;
      messageId?: string;
      error?: string;
      transport?: string;
      outboxPath?: string;
    } = { ok: false, previewOnly: true, error: "skipped" };
    if (settings.sendEmailAfterRun) {
      email = await sendReportEmail({
        settings,
        subject: `Jobbot — דוח ריצה (${this.progress.applied} הוגשו / ${this.progress.failed} נכשלו)`,
        html: reportHtml,
        dataDir: this.dataDir,
      });
      if (email.ok && !email.previewOnly) {
        this.log("info", `מייל דוח נשלח ל-${settings.reportEmail} (${email.transport || "builtin"})`);
      } else if (email.previewOnly) {
        this.log(
          "warn",
          email.error || "הדוח נשמר מקומית (outbox) — מלא כתובת מייל בהגדרות לשליחה מובנית",
        );
      } else {
        this.log("error", `שליחת מייל נכשלה: ${email.error}`);
      }
    }

    this.patch({
      phase: signal.aborted ? "stopped" : "done",
      finishedAt: new Date().toISOString(),
    });

    return {
      progress: this.getProgress(),
      reportHtml,
      email,
      learningNotes: analysis.notes,
    };
  }

  private waitForLoginGate(signal: AbortSignal): Promise<"continue" | "cancel"> {
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve("cancel");
        return;
      }
      const onAbort = () => {
        this.loginGateWait = null;
        signal.removeEventListener("abort", onAbort);
        resolve("cancel");
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.loginGateWait = {
        resolve: (action) => {
          signal.removeEventListener("abort", onAbort);
          resolve(action);
        },
      };
    });
  }

  private async resolveKeywords(settings: AppSettings, config: RunConfig): Promise<string[]> {
    if (config.searchMode === "keywords") {
      if (config.keywords?.length) return config.keywords;
      return settings.keywords;
    }
    const analysis = await analyzeCv(settings.cvPath);
    this.log(
      "info",
      analysis.textLength
        ? `ניתוח קו״ח: ${analysis.suggestedKeywords.length} מילות מפתח`
        : "קו״ח לא נקרא — משתמש במילות ברירת מחדל",
    );
    return analysis.suggestedKeywords.length
      ? analysis.suggestedKeywords
      : settings.keywords;
  }

  private log(level: RunLogEntry["level"], message: string): void {
    const entry: RunLogEntry = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      level,
      message,
    };
    this.progress.logs = [...this.progress.logs, entry].slice(-400);
    this.emit();
  }

  private patch(partial: Partial<RunProgress>): void {
    this.progress = { ...this.progress, ...partial };
    this.emit();
  }

  private emit(): void {
    const snap = this.getProgress();
    for (const l of this.listeners) {
      try {
        l(snap);
      } catch {
        /* ignore listener errors */
      }
    }
  }
}

function idleProgress(): RunProgress {
  return {
    phase: "idle",
    found: 0,
    applied: 0,
    failed: 0,
    skipped: 0,
    logs: [],
    results: [],
  };
}

function earlyError(
  runner: JobRunner,
  message: string,
  error: string,
): {
  progress: RunProgress;
  reportHtml: string;
  email: { ok: boolean; previewOnly?: boolean; error?: string };
  learningNotes: string[];
} {
  const reportHtml = buildReportHtml({
    userName: "מתן עמר",
    progress: runner.getProgress(),
    results: [],
  });
  return {
    progress: runner.getProgress(),
    reportHtml,
    email: { ok: false, previewOnly: true, error },
    learningNotes: [message],
  };
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function clampJobLimit(n: number): number {
  if (!Number.isFinite(n) || n < 1) return STABLE_JOB_LIMIT_PER_SITE;
  if (n > MAX_JOB_LIMIT_PER_SITE) return STABLE_JOB_LIMIT_PER_SITE;
  return Math.floor(n);
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
      return;
    }
    const timer = setTimeout(() => reject(new Error(label)), ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise
      .then((v) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        reject(e);
      });
  });
}
