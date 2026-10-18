import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

export interface ChromeProbeResult {
  ok: boolean;
  pathExists: boolean;
  pathUsed: string;
  linkedInLoggedIn: boolean | null;
  indeedReachable: boolean | null;
  messageHe: string;
  detail?: string;
}

/** Expand ~ and resolve Chrome user-data path */
export function resolveChromeUserDataDir(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return path.resolve(trimmed);
}

export function defaultMacChromeHint(): string {
  return path.join(os.homedir(), "Library/Application Support/Google/Chrome");
}

/**
 * Smoke-test Chrome persistent profile: open LinkedIn and detect login wall vs feed.
 * Requires Chrome fully quit before calling.
 */
export async function probeChromeProfile(chromeUserDataDir: string): Promise<ChromeProbeResult> {
  const pathUsed = resolveChromeUserDataDir(chromeUserDataDir);
  if (!pathUsed) {
    return {
      ok: false,
      pathExists: false,
      pathUsed: "",
      linkedInLoggedIn: null,
      indeedReachable: null,
      messageHe: "לא הוגדר נתיב Chrome. בחר תיקיית הפרופיל בהגדרות.",
    };
  }

  const pathExists = fs.existsSync(pathUsed);
  if (!pathExists) {
    return {
      ok: false,
      pathExists: false,
      pathUsed,
      linkedInLoggedIn: null,
      indeedReachable: null,
      messageHe: `הנתיב לא קיים: ${pathUsed}`,
    };
  }

  let context;
  try {
    context = await chromium.launchPersistentContext(pathUsed, {
      headless: false,
      channel: "chrome",
      args: ["--disable-blink-features=AutomationControlled"],
      viewport: { width: 1100, height: 800 },
    });
    const page = context.pages()[0] ?? (await context.newPage());

    await page.goto("https://www.linkedin.com/feed/", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await new Promise((r) => setTimeout(r, 2500));

    const url = page.url();
    const body = ((await page.locator("body").innerText().catch(() => "")) || "").slice(0, 2000);

    const loginWall =
      /\/login|\/uas\/login|authwall|checkpoint/i.test(url) ||
      /sign in|התחבר|להתחבר|join now|הצטרף/i.test(body);

    const loggedInHints =
      /feed|linkedin\.com\/in\//i.test(url) ||
      /start a post|כתוב פוסט|התחל פוסט|משרות|jobs/i.test(body) ||
      (await page.locator('[data-global-nav-link="feed"], .global-nav__me, .share-box-feed-entry').count()) > 0;

    const linkedInLoggedIn = loggedInHints && !loginWall;

    let indeedReachable: boolean | null = null;
    try {
      await page.goto("https://il.indeed.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
      indeedReachable = true;
    } catch {
      indeedReachable = false;
    }

    await context.close().catch(() => undefined);

    if (linkedInLoggedIn) {
      return {
        ok: true,
        pathExists: true,
        pathUsed,
        linkedInLoggedIn: true,
        indeedReachable,
        messageHe:
          "Chrome מחובר — נראה שמחובר ללינקדאין. סגור Chrome לגמרי לפני ריצת Jobbot.",
      };
    }

    return {
      ok: false,
      pathExists: true,
      pathUsed,
      linkedInLoggedIn: false,
      indeedReachable,
      messageHe:
        "הפרופיל נפתח, אך לינקדאין לא נראה מחובר. התחבר ב-Chrome (אותו פרופיל), סגור את Chrome, ובדוק שוב.",
      detail: `url=${url}`,
    };
  } catch (err) {
    await context?.close().catch(() => undefined);
    const detail = err instanceof Error ? err.message : String(err);
    const busy = /SingletonLock|ProcessSingleton|profile.*in use|user data directory is already in use/i.test(
      detail,
    );
    return {
      ok: false,
      pathExists: true,
      pathUsed,
      linkedInLoggedIn: null,
      indeedReachable: null,
      messageHe: busy
        ? "Chrome עדיין פתוח או שהפרופיל בשימוש. סגור לגמרי את Chrome (Cmd+Q) ונסה שוב."
        : `בדיקת Chrome נכשלה: ${detail.slice(0, 180)}`,
      detail,
    };
  }
}
