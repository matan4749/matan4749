import { randomUUID } from "node:crypto";
import { getAdapter, listAdapters } from "../adapters/registry";
import { LearningEngine } from "../learning/engine";
import { buildReportHtml } from "../email/report";
import { sendReportEmail } from "../email/send";
import { analyzeCv } from "../cv/analyze";
import type {
  AppSettings,
  ApplyResult,
  RunConfig,
  RunLogEntry,
  RunProgress,
  SiteAdapterContext,
} from "../types";

export type ProgressListener = (progress: RunProgress) => void;

export class JobRunner {
  private abort: AbortController | null = null;
  private progress: RunProgress = idleProgress();
  private listeners = new Set<ProgressListener>();
  private learning: LearningEngine;
  private demo: boolean;

  constructor(
    private dataDir: string,
    opts?: { demo?: boolean },
  ) {
    this.learning = new LearningEngine(dataDir);
    this.demo = opts?.demo ?? process.env.JOBBOT_DEMO === "1";
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
    this.patch({ phase: "stopped" });
    this.log("warn", "הריצה נעצרה לפי בקשת המשתמש");
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

    const keywords = await this.resolveKeywords(settings, config);
    this.log("info", `מצב חיפוש: ${config.searchMode === "cv" ? "מקו״ח" : "מילות מפתח"} · ${keywords.join(", ")}`);
    if (this.demo) this.log("info", "JOBBOT_DEMO=1 — מצב הדגמה ללא דפדפן אמיתי");

    const enabled = config.enabledSites.length
      ? config.enabledSites
      : settings.enabledSites;
    const adapters = listAdapters().filter((a) => enabled.includes(a.id));

    const allResults: ApplyResult[] = [];

    for (const adapter of adapters) {
      if (signal.aborted) break;

      this.patch({ phase: "searching", currentSite: adapter.id, currentJob: undefined });
      this.log(
        "info",
        `── ${adapter.displayNameHe} (${adapter.status === "live" ? "חי" : "stub"}) ──`,
      );

      const knowledge = this.learning.getSiteKnowledge(adapter.id);
      const ctx: SiteAdapterContext = {
        demo: this.demo || !settings.chromeUserDataDir,
        chromeUserDataDir: settings.chromeUserDataDir || undefined,
        cvPath: settings.cvPath || undefined,
        timeoutMs: config.perJobTimeoutMs,
        knowledge,
        log: (level, message) => this.log(level, message),
        signal,
      };

      let jobs = [];
      try {
        jobs = await withTimeout(
          adapter.search(
            {
              keywords,
              location: config.location || settings.location,
              limit: config.jobLimitPerSite,
            },
            ctx,
          ),
          config.perSiteTimeoutMs,
          `${adapter.id} search timeout`,
          signal,
        );
      } catch (err) {
        this.log("error", `${adapter.displayNameHe}: חיפוש נכשל — ${errMsg(err)}`);
        continue;
      }

      this.patch({ found: this.progress.found + jobs.length });
      this.log("info", `נמצאו ${jobs.length} משרות ב-${adapter.displayNameHe}`);

      this.patch({ phase: "applying" });

      for (const job of jobs) {
        if (signal.aborted) break;
        this.patch({ currentJob: job.title, currentSite: adapter.id });

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
        allResults.push(result);
        this.progress.results = [...allResults];

        if (result.status === "applied") {
          this.patch({ applied: this.progress.applied + 1 });
          this.log("info", `✓ הוגש: ${job.title}`);
        } else if (result.status === "failed") {
          this.patch({ failed: this.progress.failed + 1 });
          this.log("error", `✗ נכשל: ${job.title} — ${result.reason}`);
        } else {
          this.patch({ skipped: this.progress.skipped + 1 });
        }
      }
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

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
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
