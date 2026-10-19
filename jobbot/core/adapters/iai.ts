import type { SiteAdapter } from "./types";
import { demoApply, demoJobs } from "./demo";
import { clickFirst, hasBrowserSession, pickSelector, withBrowserPage } from "../browser/session";
import type { ApplyMethod, ApplyResult, JobListing, SiteAdapterContext, SiteSearchParams } from "../types";

/** Israel Aerospace Industries (תעשייה אווירית) careers */
export const IAI_CAREERS_URL = "https://www.iai.co.il/careers";

export const iaiAdapter: SiteAdapter = {
  id: "iai",
  displayName: "IAI",
  displayNameHe: "תעשייה אווירית",
  siteKind: "career-portal",
  status: "stub",
  careersUrl: IAI_CAREERS_URL,
  defaultApplyMethod: "cv-upload",

  async search(params: SiteSearchParams, ctx: SiteAdapterContext): Promise<JobListing[]> {
    if (ctx.demo || !hasBrowserSession(ctx)) {
      ctx.log("info", "תע״א: stub/דמו — פורטל קריירה (התחבר ב-Chrome ואז נחדד סלקטורים)");
      return demoJobs("iai", params).map((j) => ({
        ...j,
        company: "IAI",
        url: IAI_CAREERS_URL,
      }));
    }

    const keywords = params.keywords.join(" ");
    const limit = params.limit ?? 5;

    try {
      return await withBrowserPage(ctx, async (page) => {
        ctx.log("info", `תע״א: פותח פורטל קריירה — ${IAI_CAREERS_URL}`);
        await page.goto(IAI_CAREERS_URL, {
          waitUntil: "domcontentloaded",
          timeout: ctx.timeoutMs,
        });

        const cardSelectors = pickSelector(ctx.knowledge, "jobCard", [
          "a[href*='job']",
          "a[href*='career']",
          ".job-item",
          ".career-listing",
          "[data-job-id]",
          "article",
        ]);

        const jobs: JobListing[] = [];
        for (const sel of cardSelectors) {
          const cards = page.locator(sel);
          const count = await cards.count().catch(() => 0);
          if (count === 0) continue;
          for (let i = 0; i < Math.min(count, limit); i++) {
            const card = cards.nth(i);
            const title = ((await card.textContent().catch(() => null)) || `IAI ${keywords} ${i + 1}`)
              .trim()
              .slice(0, 120);
            const href = (await card.getAttribute("href").catch(() => null)) || IAI_CAREERS_URL;
            const absolute = href.startsWith("http") ? href : new URL(href, IAI_CAREERS_URL).toString();
            jobs.push({
              id: `iai-${i}-${Date.now()}`,
              site: "iai",
              title,
              company: "IAI",
              url: absolute,
              location: params.location || "Israel",
            });
          }
          break;
        }

        if (jobs.length === 0) {
          ctx.log("warn", "תע״א: לא נמצאו משרות בדף — נשמר כ-stub עד כוונון סלקטורים");
          return demoJobs("iai", params).map((j) => ({
            ...j,
            company: "IAI",
            url: IAI_CAREERS_URL,
          }));
        }
        return jobs;
      });
    } catch (err) {
      ctx.log("error", `תע״א חיפוש: ${err instanceof Error ? err.message : String(err)}`);
      return demoJobs("iai", params).map((j) => ({
        ...j,
        company: "IAI",
        url: IAI_CAREERS_URL,
      }));
    }
  },

  async detectApplyMethod(_job: JobListing, _ctx: SiteAdapterContext): Promise<ApplyMethod> {
    return "cv-upload";
  },

  async apply(job: JobListing, ctx: SiteAdapterContext): Promise<ApplyResult> {
    const method = await this.detectApplyMethod(job, ctx);
    const started = Date.now();
    if (ctx.demo || !hasBrowserSession(ctx) || this.status === "stub") {
      if (ctx.demo || !hasBrowserSession(ctx)) return demoApply(job, ctx, method);
      const reason = "לא מיושם עדיין — אדפטר תע״א (stub); לא הוגשה מועמדות";
      ctx.log("warn", `⚠ תע״א: ${reason}`);
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
          "a:has-text('הגשת מועמדות')",
          "button:has-text('שלח קורות חיים')",
        ]);
        await clickFirst(page, applyBtns, ctx.timeoutMs);
        if (ctx.cvPath) {
          const files = page.locator('input[type="file"]');
          if ((await files.count()) > 0) await files.first().setInputFiles(ctx.cvPath);
        }
        return {
          job,
          status: "unknown",
          method,
          reason: "זרימת תע״א חיה עדיין ללא אימות מסך אישור",
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
