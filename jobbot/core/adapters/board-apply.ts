import type { Page } from "playwright";
import { clickFirst } from "../browser/session";
import { detectApplyConfirmation } from "./confirm";
import type { ApplyMethod, ApplyResult, JobListing, SiteAdapterContext } from "../types";

export type SiteWall =
  | { kind: "login"; reasonHe: string }
  | { kind: "captcha"; reasonHe: string }
  | { kind: "vip"; reasonHe: string }
  | { kind: "bot"; reasonHe: string };

/** Common login / captcha / bot walls after the manual login gate */
export async function detectSiteWall(
  page: Page,
  siteLabelHe: string,
): Promise<SiteWall | null> {
  const url = page.url();
  if (/\/login|\/access\.aspx|\/signin|\/SignIn|authwall|\/register|\/Account\/Login/i.test(url)) {
    return {
      kind: "login",
      reasonHe: `לא מיושם / חסום: נדרשת התחברות ל-${siteLabelHe} (אחרי שער ההתחברות)`,
    };
  }
  if (/captcha|challenge|checkpoint|cf-browser-verification/i.test(url)) {
    return {
      kind: "captcha",
      reasonHe: `לא מיושם / חסום: ${siteLabelHe} מבקש אימות / captcha`,
    };
  }

  const body = ((await page.locator("body").innerText().catch(() => "")) || "").slice(0, 2500);
  if (/access denied|kramerica|bot detection|unusual traffic|איננו יכולים לאמת/i.test(body)) {
    return {
      kind: "bot",
      reasonHe: `לא מיושם / חסום: ${siteLabelHe} חוסם אוטומציה (bot wall)`,
    };
  }
  if (
    /התחבר|התחברות|sign in|log in|login to continue|כניסה לאתר|נדרש להתחבר/i.test(body) &&
    /סיסמ|password|email|מייל/i.test(body) &&
    body.length < 1200
  ) {
    // Likely a login form page (short body) — not a job listing
    const loginForm = await page
      .locator('input[type="password"], input[name*="pass" i]')
      .first()
      .isVisible()
      .catch(() => false);
    if (loginForm) {
      return {
        kind: "login",
        reasonHe: `לא מיושם / חסום: נדרשת התחברות ל-${siteLabelHe}`,
      };
    }
  }
  if (/VIP בלבד|ללקוחות VIP|שירות זה פתוח ללקוחות/i.test(body)) {
    return {
      kind: "vip",
      reasonHe: `דילוג: משרה/פעולה ללקוחות VIP ב-${siteLabelHe}`,
    };
  }

  const captchaVis = await page
    .locator("iframe[src*='captcha'], iframe[title*='captcha' i], #captcha, .g-recaptcha")
    .first()
    .isVisible()
    .catch(() => false);
  if (captchaVis) {
    return {
      kind: "captcha",
      reasonHe: `לא מיושם / חסום: ${siteLabelHe} מבקש captcha`,
    };
  }
  return null;
}

export async function uploadCvIfPresent(
  page: Page,
  ctx: SiteAdapterContext,
  labelHe: string,
): Promise<boolean> {
  if (!ctx.cvPath) return false;
  const files = page.locator('input[type="file"]');
  const n = await files.count().catch(() => 0);
  if (n === 0) return false;
  await files.first().setInputFiles(ctx.cvPath);
  ctx.log("info", `${labelHe}: הועלה קו״ח`);
  return true;
}

export async function clickApplyAndConfirm(opts: {
  page: Page;
  ctx: SiteAdapterContext;
  job: JobListing;
  method: ApplyMethod;
  labelHe: string;
  started: number;
  applySelectors: string[];
  submitSelectors?: string[];
  confirmExtra?: string[];
  applyTimeoutMs?: number;
}): Promise<ApplyResult> {
  const {
    page,
    ctx,
    job,
    method,
    labelHe,
    started,
    applySelectors,
    submitSelectors = [
      "button:has-text('שלח')",
      "button:has-text('הגש')",
      "button:has-text('Submit')",
      "button:has-text('Apply')",
      "button[type='submit']",
      "a:has-text('הגשת מועמדות')",
      "button:has-text('הגשת מועמדות')",
    ],
    confirmExtra = [],
    applyTimeoutMs = 12_000,
  } = opts;

  const wall = await detectSiteWall(page, labelHe);
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

  try {
    await clickFirst(page, applySelectors, applyTimeoutMs);
  } catch {
    const again = await detectSiteWall(page, labelHe);
    if (again) {
      return {
        job,
        status: again.kind === "vip" ? "skipped" : "not_implemented",
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
      reason: `דילוג: לא נמצא כפתור הגשה ב-${labelHe}`,
      durationMs: Date.now() - started,
      confirmed: false,
    };
  }
  ctx.log("info", `${labelHe}: נפתח טופס הגשה`);

  // Post-click wall (login modal)
  await new Promise((r) => setTimeout(r, 800));
  const midWall = await detectSiteWall(page, labelHe);
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

  await uploadCvIfPresent(page, ctx, labelHe);

  // Multi-step: try submit a few times
  let submitted = false;
  for (let i = 0; i < 4; i++) {
    try {
      await clickFirst(page, submitSelectors, 10_000);
      submitted = true;
      break;
    } catch {
      const next = await clickFirst(
        page,
        [
          "button:has-text('המשך')",
          "button:has-text('Next')",
          "button:has-text('הבא')",
          "a:has-text('המשך')",
        ],
        6_000,
      )
        .then(() => true)
        .catch(() => false);
      if (!next) break;
      await uploadCvIfPresent(page, ctx, labelHe);
    }
  }

  if (!submitted) {
    // Some boards submit on the first "הגשת מועמדות" click alone
    const { confirmed: early, matched: earlyMatch } = await detectApplyConfirmation(
      page,
      ctx,
      confirmExtra,
    );
    if (early) {
      ctx.log("info", `${labelHe}: אומתה הגשה (${earlyMatch})`);
      return {
        job,
        status: "applied",
        method,
        reason: `אושר במסך: ${earlyMatch}`,
        durationMs: Date.now() - started,
        confirmed: true,
      };
    }
    return {
      job,
      status: "skipped",
      method,
      reason: `דילוג: טופס ${labelHe} לא הושלם (אין Submit / שדות חסרים)`,
      durationMs: Date.now() - started,
      confirmed: false,
    };
  }

  const { confirmed, matched } = await detectApplyConfirmation(page, ctx, confirmExtra);
  if (!confirmed) {
    ctx.log("warn", `${labelHe}: אין אישור הגשה במסך — לא מסומן כהצלחה`);
    return {
      job,
      status: "unknown",
      method,
      reason: "לא אומתה הגשה — לא נמצא מסך/הודעת אישור אחרי שליחה",
      durationMs: Date.now() - started,
      confirmed: false,
    };
  }

  ctx.log("info", `${labelHe}: אומתה הגשה (${matched})`);
  return {
    job,
    status: "applied",
    method,
    reason: `אושר במסך: ${matched}`,
    durationMs: Date.now() - started,
    confirmed: true,
  };
}

export function absoluteUrl(href: string, base: string): string {
  if (!href) return base;
  if (href.startsWith("http")) return href;
  try {
    return new URL(href, base).toString();
  } catch {
    return base;
  }
}
