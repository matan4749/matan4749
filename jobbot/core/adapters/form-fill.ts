import type { Page } from "playwright";
import type { SiteAdapterContext } from "../types";

/** Hebrew — IAI must not submit when ת.ז. field exists and settings are empty */
export const MISSING_NATIONAL_ID_HE = "חסרה תעודת זהות בהגדרות";

export type ApplyStepKind =
  | "login-wall"
  | "bot-wall"
  | "click-apply"
  | "fill-fields"
  | "upload-cv"
  | "submit"
  | "confirm";

export interface PageApplySignals {
  hasLoginWall: boolean;
  hasBotWall: boolean;
  hasApplyButton: boolean;
  hasFileInput: boolean;
  hasTextFields: boolean;
  siteId: string;
}

/**
 * Pure planner — used by unit tests to prove adapters pick the right steps
 * without submitting real applications.
 */
export function planApplySteps(signals: PageApplySignals): ApplyStepKind[] {
  if (signals.hasBotWall) return ["bot-wall"];
  if (signals.hasLoginWall) return ["login-wall"];
  const steps: ApplyStepKind[] = [];
  if (signals.hasApplyButton) steps.push("click-apply");
  if (signals.hasTextFields) steps.push("fill-fields");
  // Career portals / boards that expose file input require CV upload
  if (signals.hasFileInput || ["iai", "elbit", "alljobs", "drushim", "indeed"].includes(signals.siteId)) {
    steps.push("upload-cv");
  }
  steps.push("submit", "confirm");
  return steps;
}

const FIELD_MAP: { keys: RegExp; valueFrom: keyof NonNullable<SiteAdapterContext["applicant"]> }[] = [
  { keys: /full.?name|שם מלא|your name|^name$|ContactForm\[name\]/i, valueFrom: "fullNameHe" },
  { keys: /first.?name|שם פרטי/i, valueFrom: "fullNameHe" },
  { keys: /email|מייל|דוא"?ל|ContactForm\[email\]/i, valueFrom: "email" },
  { keys: /phone|טלפון|נייד|mobile|ContactForm\[phone\]/i, valueFrom: "phone" },
  { keys: /city|עיר|יישוב|ContactForm\[city\]/i, valueFrom: "city" },
  { keys: /id.?number|ת\.?ז|national.?id|ContactForm\[id\]/i, valueFrom: "nationalId" },
];

export function defaultApplicant(
  ctx: SiteAdapterContext,
): NonNullable<SiteAdapterContext["applicant"]> {
  return {
    fullNameHe: ctx.applicant?.fullNameHe || "מתן עמר",
    fullNameEn: ctx.applicant?.fullNameEn || "Matan Amar",
    email: ctx.applicant?.email || "matan4749@gmail.com",
    phone: ctx.applicant?.phone || "",
    city: ctx.applicant?.city || "ישראל",
    nationalId: ctx.applicant?.nationalId || "",
  };
}

/** Fill visible text/email/tel inputs by name/id/placeholder/label heuristics */
export async function fillApplicantFields(
  page: Page,
  ctx: SiteAdapterContext,
  labelHe: string,
): Promise<string[]> {
  const profile = defaultApplicant(ctx);
  const filled: string[] = [];
  const inputs = page.locator(
    'input[type="text"], input[type="email"], input[type="tel"], input:not([type]), textarea',
  );
  const n = await inputs.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const el = inputs.nth(i);
    const visible = await el.isVisible().catch(() => false);
    if (!visible) continue;
    const name = ((await el.getAttribute("name").catch(() => "")) || "").trim();
    const id = ((await el.getAttribute("id").catch(() => "")) || "").trim();
    const placeholder = ((await el.getAttribute("placeholder").catch(() => "")) || "").trim();
    const aria = ((await el.getAttribute("aria-label").catch(() => "")) || "").trim();
    const hay = `${name} ${id} ${placeholder} ${aria}`;
    if (/password|captcha|search|q\b|keyword/i.test(hay)) continue;

    for (const rule of FIELD_MAP) {
      if (!rule.keys.test(hay)) continue;
      const value = profile[rule.valueFrom];
      if (!value) break;
      try {
        await el.fill(String(value), { timeout: 3000 });
        filled.push(`${rule.valueFrom}:${name || id || placeholder}`);
        ctx.log("info", `${labelHe}: מולא שדה ${rule.valueFrom}`);
      } catch {
        /* skip */
      }
      break;
    }
  }

  // Checkbox approve / terms if present and unchecked
  const approve = page.locator(
    'input[type="checkbox"][name*="approve" i], input[type="checkbox"][id*="agree" i], input[type="checkbox"][name*="terms" i]',
  );
  if ((await approve.count().catch(() => 0)) > 0) {
    const box = approve.first();
    const checked = await box.isChecked().catch(() => true);
    if (!checked) await box.check({ force: true }).catch(() => undefined);
  }

  return filled;
}

