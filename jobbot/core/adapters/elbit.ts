import type { SiteAdapter } from "./types";
import { demoApply, demoJobs } from "./demo";
import {
  absoluteUrl,
  clickApplyAndConfirm,
  detectSiteWall,
} from "./board-apply";
import {
  BROWSER_CLOSED_CODE,
  fillFirst,
  hasBrowserSession,
  isBrowserClosedError,
  pickSelector,
  withBrowserPage,
} from "../browser/session";
import type { ApplyMethod, ApplyResult, JobListing, SiteAdapterContext, SiteSearchParams } from "../types";

/** Elbit Systems careers — primary portal */
export const ELBIT_CAREERS_URL = "https://elbitsystemscareer.com/";
export const ELBIT_JOBS_URL = "https://elbitsystemscareer.com/jobs/";

export const elbitAdapter: SiteAdapter = {
  id: "elbit",
  displayName: "Elbit Systems",
  displayNameHe: "אלביט מערכות",
  siteKind: "career-portal",
  status: "live",
  careersUrl: ELBIT_CAREERS_URL,
  defaultApplyMethod: "cv-upload",

  async search(params: SiteSearchParams, ctx: SiteAdapterContext): Promise<JobListing[]> {
    if (ctx.demo || !hasBrowserSession(ctx)) {
      ctx.log("info", "אלביט: מצב הדגמה / ללא דפדפן — מחזיר משרות לדוגמה");
      return demoJobs("elbit", params).map((j) => ({
        ...j,
        company: "Elbit Systems",
        url: ELBIT_JOBS_URL,
      }));
    }

    const keywords = params.keywords.join(" ");
    const limit = params.limit ?? 5;

    return withBrowserPage(ctx, async (page) => {
      const url = new URL(ELBIT_JOBS_URL);
      url.searchParams.set("q", keywords);
      url.searchParams.set("locale", "he_IL");

      ctx.log("info", `אלביט: מחפש בפורטל קריירה — ${keywords}`);
      await page.goto(url.toString(), {
        waitUntil: "domcontentloaded",
        timeout: Math.min(ctx.timeoutMs, 40000),
      });

      const wall = await detectSiteWall(page, "אלביט");
      if (wall) {
        ctx.log("warn", wall.reasonHe);
        return [];
      }

      // Client-rendered jobs list — try keyword field then wait for cards
      const searchFilled = await fillFirst(
        page,
        pickSelector(ctx.knowledge, "searchInput", [
          'input[placeholder*="Keyword" i]',
          'input[aria-label*="Keyword" i]',
          'input[placeholder*="חפש" i]',
          'input[type="search"]',
          'input[name="q"]',
        ]),
        keywords,
        8000,
      )
        .then(() => true)
        .catch(() => false);

      if (searchFilled) {
        await page.keyboard.press("Enter").catch(() => undefined);
        await new Promise((r) => setTimeout(r, 1500));
      }

      await page
        .locator('a[href*="/job/"], [data-job-id], .job-tile, .job-card')
        .first()
        .waitFor({ state: "attached", timeout: 15000 })
        .catch(() => undefined);

      const cardSelectors = pickSelector(ctx.knowledge, "jobCard", [
        'a[href*="/job/"]',
        "[data-job-id]",
        ".job-tile a",
        ".job-card a",
        "article a[href*='job']",
      ]);

      const jobs: JobListing[] = [];
      const seen = new Set<string>();

      for (const sel of cardSelectors) {
        const cards = page.locator(sel);
        const count = await cards.count().catch(() => 0);
        if (count === 0) continue;

        for (let i = 0; i < Math.min(count, limit * 3) && jobs.length < limit; i++) {
          const card = cards.nth(i);
          const href = (await card.getAttribute("href").catch(() => null)) || "";
          if (!href || href === "#" || href.startsWith("javascript:")) continue;
          const absolute = absoluteUrl(href, ELBIT_CAREERS_URL);
          if (!/\/job\//i.test(absolute) && !/jobId=/i.test(absolute)) continue;
          if (seen.has(absolute)) continue;
          seen.add(absolute);

          const title =
            (await card.textContent().catch(() => null))?.trim().replace(/\s+/g, " ").slice(0, 140) ||
            `Elbit ${keywords} ${i + 1}`;

          jobs.push({
            id: `elbit-${i}-${Date.now()}`,
            site: "elbit",
            title,
            company: "Elbit Systems",
            url: absolute,
            location: params.location || "Israel",
          });
        }
        if (jobs.length) break;
      }

      if (jobs.length === 0) {
        ctx.log(
          "warn",
          "אלביט: לא נמצאו משרות — ייתכן שדרושה התחברות לפרופיל בפורטל או שינוי סלקטורים",
        );
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
          timeout: Math.min(ctx.timeoutMs, 35000),
        });

        return clickApplyAndConfirm({
          page,
          ctx,
          job,
          method,
          labelHe: "אלביט",
          started,
          applySelectors: pickSelector(ctx.knowledge, "apply", [
            "button:has-text('Apply now')",
            "a:has-text('Apply now')",
            "button:has-text('Apply')",
            "a:has-text('Apply')",
            "button:has-text('הגש מועמדות')",
            "a:has-text('הגש מועמדות')",
            "button:has-text('הגשת מועמדות')",
            "button:has-text('שלח')",
            'input[name="ContactForm[cvfile]"]',
            "a:has-text('צור פרופיל')",
          ]),
          // Hunter lead form + portal both expect CV when file input exists
          requireCvUpload: Boolean(ctx.cvPath),
          fillProfileFields: true,
          confirmExtra: [
            "text=/application submitted/i",
            "text=/thank you for applying/i",
            "text=/המועמדות נשלחה/i",
            "text=/תודה על הגשת/i",
            "text=/הפרטים נשלחו/i",
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
