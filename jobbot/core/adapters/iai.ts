import type { SiteAdapter } from "./types";
import { demoApply, demoJobs } from "./demo";
import {
  absoluteUrl,
  clickApplyAndConfirm,
  detectSiteWall,
} from "./board-apply";
import { fillApplicantFields, uploadCvFromSettings } from "./form-fill";
import { detectApplyConfirmation } from "./confirm";
import {
  BROWSER_CLOSED_CODE,
  clickFirst,
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
export const IAI_APPLICATION_BASE = "https://jobs.iai.co.il/application/";

/** Prefer canonical application URL when job id is known */
export function iaiApplicationUrl(job: JobListing): string {
  const fromPath = job.url.match(/\/application\/(\d+)/i)?.[1];
  if (fromPath) return `${IAI_APPLICATION_BASE}${fromPath}/`;
  const fromId = job.id.match(/(\d{6,})/)?.[1];
  if (fromId && !job.url.includes("/jobs")) return `${IAI_APPLICATION_BASE}${fromId}/`;
  const q = job.url.match(/[?&](?:jobId|id|application)=(\d+)/i)?.[1];
  if (q) return `${IAI_APPLICATION_BASE}${q}/`;
  return job.url;
}

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
        .locator(
          'a[href*="/application/"], a[href*="job"], a[href*="position"], .job-item, .job-card, article a',
        )
        .first()
        .waitFor({ state: "attached", timeout: 15000 })
        .catch(() => undefined);

      const cardSelectors = pickSelector(ctx.knowledge, "jobCard", [
        'a[href*="/application/"]',
        "a[href*='/job']",
        "a[href*='position']",
        ".job-item a",
        ".job-card a",
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
          let absolute = absoluteUrl(href, IAI_HOME);
          const appId = absolute.match(/\/application\/(\d+)/i)?.[1];
          if (appId) absolute = `${IAI_APPLICATION_BASE}${appId}/`;
          if (seen.has(absolute)) continue;
          if (/\/wp-content\/|mailto:/i.test(absolute) && !/application|job|position/i.test(absolute)) {
            continue;
          }
          seen.add(absolute);

          const title =
            (await card.textContent().catch(() => null))?.trim().replace(/\s+/g, " ").slice(0, 140) ||
            `IAI ${keywords} ${i + 1}`;

          jobs.push({
            id: `iai-${appId || i}-${Date.now()}`,
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
    const target = iaiApplicationUrl(job);
    try {
      return await withBrowserPage(ctx, async (page) => {
        ctx.log("info", `תע״א: פותח טופס הגשה — ${target}`);
        await page.goto(target, {
          waitUntil: "domcontentloaded",
          timeout: Math.min(ctx.timeoutMs, 45000),
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

        // Some listings land on job detail first — click into application
        const hasFileAlready =
          (await page.locator('input[type="file"]').count().catch(() => 0)) > 0;
        if (!hasFileAlready) {
          await clickFirst(
            page,
            pickSelector(ctx.knowledge, "apply", [
              "button:has-text('הגש')",
              "a:has-text('הגשת מועמדות')",
              "button:has-text('הגשת מועמדות')",
              "a:has-text('הגש מועמדות')",
              "a[href*='/application/']",
              "button:has-text('Apply')",
              "a:has-text('Apply')",
            ]),
            10_000,
          ).catch(() => undefined);
          await new Promise((r) => setTimeout(r, 1000));
        }

        const midWall = await detectSiteWall(page, "תע״א");
        if (midWall) {
          return {
            job,
            status: midWall.kind === "vip" ? "skipped" : "not_implemented",
            method,
            reason: midWall.reasonHe,
            durationMs: Date.now() - started,
            confirmed: false,
          };
        }

        // IAI questionnaire: fill known profile fields
        await fillApplicantFields(page, ctx, "תע״א");

        // CV upload is required for a successful IAI application
        const cv = await uploadCvFromSettings(page, ctx, "תע״א", { required: true });
        if (!cv.uploaded) {
          return {
            job,
            status: "failed",
            method,
            reason:
              cv.reasonHe ||
              "תע״א: לא נמצא שדה העלאת קו״ח / ההעלאה לא אומתה — לא מסומן כהצלחה",
            durationMs: Date.now() - started,
            confirmed: false,
          };
        }

        // Submit questionnaire
        const submitted = await clickFirst(
          page,
          pickSelector(ctx.knowledge, "submit", [
            "button:has-text('שלח')",
            "button:has-text('הגש')",
            "button:has-text('הגשת מועמדות')",
            "button:has-text('Submit')",
            "button[type='submit']",
            "input[type='submit']",
          ]),
          12_000,
        )
          .then(() => true)
          .catch(() => false);

        if (!submitted) {
          // Fall back to shared multi-step helper without double-requiring CV
          return clickApplyAndConfirm({
            page,
            ctx,
            job,
            method,
            labelHe: "תע״א",
            started,
            applySelectors: ["button:has-text('שלח')", "button[type='submit']"],
            requireCvUpload: false,
            fillProfileFields: false,
            confirmExtra: [
              "text=/המועמדות נשלחה/i",
              "text=/תודה על הגשת/i",
              "text=/application submitted/i",
              "text=/הפניה התקבלה/i",
            ],
          });
        }

        const { confirmed, matched } = await detectApplyConfirmation(page, ctx, [
          "text=/המועמדות נשלחה/i",
          "text=/תודה על הגשת/i",
          "text=/הפניה התקבלה/i",
          "text=/application submitted/i",
          "text=/thank you for applying/i",
        ]);
        if (!confirmed) {
          ctx.log("warn", "תע״א: אין אישור הגשה במסך — לא מסומן כהצלחה");
          return {
            job,
            status: "unknown",
            method,
            reason: "לא אומתה הגשה — טופס/קו״ח מולאו אך אין מסך אישור",
            durationMs: Date.now() - started,
            confirmed: false,
          };
        }

        ctx.log("info", `תע״א: אומתה הגשה (${matched})`);
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
