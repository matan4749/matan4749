import type { SiteAdapter } from "./types";
import { demoApply, demoJobs } from "./demo";
import { detectApplyConfirmation } from "./confirm";
import { detectSiteWall } from "./board-apply";
import { fillApplicantFields, uploadCvFromSettings } from "./form-fill";
import {
  BROWSER_CLOSED_CODE,
  clickFirst,
  hasBrowserSession,
  isBrowserClosedError,
  pickSelector,
  withBrowserPage,
} from "../browser/session";
import type { ApplyMethod, ApplyResult, JobListing, SiteAdapterContext, SiteSearchParams } from "../types";

export const indeedAdapter: SiteAdapter = {
  id: "indeed",
  displayName: "Indeed",
  displayNameHe: "אינדיד",
  siteKind: "board",
  status: "live",
  defaultApplyMethod: "cv-upload",

  async search(params: SiteSearchParams, ctx: SiteAdapterContext): Promise<JobListing[]> {
    if (ctx.demo || !hasBrowserSession(ctx)) {
      ctx.log("info", "Indeed: מצב הדגמה / ללא דפדפן — מחזיר משרות לדוגמה");
      return demoJobs("indeed", params);
    }

    const keywords = params.keywords.join(" ");
    const limit = params.limit ?? 5;

    return withBrowserPage(ctx, async (page) => {
      const url = new URL("https://il.indeed.com/jobs");
      url.searchParams.set("q", keywords);
      if (params.location) url.searchParams.set("l", params.location);

      ctx.log("info", `Indeed: מחפש — ${keywords}`);
      await page.goto(url.toString(), {
        waitUntil: "domcontentloaded",
        timeout: Math.min(ctx.timeoutMs, 30000),
      });

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
    if (ctx.demo || !hasBrowserSession(ctx)) {
      return demoApply(job, ctx, method);
    }

    // Mistaken learning: closed-browser failures must not permanently skip apply
    if (ctx.knowledge.skipSteps.includes("apply")) {
      ctx.log(
        "warn",
        "Indeed: מתעלם מ-skipSteps.apply (לרוב נוצר בטעות אחרי סגירת דפדפן)",
      );
    }

    const started = Date.now();
    try {
      return await withBrowserPage(ctx, async (page) => {
        await page.goto(job.url, {
          waitUntil: "domcontentloaded",
          timeout: Math.min(ctx.timeoutMs, 25000),
        });

        const wall = await detectSiteWall(page, "אינדיד");
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

        // External employer site — do not fake applied
        const external = await page
          .locator(
            "button:has-text('Apply on company site'), a:has-text('Apply on company site'), button:has-text('הגש באתר החברה'), a:has-text('הגש באתר החברה')",
          )
          .first()
          .isVisible()
          .catch(() => false);
        const indeedApply = await page
          .locator("#indeedApplyButton, button.ia-IndeedApplyButton, button:has-text('Apply now'), button:has-text('הגש מועמדות')")
          .first()
          .isVisible()
          .catch(() => false);
        if (external && !indeedApply) {
          return {
            job,
            status: "skipped",
            method,
            reason: "דילוג: משרה חיצונית באתר מעסיק (לא Easy Apply של Indeed)",
            durationMs: Date.now() - started,
            confirmed: false,
          };
        }

        const applyBtns = pickSelector(ctx.knowledge, "apply", [
          "button:has-text('Apply now')",
          "button:has-text('הגש מועמדות')",
          "#indeedApplyButton",
          "button.ia-IndeedApplyButton",
          "a[href*='indeedapply']",
        ]);

        try {
          await clickFirst(page, applyBtns, Math.min(ctx.timeoutMs, 15000));
        } catch {
          return {
            job,
            status: "skipped",
            method,
            reason: "דילוג: לא נמצא כפתור הגשה ב-Indeed",
            durationMs: Date.now() - started,
            confirmed: false,
          };
        }
        ctx.log("info", "Indeed: נפתח טופס הגשה");

        await new Promise((r) => setTimeout(r, 800));
        const midWall = await detectSiteWall(page, "אינדיד");
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

        await fillApplicantFields(page, ctx, "אינדיד");

        // Upload only when the form asks (file input). Saved-profile CV is OK without input.
        const fileCount = await page.locator('input[type="file"]').count().catch(() => 0);
        if (fileCount > 0) {
          const cv = await uploadCvFromSettings(page, ctx, "אינדיד", { required: true });
          if (!cv.uploaded) {
            return {
              job,
              status: "failed",
              method,
              reason: cv.reasonHe || "Indeed: טופס מבקש קו״ח אך ההעלאה לא אומתה",
              durationMs: Date.now() - started,
              confirmed: false,
            };
          }
        }

        // Multi-step: Continue / Submit
        let submitted = false;
        for (let i = 0; i < 4; i++) {
          const submit = pickSelector(ctx.knowledge, "submit", [
            "button:has-text('Submit')",
            "button:has-text('Submit your application')",
            "button:has-text('המשך')",
            "button:has-text('שלח')",
            "button:has-text('Apply')",
            "button[type='submit']",
          ]);
          try {
            await clickFirst(page, submit, Math.min(ctx.timeoutMs, 15000));
            submitted = true;
            await new Promise((r) => setTimeout(r, 600));
            // Keep going if still on intermediate step
            const stillForm = await page
              .locator('input[type="file"], button:has-text("Continue"), button:has-text("המשך")')
              .first()
              .isVisible()
              .catch(() => false);
            if (!stillForm) break;
            await fillApplicantFields(page, ctx, "אינדיד");
            if ((await page.locator('input[type="file"]').count().catch(() => 0)) > 0) {
              await uploadCvFromSettings(page, ctx, "אינדיד", { required: false });
            }
          } catch {
            break;
          }
        }

        if (!submitted) {
          return {
            job,
            status: "skipped",
            method,
            reason: "דילוג: טופס Indeed לא הושלם (אין Submit)",
            durationMs: Date.now() - started,
            confirmed: false,
          };
        }

        const { confirmed, matched } = await detectApplyConfirmation(page, ctx, [
          "text=/application submitted/i",
          "text=/you applied/i",
          "text=/המועמדות נשלחה/i",
          "text=/תודה על הגשת/i",
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
      if (isBrowserClosedError(err)) {
        throw new Error(BROWSER_CLOSED_CODE);
      }
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
