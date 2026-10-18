import type { SiteAdapter } from "./types";
import { demoApply, demoJobs } from "./demo";
import { clickFirst, fillFirst, pickSelector, withBrowserPage } from "../browser/session";
import type { ApplyMethod, ApplyResult, JobListing, SiteAdapterContext, SiteSearchParams } from "../types";

const SEARCH_URL = "https://www.linkedin.com/jobs/search/";

export const linkedinAdapter: SiteAdapter = {
  id: "linkedin",
  displayName: "LinkedIn",
  displayNameHe: "לינקדאין",
  siteKind: "board",
  status: "live",
  defaultApplyMethod: "chrome-session",

  async search(params: SiteSearchParams, ctx: SiteAdapterContext): Promise<JobListing[]> {
    if (ctx.demo || !ctx.chromeUserDataDir) {
      ctx.log("info", "LinkedIn: מצב הדגמה / ללא פרופיל Chrome — מחזיר משרות לדוגמה");
      return demoJobs("linkedin", params);
    }

    const keywords = params.keywords.join(" ");
    const limit = params.limit ?? 5;

    return withBrowserPage(ctx, async (page) => {
      const url = new URL(SEARCH_URL);
      url.searchParams.set("keywords", keywords);
      if (params.location) url.searchParams.set("location", params.location);
      url.searchParams.set("f_AL", "true"); // Easy Apply

      ctx.log("info", `LinkedIn: מחפש — ${keywords}`);
      await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: ctx.timeoutMs });

      const cardSelectors = pickSelector(ctx.knowledge, "jobCard", [
        "ul.jobs-search__results-list li",
        ".scaffold-layout__list-item",
        ".job-card-container",
        "[data-job-id]",
      ]);

      const jobs: JobListing[] = [];
      for (const sel of cardSelectors) {
        const cards = page.locator(sel);
        const count = await cards.count().catch(() => 0);
        if (count === 0) continue;

        for (let i = 0; i < Math.min(count, limit); i++) {
          const card = cards.nth(i);
          const title =
            (await card.locator("a.job-card-list__title, .job-card-list__title, a").first().textContent().catch(() => null))?.trim() ||
            `LinkedIn job ${i + 1}`;
          const href =
            (await card.locator("a").first().getAttribute("href").catch(() => null)) ||
            SEARCH_URL;
          const absolute = href.startsWith("http") ? href : `https://www.linkedin.com${href}`;
          jobs.push({
            id: `linkedin-${i}-${Date.now()}`,
            site: "linkedin",
            title,
            url: absolute,
            location: params.location,
          });
        }
        break;
      }

      if (jobs.length === 0) {
        ctx.log("warn", "LinkedIn: לא נמצאו כרטיסי משרה — ייתכן שדרוש login בפרופיל");
      }
      return jobs;
    });
  },

  async detectApplyMethod(_job: JobListing, _ctx: SiteAdapterContext): Promise<ApplyMethod> {
    return "chrome-session";
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

        if (ctx.knowledge.skipSteps.includes("easyApplyClick")) {
          throw new Error("Learning KB: skipping broken easyApplyClick step");
        }

        const easyApply = pickSelector(ctx.knowledge, "easyApply", [
          "button.jobs-apply-button",
          "button:has-text('Easy Apply')",
          "button:has-text('הגשה קלה')",
          "[aria-label*='Easy Apply']",
        ]);

        const used = await clickFirst(page, easyApply, ctx.timeoutMs);
        ctx.log("info", `LinkedIn: Easy Apply דרך ${used}`);

        // Optional CV upload if file input appears
        if (ctx.cvPath) {
          const fileInputs = page.locator('input[type="file"]');
          if ((await fileInputs.count()) > 0) {
            await fileInputs.first().setInputFiles(ctx.cvPath);
            ctx.log("info", "LinkedIn: הועלה קו״ח");
          }
        }

        const submit = pickSelector(ctx.knowledge, "submit", [
          "button[aria-label='Submit application']",
          "button:has-text('Submit')",
          "button:has-text('שלח')",
          "button:has-text('Submit application')",
        ]);

        try {
          await clickFirst(page, submit, Math.min(ctx.timeoutMs, 20000));
        } catch {
          // Multi-step Easy Apply — try Next then Submit
          const next = pickSelector(ctx.knowledge, "next", [
            "button:has-text('Next')",
            "button:has-text('הבא')",
            "button[aria-label='Continue to next step']",
          ]);
          await clickFirst(page, next, 10000).catch(() => undefined);
          await clickFirst(page, submit, 15000);
        }

        return {
          job,
          status: "applied",
          method,
          durationMs: Date.now() - started,
        };
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        job,
        status: "failed",
        method,
        reason,
        durationMs: Date.now() - started,
      };
    }
  },
};

/** Exported for learning tests — fill search box when on homepage */
export async function linkedinFillSearch(
  page: import("playwright").Page,
  keywords: string,
  ctx: SiteAdapterContext,
): Promise<void> {
  const sels = pickSelector(ctx.knowledge, "searchInput", [
    "input[aria-label*='Search']",
    "input.jobs-search-box__text-input",
  ]);
  await fillFirst(page, sels, keywords, ctx.timeoutMs);
}
