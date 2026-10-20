import type { SiteAdapter } from "./types";
import { demoApply, demoJobs } from "./demo";
import {
  absoluteUrl,
  clickApplyAndConfirm,
  detectSiteWall,
} from "./board-apply";
import {
  BROWSER_CLOSED_CODE,
  hasBrowserSession,
  isBrowserClosedError,
  pickSelector,
  withBrowserPage,
} from "../browser/session";
import type { ApplyMethod, ApplyResult, JobListing, SiteAdapterContext, SiteSearchParams } from "../types";

export const DRUSHIM_HOME = "https://www.drushim.co.il/";

export const drushimAdapter: SiteAdapter = {
  id: "drushim",
  displayName: "Drushim",
  displayNameHe: "דרושים",
  siteKind: "board",
  status: "live",
  careersUrl: DRUSHIM_HOME,
  defaultApplyMethod: "cv-upload",

  async search(params: SiteSearchParams, ctx: SiteAdapterContext): Promise<JobListing[]> {
    if (ctx.demo || !hasBrowserSession(ctx)) {
      ctx.log("info", "דרושים: מצב הדגמה / ללא דפדפן — מחזיר משרות לדוגמה");
      return demoJobs("drushim", params);
    }

    const keywords = params.keywords.join(" ");
    const limit = params.limit ?? 5;

    return withBrowserPage(ctx, async (page) => {
      const pathKw = encodeURIComponent(keywords.trim() || "מפתח");
      const searchUrl = `https://www.drushim.co.il/jobs/search/${pathKw}/`;
      ctx.log("info", `דרושים: מחפש — ${keywords}`);
      await page.goto(searchUrl, {
        waitUntil: "domcontentloaded",
        timeout: Math.min(ctx.timeoutMs, 35000),
      });

      const wall = await detectSiteWall(page, "דרושים");
      if (wall) {
        ctx.log("warn", wall.reasonHe);
        return [];
      }

      // Wait briefly for SPA cards
      await page
        .locator('[data-nagish="job-card-item"], a[href*="/job/"]')
        .first()
        .waitFor({ state: "attached", timeout: 12000 })
        .catch(() => undefined);

      const cardSelectors = pickSelector(ctx.knowledge, "jobCard", [
        '[data-nagish="job-card-item"]',
        "a[href*='/job/']",
      ]);

      const jobs: JobListing[] = [];
      const seen = new Set<string>();

      for (const sel of cardSelectors) {
        const cards = page.locator(sel);
        const count = await cards.count().catch(() => 0);
        if (count === 0) continue;

        for (let i = 0; i < Math.min(count, limit * 2) && jobs.length < limit; i++) {
          const card = cards.nth(i);
          const link = card.locator('a[data-nagish="job-card-details-link"], a[href*="/job/"]').first();
          const href =
            (await link.getAttribute("href").catch(() => null)) ||
            (await card.getAttribute("href").catch(() => null)) ||
            "";
          if (!href.includes("/job/")) continue;
          const absolute = absoluteUrl(href, DRUSHIM_HOME);
          if (seen.has(absolute)) continue;
          seen.add(absolute);

          const title =
            (await card.locator('[data-nagish="job-card-title"]').textContent().catch(() => null))?.trim() ||
            (await link.textContent().catch(() => null))?.trim() ||
            `Drushim job ${i + 1}`;

          const idMatch = absolute.match(/\/job\/(\d+)/);
          jobs.push({
            id: `drushim-${idMatch?.[1] || i}-${Date.now()}`,
            site: "drushim",
            title: title.slice(0, 160),
            url: absolute,
            location: params.location || "Israel",
          });
        }
        if (jobs.length) break;
      }

      if (jobs.length === 0) {
        ctx.log("warn", "דרושים: לא נמצאו משרות בדף התוצאות");
      }
      return jobs;
    });
  },

  async detectApplyMethod(_job: JobListing, _ctx: SiteAdapterContext): Promise<ApplyMethod> {
    return "cv-upload";
  },

  async apply(job: JobListing, ctx: SiteAdapterContext): Promise<ApplyResult> {
    const method = await this.detectApplyMethod(job, ctx);
    if (ctx.demo || !hasBrowserSession(ctx)) {
      return demoApply(job, ctx, method);
    }

    const started = Date.now();
    try {
      return await withBrowserPage(ctx, async (page) => {
        await page.goto(job.url, {
          waitUntil: "domcontentloaded",
          timeout: Math.min(ctx.timeoutMs, 30000),
        });

        return clickApplyAndConfirm({
          page,
          ctx,
          job,
          method,
          labelHe: "דרושים",
          started,
          applySelectors: pickSelector(ctx.knowledge, "apply", [
            '[data-nagish="job-card-apply-link"]',
            "a:has-text('הגשת מועמדות')",
            "button:has-text('הגשת מועמדות')",
            "a:has-text('שלח/י קורות חיים')",
            "button:has-text('שלח קורות חיים')",
            "a:has-text('הגש מועמדות')",
          ]),
          confirmExtra: [
            "text=/המועמדות נשלחה/i",
            "text=/קורות החיים נשלחו/i",
            "text=/הגשת בהצלחה/i",
            "text=/תודה על הגשת/i",
          ],
        });
      });
    } catch (err) {
      if (isBrowserClosedError(err)) throw new Error(BROWSER_CLOSED_CODE);
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
