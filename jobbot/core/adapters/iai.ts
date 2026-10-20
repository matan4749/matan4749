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

/** Israel Aerospace Industries (תעשייה אווירית) careers */
export const IAI_CAREERS_URL = "https://jobs.iai.co.il/jobs";
export const IAI_HOME = "https://jobs.iai.co.il/";

export const iaiAdapter: SiteAdapter = {
  id: "iai",
  displayName: "IAI",
  displayNameHe: "תעשייה אווירית",
  siteKind: "career-portal",
  status: "live",
  careersUrl: IAI_CAREERS_URL,
  defaultApplyMethod: "cv-upload",

  async search(params: SiteSearchParams, ctx: SiteAdapterContext): Promise<JobListing[]> {
    if (ctx.demo || !hasBrowserSession(ctx)) {
      ctx.log("info", "תע״א: מצב הדגמה / ללא דפדפן — מחזיר משרות לדוגמה");
      return demoJobs("iai", params).map((j) => ({
        ...j,
        company: "IAI",
        url: IAI_CAREERS_URL,
      }));
    }

    const keywords = params.keywords.join(" ");
    const limit = params.limit ?? 5;

    return withBrowserPage(ctx, async (page) => {
      ctx.log("info", `תע״א: פותח פורטל קריירה — ${IAI_CAREERS_URL}`);
      await page.goto(IAI_CAREERS_URL, {
        waitUntil: "domcontentloaded",
        timeout: Math.min(ctx.timeoutMs, 45000),
      });

      // Bot / WAF wall is common on jobs.iai.co.il from datacenter IPs;
      // with Matan's real Chrome profile after login gate it often passes.
      const wall = await detectSiteWall(page, "תע״א");
      if (wall) {
        ctx.log("warn", wall.reasonHe);
        return [];
      }

      await new Promise((r) => setTimeout(r, 2000));

      const searchFilled = await fillFirst(
        page,
        pickSelector(ctx.knowledge, "searchInput", [
          'input[type="search"]',
          'input[placeholder*="חיפוש" i]',
          'input[placeholder*="Search" i]',
          'input[name*="search" i]',
          'input[aria-label*="חיפוש" i]',
          'input[aria-label*="Search" i]',
        ]),
        keywords,
        8000,
      )
        .then(() => true)
        .catch(() => false);

      if (searchFilled) {
        await page.keyboard.press("Enter").catch(() => undefined);
        await new Promise((r) => setTimeout(r, 2000));
      }

      await page
        .locator('a[href*="job"], a[href*="position"], .job-item, .job-card, article a')
        .first()
        .waitFor({ state: "attached", timeout: 15000 })
        .catch(() => undefined);

      const cardSelectors = pickSelector(ctx.knowledge, "jobCard", [
        "a[href*='/job']",
        "a[href*='position']",
        "a[href*='Job']",
        ".job-item a",
        ".job-card a",
        ".career-listing a",
        "[data-job-id]",
        "article a",
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
          const absolute = absoluteUrl(href, IAI_HOME);
          if (seen.has(absolute)) continue;
          // Skip pure nav links
          if (/\/wp-content\/|mailto:|#apply$/i.test(absolute) && !/job|position/i.test(absolute)) {
            continue;
          }
          seen.add(absolute);

          const title =
            (await card.textContent().catch(() => null))?.trim().replace(/\s+/g, " ").slice(0, 140) ||
            `IAI ${keywords} ${i + 1}`;

          jobs.push({
            id: `iai-${i}-${Date.now()}`,
            site: "iai",
            title,
            company: "IAI",
            url: absolute,
            location: params.location || "Israel",
          });
        }
        if (jobs.length) break;
      }

      if (jobs.length === 0) {
        ctx.log(
          "warn",
          "תע״א: לא נמצאו משרות — ייתכן bot-wall או שדרושה התחברות בפורטל אחרי שער ההתחברות",
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
          timeout: Math.min(ctx.timeoutMs, 40000),
        });

        const wall = await detectSiteWall(page, "תע״א");
        if (wall) {
          return {
            job,
            status: wall.kind === "vip" ? "skipped" : "not_implemented",
            method,
            reason: wall.reasonHe,
            durationMs: Date.now() - started,
            confirmed: false,
          };
        }

        return clickApplyAndConfirm({
          page,
          ctx,
          job,
          method,
          labelHe: "תע״א",
          started,
          applySelectors: pickSelector(ctx.knowledge, "apply", [
            "button:has-text('הגש')",
            "a:has-text('הגשת מועמדות')",
            "button:has-text('הגשת מועמדות')",
            "a:has-text('הגש מועמדות')",
            "button:has-text('שלח קורות חיים')",
            "a:has-text('שלח קורות חיים')",
            "button:has-text('Apply')",
            "a:has-text('Apply')",
            "button:has-text('Apply now')",
          ]),
          confirmExtra: [
            "text=/המועמדות נשלחה/i",
            "text=/תודה על הגשת/i",
            "text=/application submitted/i",
            "text=/thank you for applying/i",
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
