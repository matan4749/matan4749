import type { Page } from "playwright";
import type { SiteAdapter } from "./types";
import { demoApply, demoJobs } from "./demo";
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

const SEARCH_URL = "https://www.linkedin.com/jobs/search/";

/** Per-step budget — avoid burning the whole per-job timeout on one click */
const STEP_MS = 12_000;
const EASY_APPLY_MS = 10_000;
const NEXT_MS = 8_000;
const SUBMIT_MS = 12_000;

export type LinkedInBlocker =
  | { kind: "captcha"; reasonHe: string }
  | { kind: "login"; reasonHe: string }
  | { kind: "modal"; reasonHe: string }
  | { kind: "external"; reasonHe: string }
  | { kind: "no_easy_apply"; reasonHe: string };

/**
 * Detect walls that make Easy Apply hang until the outer timeout.
 * Exported for unit tests.
 */
export async function detectLinkedInBlocker(page: Page): Promise<LinkedInBlocker | null> {
  const url = page.url();
  if (/\/checkpoint\/|\/challenge\//i.test(url) || /captcha/i.test(url)) {
    return { kind: "captcha", reasonHe: "דילוג: LinkedIn מבקש אימות / captcha" };
  }
  if (/\/login|\/uas\/login|authwall|\/signup/i.test(url)) {
    return { kind: "login", reasonHe: "דילוג: נדרשת התחברות ל-LinkedIn" };
  }

  const captchaVisible = await page
    .locator(
      [
        "iframe[src*='captcha']",
        "iframe[title*='captcha' i]",
        "#captcha-challenge",
        "[data-test-id='challenge']",
        "text=/security verification/i",
        "text=/אימות אבטחה/",
      ].join(", "),
    )
    .first()
    .isVisible()
    .catch(() => false);
  if (captchaVisible) {
    return { kind: "captcha", reasonHe: "דילוג: LinkedIn מבקש אימות / captcha" };
  }

  const loginWall = await page
    .locator("text=/sign in to continue|התחבר כדי להמשיך|join to apply/i")
    .first()
    .isVisible()
    .catch(() => false);
  if (loginWall) {
    return { kind: "login", reasonHe: "דילוג: נדרשת התחברות ל-LinkedIn" };
  }

  // Blocking modal / dismiss overlay without Easy Apply progress
  const blockingModal = await page
    .locator(
      [
        ".artdeco-modal--layer-default[aria-hidden='false']",
        "[data-test-modal][aria-hidden='false']",
        ".jobs-easy-apply-content [role='dialog']",
      ].join(", "),
    )
    .first()
    .isVisible()
    .catch(() => false);

  const easyApplyVisible = await page
    .locator(
      [
        "button.jobs-apply-button",
        "button:has-text('Easy Apply')",
        "button:has-text('הגשה קלה')",
        "[aria-label*='Easy Apply']",
      ].join(", "),
    )
    .first()
    .isVisible()
    .catch(() => false);

  const externalOnly = await page
    .locator("button:has-text('Apply'), a:has-text('Apply on company')")
    .first()
    .isVisible()
    .catch(() => false);

  if (!easyApplyVisible && externalOnly) {
    return {
      kind: "external",
      reasonHe: "דילוג: אין Easy Apply — הגשה חיצונית בלבד",
    };
  }

  if (blockingModal && !easyApplyVisible) {
    // Try dismiss once
    const dismissed = await page
      .locator(
        "button[aria-label='Dismiss'], button[aria-label='Close'], button:has-text('Not now'), button:has-text('לא עכשיו')",
      )
      .first()
      .click({ timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    if (!dismissed) {
      return { kind: "modal", reasonHe: "דילוג: חלון חוסם ב-LinkedIn" };
    }
  }

  return null;
}

export const linkedinAdapter: SiteAdapter = {
  id: "linkedin",
  displayName: "LinkedIn",
  displayNameHe: "לינקדאין",
  siteKind: "board",
  status: "live",
  defaultApplyMethod: "chrome-session",

  async search(params: SiteSearchParams, ctx: SiteAdapterContext): Promise<JobListing[]> {
    if (ctx.demo || !hasBrowserSession(ctx)) {
      ctx.log("info", "LinkedIn: מצב הדגמה / ללא דפדפן — מחזיר משרות לדוגמה");
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
      await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: Math.min(ctx.timeoutMs, 30000) });

      const early = await detectLinkedInBlocker(page);
      if (early?.kind === "login" || early?.kind === "captcha") {
        ctx.log("warn", `LinkedIn: ${early.reasonHe}`);
        return [];
      }

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
    if (ctx.demo || !hasBrowserSession(ctx)) {
      return demoApply(job, ctx, method);
    }

    const started = Date.now();
    try {
      return await withBrowserPage(ctx, async (page) => {
        await page.goto(job.url, {
          waitUntil: "domcontentloaded",
          timeout: Math.min(ctx.timeoutMs, 25000),
        });

        const blocker = await detectLinkedInBlocker(page);
        if (blocker) {
          ctx.log("warn", `LinkedIn: ${blocker.reasonHe} — ${job.title}`);
          return {
            job,
            status: "skipped",
            method,
            reason: blocker.reasonHe,
            durationMs: Date.now() - started,
            confirmed: false,
          };
        }

        if (ctx.knowledge.skipSteps.includes("easyApplyClick")) {
          return {
            job,
            status: "skipped",
            method,
            reason: "דילוג: Learning KB מסמן easyApplyClick כשבור",
            durationMs: Date.now() - started,
            confirmed: false,
          };
        }

        const easyApply = pickSelector(ctx.knowledge, "easyApply", [
          "button.jobs-apply-button",
          "button:has-text('Easy Apply')",
          "button:has-text('הגשה קלה')",
          "[aria-label*='Easy Apply']",
        ]);

        let used: string;
        try {
          used = await clickFirst(page, easyApply, EASY_APPLY_MS);
        } catch {
          const again = await detectLinkedInBlocker(page);
          if (again) {
            ctx.log("warn", `LinkedIn: ${again.reasonHe}`);
            return {
              job,
              status: "skipped",
              method,
              reason: again.reasonHe,
              durationMs: Date.now() - started,
              confirmed: false,
            };
          }
          return {
            job,
            status: "skipped",
            method,
            reason: "דילוג: לא נמצא כפתור Easy Apply",
            durationMs: Date.now() - started,
            confirmed: false,
          };
        }
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
          "button:has-text('Submit application')",
          "button:has-text('Submit')",
          "button:has-text('שלח')",
        ]);

        const next = pickSelector(ctx.knowledge, "next", [
          "button:has-text('Next')",
          "button:has-text('הבא')",
          "button:has-text('Review')",
          "button:has-text('סקירה')",
          "button[aria-label='Continue to next step']",
        ]);

        // Multi-step Easy Apply with bounded waits — never sit on one selector forever
        let submitted = false;
        for (let step = 0; step < 6; step++) {
          const midBlock = await detectLinkedInBlocker(page);
          if (midBlock?.kind === "captcha" || midBlock?.kind === "login") {
            return {
              job,
              status: "skipped",
              method,
              reason: midBlock.reasonHe,
              durationMs: Date.now() - started,
              confirmed: false,
            };
          }

          try {
            await clickFirst(page, submit, SUBMIT_MS);
            submitted = true;
            break;
          } catch {
            /* try Next / Review */
          }

          const advanced = await clickFirst(page, next, NEXT_MS).then(() => true).catch(() => false);
          if (!advanced) {
            // Maybe already on review without labeled Next
            const review = await clickFirst(
              page,
              ["button:has-text('Review')", "button:has-text('סקירה')"],
              NEXT_MS,
            )
              .then(() => true)
              .catch(() => false);
            if (!review) break;
          }

          if (ctx.cvPath) {
            const fileInputs = page.locator('input[type="file"]');
            if ((await fileInputs.count()) > 0) {
              await fileInputs.first().setInputFiles(ctx.cvPath).catch(() => undefined);
            }
          }
        }

        if (!submitted) {
          try {
            await clickFirst(page, submit, Math.min(STEP_MS, SUBMIT_MS));
            submitted = true;
          } catch {
            return {
              job,
              status: "skipped",
              method,
              reason: "דילוג: Easy Apply לא הושלם (אין Submit / טופס תקוע)",
              durationMs: Date.now() - started,
              confirmed: false,
            };
          }
        }

        const { confirmed, matched } = await detectApplyConfirmation(page, ctx);
        if (!confirmed) {
          ctx.log("warn", "LinkedIn: אין אישור הגשה במסך — לא מסומן כהצלחה");
          return {
            job,
            status: "unknown",
            method,
            reason: "לא אומתה הגשה — לא נמצא מסך/הודעת אישור אחרי שליחה",
            durationMs: Date.now() - started,
            confirmed: false,
          };
        }

        ctx.log("info", `LinkedIn: אומתה הגשה (${matched})`);
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
      if (isBrowserClosedError(err)) {
        throw new Error(BROWSER_CLOSED_CODE);
      }
      const reason = err instanceof Error ? err.message : String(err);
      // Soft-skip selector misses instead of counting as hard fail toward timeout lore
      if (/No clickable selector|Timeout|timeout/i.test(reason)) {
        return {
          job,
          status: "skipped",
          method,
          reason: `דילוג: ${reason.slice(0, 120)}`,
          durationMs: Date.now() - started,
          confirmed: false,
        };
      }
      return {
        job,
        status: "failed",
        method,
        reason,
        durationMs: Date.now() - started,
        confirmed: false,
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
