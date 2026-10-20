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

export const ALLJOBS_SEARCH =
  "https://www.alljobs.co.il/SearchResultsGuest.aspx";
export const ALLJOBS_HOME = "https://www.alljobs.co.il/";

export const alljobsAdapter: SiteAdapter = {
  id: "alljobs",
  displayName: "AllJobs",
  displayNameHe: "אולג'ובס",
  siteKind: "board",
  status: "live",
  careersUrl: ALLJOBS_HOME,
  defaultApplyMethod: "cv-upload",

  async search(params: SiteSearchParams, ctx: SiteAdapterContext): Promise<JobListing[]> {
    if (ctx.demo || !hasBrowserSession(ctx)) {
      ctx.log("info", "אולג'ובס: מצב הדגמה / ללא דפדפן — מחזיר משרות לדוגמה");
      return demoJobs("alljobs", params);
    }

    const keywords = params.keywords.join(" ");
    const limit = params.limit ?? 5;

    return withBrowserPage(ctx, async (page) => {
      const url = new URL(ALLJOBS_SEARCH);
      url.searchParams.set("page", "1");
      url.searchParams.set("position", keywords);
      url.searchParams.set("type", "");
      url.searchParams.set("city", "");
      url.searchParams.set("region", "");

      ctx.log("info", `אולג'ובס: מחפש — ${keywords}`);
      await page.goto(url.toString(), {
        waitUntil: "domcontentloaded",
        timeout: Math.min(ctx.timeoutMs, 35000),
      });

      const wall = await detectSiteWall(page, "אולג'ובס");
      if (wall) {
        ctx.log("warn", wall.reasonHe);
        return [];
      }

      const cardSelectors = pickSelector(ctx.knowledge, "jobCard", [
        ".job-box",
        "[id^='job-box-container']",
        ".job-content-top-title",
      ]);

      const jobs: JobListing[] = [];
      const seen = new Set<string>();

      for (const sel of cardSelectors) {
        const cards = page.locator(sel);
        const count = await cards.count().catch(() => 0);
        if (count === 0) continue;

        for (let i = 0; i < Math.min(count, limit * 3) && jobs.length < limit; i++) {
          const card = cards.nth(i);
          const link = card.locator('a[href*="UploadSingle.aspx?JobID="]').first();
          const href = (await link.getAttribute("href").catch(() => null)) || "";
          const jobId = href.match(/JobID=(\d+)/i)?.[1];
          if (!jobId || seen.has(jobId)) continue;
          seen.add(jobId);

          const title =
            (await link.locator("h2").textContent().catch(() => null))?.trim() ||
            (await link.getAttribute("title").catch(() => null))?.trim() ||
            (await link.textContent().catch(() => null))?.trim() ||
            `AllJobs ${jobId}`;

          jobs.push({
            id: `alljobs-${jobId}`,
            site: "alljobs",
            title: title.slice(0, 160),
            url: absoluteUrl(href, ALLJOBS_HOME),
            location: params.location || "Israel",
          });
        }
        if (jobs.length) break;
      }

      if (jobs.length === 0) {
        ctx.log("warn", "אולג'ובס: לא נמצאו משרות בדף התוצאות");
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
          labelHe: "אולג'ובס",
          started,
          applySelectors: pickSelector(ctx.knowledge, "apply", [
            ".job-button-send a[aria-label='הגש מועמדות']",
            ".job-button-send a",
            "a[eventlabel='הגש מועמדות']",
            "a:has-text('הגשת מועמדות')",
            "button:has-text('הגשת מועמדות')",
            "a:has-text('הגש מועמדות')",
          ]),
          confirmExtra: [
            "text=/המועמדות נשלחה/i",
            "text=/קורות החיים נשלחו/i",
            "text=/הבקשה נשלחה/i",
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
