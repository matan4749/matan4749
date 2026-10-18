import type { SiteAdapter } from "./types";
import { demoApply, demoJobs } from "./demo";
import { clickFirst, pickSelector, withBrowserPage } from "../browser/session";
import type { ApplyMethod, ApplyResult, JobListing, SiteAdapterContext, SiteSearchParams } from "../types";

/** Elbit Systems careers portal — https://elbitsystems.com/careers/ */
export const ELBIT_CAREERS_URL = "https://elbitsystems.com/careers/";

export const elbitAdapter: SiteAdapter = {
  id: "elbit",
  displayName: "Elbit Systems",
  displayNameHe: "אלביט מערכות",
  siteKind: "career-portal",
  status: "stub",
  careersUrl: ELBIT_CAREERS_URL,
  defaultApplyMethod: "cv-upload",

  async search(params: SiteSearchParams, ctx: SiteAdapterContext): Promise<JobListing[]> {
    if (ctx.demo || !ctx.chromeUserDataDir) {
      ctx.log("info", "אלביט: stub/דמו — פורטל קריירה (התחבר ב-Chrome ואז נחדד סלקטורים)");
      return demoJobs("elbit", params).map((j) => ({
        ...j,
        company: "Elbit Systems",
        url: ELBIT_CAREERS_URL,
      }));
    }

    const keywords = params.keywords.join(" ");
    const limit = params.limit ?? 5;

    try {
      return await withBrowserPage(ctx, async (page) => {
        ctx.log("info", `אלביט: פותח פורטל קריירה — ${ELBIT_CAREERS_URL}`);
        await page.goto(ELBIT_CAREERS_URL, {
          waitUntil: "domcontentloaded",
          timeout: ctx.timeoutMs,
        });

        const cardSelectors = pickSelector(ctx.knowledge, "jobCard", [
          "a[href*='job']",
          ".job-listing",
          ".careers-job",
          "[data-job]",
          "article",
        ]);

        const jobs: JobListing[] = [];
        for (const sel of cardSelectors) {
          const cards = page.locator(sel);
          const count = await cards.count().catch(() => 0);
          if (count === 0) continue;
          for (let i = 0; i < Math.min(count, limit); i++) {
            const card = cards.nth(i);
            const title = ((await card.textContent().catch(() => null)) || `Elbit ${keywords} ${i + 1}`)
              .trim()
              .slice(0, 120);
            const href = (await card.getAttribute("href").catch(() => null)) || ELBIT_CAREERS_URL;
            const absolute = href.startsWith("http") ? href : new URL(href, ELBIT_CAREERS_URL).toString();
            jobs.push({
              id: `elbit-${i}-${Date.now()}`,
              site: "elbit",
              title,
              company: "Elbit Systems",
              url: absolute,
              location: params.location || "Israel",
            });
          }
          break;
        }

        if (jobs.length === 0) {
          ctx.log("warn", "אלביט: לא נמצאו משרות בדף — נשמר כ-stub עד כוונון סלקטורים");
          return demoJobs("elbit", params).map((j) => ({
            ...j,
            company: "Elbit Systems",
            url: ELBIT_CAREERS_URL,
          }));
        }
        return jobs;
      });
    } catch (err) {
      ctx.log("error", `אלביט חיפוש: ${err instanceof Error ? err.message : String(err)}`);
      return demoJobs("elbit", params).map((j) => ({
        ...j,
        company: "Elbit Systems",
        url: ELBIT_CAREERS_URL,
      }));
    }
  },

  async detectApplyMethod(_job: JobListing, _ctx: SiteAdapterContext): Promise<ApplyMethod> {
    return "cv-upload";
  },

  async apply(job: JobListing, ctx: SiteAdapterContext): Promise<ApplyResult> {
    const method = await this.detectApplyMethod(job, ctx);
    const started = Date.now();
    // Stub until live: never claim a real submit
    if (ctx.demo || !ctx.chromeUserDataDir || this.status === "stub") {
      if (ctx.demo || !ctx.chromeUserDataDir) return demoApply(job, ctx, method);
      const reason = "לא מיושם עדיין — אדפטר אלביט (stub); לא הוגשה מועמדות";
      ctx.log("warn", `⚠ אלביט: ${reason}`);
      return {
        job,
        status: "not_implemented",
        method,
        reason,
        durationMs: Date.now() - started,
        confirmed: false,
      };
    }

    try {
      return await withBrowserPage(ctx, async (page) => {
        await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: ctx.timeoutMs });
        const applyBtns = pickSelector(ctx.knowledge, "apply", [
          "button:has-text('Apply')",
          "a:has-text('Apply')",
          "button:has-text('הגש')",
          "a:has-text('הגש מועמדות')",
        ]);
        await clickFirst(page, applyBtns, ctx.timeoutMs);
        if (ctx.cvPath) {
          const files = page.locator('input[type="file"]');
          if ((await files.count()) > 0) await files.first().setInputFiles(ctx.cvPath);
        }
        // Live path still requires confirmation before applied — until then unknown
        return {
          job,
          status: "unknown",
          method,
          reason: "זרימת אלביט חיה עדיין ללא אימות מסך אישור",
          durationMs: Date.now() - started,
          confirmed: false,
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
