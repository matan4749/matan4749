import type { SiteAdapter } from "./types";
import { demoApply, demoJobs } from "./demo";
import { detectApplyConfirmation } from "./confirm";
import { clickFirst, pickSelector, withBrowserPage } from "../browser/session";
import type { ApplyMethod, ApplyResult, JobListing, SiteAdapterContext, SiteSearchParams } from "../types";

export const indeedAdapter: SiteAdapter = {
  id: "indeed",
  displayName: "Indeed",
  displayNameHe: "אינדיד",
  siteKind: "board",
  status: "live",
  defaultApplyMethod: "cv-upload",

  async search(params: SiteSearchParams, ctx: SiteAdapterContext): Promise<JobListing[]> {
    if (ctx.demo || !ctx.chromeUserDataDir) {
      ctx.log("info", "Indeed: מצב הדגמה / ללא פרופיל — מחזיר משרות לדוגמה");
      return demoJobs("indeed", params);
    }

    const keywords = params.keywords.join(" ");
    const limit = params.limit ?? 5;

    return withBrowserPage(ctx, async (page) => {
      const url = new URL("https://il.indeed.com/jobs");
      url.searchParams.set("q", keywords);
      if (params.location) url.searchParams.set("l", params.location);

      ctx.log("info", `Indeed: מחפש — ${keywords}`);
      await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: ctx.timeoutMs });

      const cardSelectors = pickSelector(ctx.knowledge, "jobCard", [
        ".job_seen_beacon",
        "div.jobsearch-ResultsList > div",
        "[data-jk]",
        ".resultContent",
      ]);

      const jobs: JobListing[] = [];
      for (const sel of cardSelectors) {
        const cards = page.locator(sel);
        const count = await cards.count().catch(() => 0);
        if (count === 0) continue;

        for (let i = 0; i < Math.min(count, limit); i++) {
          const card = cards.nth(i);
          const titleEl = card.locator("h2.jobTitle a, a.jcs-JobTitle, h2 a").first();
          const title = (await titleEl.textContent().catch(() => null))?.trim() || `Indeed job ${i + 1}`;
          const href = (await titleEl.getAttribute("href").catch(() => null)) || "";
          const jk = (await card.getAttribute("data-jk").catch(() => null)) || "";
          const absolute = href.startsWith("http")
            ? href
            : href
              ? `https://il.indeed.com${href}`
              : jk
                ? `https://il.indeed.com/viewjob?jk=${jk}`
                : url.toString();

          jobs.push({
            id: `indeed-${jk || i}-${Date.now()}`,
            site: "indeed",
            title,
            url: absolute,
            location: params.location,
          });
        }
        break;
      }

      if (jobs.length === 0) {
        ctx.log("warn", "Indeed: לא נמצאו משרות בדף התוצאות");
      }
      return jobs;
    });
  },

  async detectApplyMethod(_job: JobListing, _ctx: SiteAdapterContext): Promise<ApplyMethod> {
    return "cv-upload";
  },

  async apply(job: JobListing, ctx: SiteAdapterContext): Promise<ApplyResult> {
    const method = await this.detectApplyMethod(job, ctx);
    if (ctx.demo || !ctx.chromeUserDataDir) {
      return demoApply(job, ctx, method);
    }

    const started = Date.now();
    try {
      return await withBrowserPage(ctx, async (page) => {
        await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: ctx.timeoutMs });

        const applyBtns = pickSelector(ctx.knowledge, "apply", [
          "button:has-text('Apply now')",
          "button:has-text('הגש מועמדות')",
          "#indeedApplyButton",
          "button.ia-IndeedApplyButton",
          "a[href*='indeedapply']",
        ]);

        await clickFirst(page, applyBtns, ctx.timeoutMs);
        ctx.log("info", "Indeed: נפתח טופס הגשה");

        if (ctx.cvPath) {
          const fileInputs = page.locator('input[type="file"]');
          const n = await fileInputs.count();
          if (n > 0) {
            await fileInputs.first().setInputFiles(ctx.cvPath);
            ctx.log("info", "Indeed: הועלה קו״ח");
          } else if (!ctx.knowledge.skipSteps.includes("cvUploadRequired")) {
            throw new Error("CV_UPLOAD_INPUT_NOT_FOUND");
          }
        }

        const submit = pickSelector(ctx.knowledge, "submit", [
          "button:has-text('Submit')",
          "button:has-text('המשך')",
          "button:has-text('שלח')",
          "button[type='submit']",
        ]);
        await clickFirst(page, submit, Math.min(ctx.timeoutMs, 25000));

        const { confirmed, matched } = await detectApplyConfirmation(page, ctx, [
          "text=/application submitted/i",
          "text=/you applied/i",
        ]);
        if (!confirmed) {
          ctx.log("warn", "Indeed: אין אישור הגשה במסך — לא מסומן כהצלחה");
          return {
            job,
            status: "unknown",
            method,
            reason: "לא אומתה הגשה — לא נמצא מסך/הודעת אישור אחרי שליחה",
            durationMs: Date.now() - started,
            confirmed: false,
          };
        }

        ctx.log("info", `Indeed: אומתה הגשה (${matched})`);
        return {
          job,
          status: "applied",
          method,
          reason: `אושר במסך: ${matched}`,
          durationMs: Date.now() - started,
          confirmed: true,
        };
      });
    } catch (err) {
      return {
        job,
        status: "failed",
        method,
        reason: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
        confirmed: false,
      };
    }
  },
};