const CV_FILE_SELECTORS = [
  "#inp_UploadCvFile",
  'input[name="inp_UploadCvFile"]',
  'input[name="ContactForm[cvfile]"]',
  'input[name*="cv" i][type="file"]',
  'input[name*="resume" i][type="file"]',
  'input[type="file"]',
];

/**
 * Upload CV from settings. Returns whether upload succeeded.
 * When `required` and no input / no path — caller should fail honestly.
 */
export async function uploadCvFromSettings(
  page: Page,
  ctx: SiteAdapterContext,
  labelHe: string,
  opts?: { required?: boolean },
): Promise<{ uploaded: boolean; reasonHe?: string }> {
  if (!ctx.cvPath) {
    return {
      uploaded: false,
      reasonHe: opts?.required
        ? `דילוג: חסר נתיב קו״ח בהגדרות עבור ${labelHe}`
        : undefined,
    };
  }

  for (const sel of CV_FILE_SELECTORS) {
    const loc = page.locator(sel).first();
    const count = await page.locator(sel).count().catch(() => 0);
    if (count === 0) continue;
    try {
      // Hidden file inputs (AllJobs) still accept setInputFiles
      await loc.setInputFiles(ctx.cvPath);
      ctx.log("info", `${labelHe}: הועלה קו״ח (${sel})`);
      return { uploaded: true };
    } catch {
      /* try next */
    }
  }

  if (opts?.required) {
    return {
      uploaded: false,
      reasonHe: `לא אומתה העלאת קו״ח — לא נמצא שדה קובץ בטופס ${labelHe}`,
    };
  }
  return { uploaded: false };
}

/**
 * Detect a national-ID (ת.ז.) field on the page.
 * Heuristics only for name/id/placeholder/aria — no invented IAI-only selectors.
 */
export async function pageHasNationalIdField(page: Page): Promise<boolean> {
  const inputs = page.locator(
    'input[type="text"], input[type="tel"], input[type="number"], input:not([type]), input[name*="id" i], input[id*="id" i]',
  );
  const n = await inputs.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const el = inputs.nth(i);
    const visible = await el.isVisible().catch(() => false);
    if (!visible) continue;
    const name = ((await el.getAttribute("name").catch(() => "")) || "").trim();
    const id = ((await el.getAttribute("id").catch(() => "")) || "").trim();
    const placeholder = ((await el.getAttribute("placeholder").catch(() => "")) || "").trim();
    const aria = ((await el.getAttribute("aria-label").catch(() => "")) || "").trim();
    const hay = `${name} ${id} ${placeholder} ${aria}`;
    if (/id.?number|ת\.?ז|national.?id|tz\b|teudat|ContactForm\[id\]/i.test(hay)) {
      return true;
    }
  }
  // Label text next to inputs (Hebrew ת.ז.)
  const labelHit = await page
    .locator("label, span, div")
    .filter({ hasText: /ת\.?\s*ז\.?|תעודת זהות/i })
    .first()
    .isVisible()
    .catch(() => false);
  return Boolean(labelHit);
}

/**
 * Pure gate: if the form shows ת.ז. and settings.nationalId is empty → block submit.
 */
export function missingNationalIdIfRequired(
  hasIdField: boolean,
  nationalId: string | undefined | null,
): string | null {
  if (hasIdField && !(nationalId || "").trim()) return MISSING_NATIONAL_ID_HE;
  return null;
}

export function signalsFromDomHints(hints: {
  url?: string;
  bodySnippet?: string;
  hasFileInput?: boolean;
  hasApplyText?: boolean;
  hasPassword?: boolean;
  siteId: string;
}): PageApplySignals {
  const url = hints.url || "";
  const body = hints.bodySnippet || "";
  return {
    siteId: hints.siteId,
    hasLoginWall:
      /\/login|access\.aspx|signin/i.test(url) ||
      Boolean(hints.hasPassword && /התחבר|sign in/i.test(body)),
    hasBotWall: /access denied|kramerica|bot detection/i.test(body),
    hasApplyButton: Boolean(hints.hasApplyText),
    hasFileInput: Boolean(hints.hasFileInput),
    hasTextFields: /name=|email|phone|שם|מייל/i.test(body) || Boolean(hints.hasFileInput),
  };
}
