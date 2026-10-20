import type { Page } from "playwright";
import { clickFirst } from "../browser/session";
import { detectApplyConfirmation } from "./confirm";
import { fillApplicantFields, uploadCvFromSettings } from "./form-fill";
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
  const r = await uploadCvFromSettings(page, ctx, labelHe, { required: false });
  return r.uploaded;
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
  /** When true, missing CV file input after apply is an honest failure (IAI/Elbit) */
  requireCvUpload?: boolean;
  fillProfileFields?: boolean;
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
      "button:has-text('Submit your application')",
      "button[type='submit']",
      "a:has-text('הגשת מועמדות')",
      "button:has-text('הגשת מועמדות')",
    ],
    confirmExtra = [],
    applyTimeoutMs = 12_000,
    requireCvUpload = false,
    fillProfileFields = true,
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

  if (fillProfileFields) {
    await fillApplicantFields(page, ctx, labelHe);
  }

  // Upload when the form asks (file input present). Never fail solely because
  // a logged-in profile already has a saved CV and no file picker is shown.
  const fileAsked =
    (await page
      .locator(
        '#inp_UploadCvFile, input[name="inp_UploadCvFile"], input[name="ContactForm[cvfile]"], input[type="file"]',
      )
      .count()
      .catch(() => 0)) > 0;
  const cv = await uploadCvFromSettings(page, ctx, labelHe, {
    required: Boolean(requireCvUpload && fileAsked),
  });
  if (requireCvUpload && fileAsked && !cv.uploaded) {
    return {
      job,
      status: "failed",
      method,
      reason: cv.reasonHe || `לא אומתה העלאת קו״ח ב-${labelHe}`,
      durationMs: Date.now() - started,
      confirmed: false,
    };
  }

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
          ".VipBoxUpladCvButton",
        ],
        6_000,
      )
        .then(() => true)
        .catch(() => false);
      if (!next) break;
      if (fillProfileFields) await fillApplicantFields(page, ctx, labelHe);
      await uploadCvFromSettings(page, ctx, labelHe, { required: false });
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
