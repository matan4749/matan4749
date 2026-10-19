import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import {
  CHROME_CLONE_HINT_HE,
  CHROME_QUIT_MSG_HE,
  chromeLaunchErrorHe,
  isChromeLockError,
  isChromeRunning,
} from "./chrome-lock";
import {
  CHROME_EPERM_MSG_HE,
  defaultMacChromeUserDataDir,
  isChromeEpermError,
  normalizeChromeUserDataDir,
  resolveChromeUserDataDir,
} from "./chrome-paths";
import { ensureJobbotChromeProfile, jobbotCloneRoot } from "./profile-clone";

export { resolveChromeUserDataDir, normalizeChromeUserDataDir } from "./chrome-paths";

export interface ChromeProbeResult {
  ok: boolean;
  pathExists: boolean;
  pathUsed: string;
  clonePath?: string;
  linkedInLoggedIn: boolean | null;
  indeedReachable: boolean | null;
  chromeWasRunning?: boolean;
  messageHe: string;
  detail?: string;
}

export function defaultMacChromeHint(): string {
  return defaultMacChromeUserDataDir();
}

/**
 * Smoke-test via Jobbot profile clone (so live Chrome can stay open after first sync).
 */
export async function probeChromeProfile(
  chromeUserDataDir: string,
  opts?: { dataDir?: string; forceSync?: boolean },
): Promise<ChromeProbeResult> {
  const pathUsed = normalizeChromeUserDataDir(chromeUserDataDir);
  if (!pathUsed) {
    return {
      ok: false,
      pathExists: false,
      pathUsed: "",
      linkedInLoggedIn: null,
      indeedReachable: null,
      messageHe: "לא הוגדר נתיב Chrome. בחר תיקיית Google/Chrome בהגדרות (בלי /Default).",
    };
  }

  let pathExists = false;
  try {
    pathExists = fs.existsSync(pathUsed);
  } catch (err) {
    if (isChromeEpermError(err)) {
      return {
        ok: false,
        pathExists: false,
        pathUsed,
        linkedInLoggedIn: null,
        indeedReachable: null,
        messageHe: CHROME_EPERM_MSG_HE,
      };
    }
  }
  if (!pathExists) {
    return {
      ok: false,
      pathExists: false,
      pathUsed,
      linkedInLoggedIn: null,
      indeedReachable: null,
      messageHe: `הנתיב לא קיים: ${pathUsed}\nהשתמש ב־…/Google/Chrome (לא …/Chrome/Default).`,
    };
  }

  const dataDir = opts?.dataDir || path.join(os.tmpdir(), "jobbot-probe-data");
  fs.mkdirSync(dataDir, { recursive: true });

  let clonePath = "";
  let chromeWasRunning = false;
  try {
    const clone = await ensureJobbotChromeProfile({
      sourceUserDataDir: pathUsed,
      cloneRoot: jobbotCloneRoot(dataDir),
      force: opts?.forceSync,
    });
    clonePath = clone.path;
    chromeWasRunning = clone.chromeWasRunning;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const alreadyHe =
      /Cmd\+Q|Full Disk Access|גישה מלאה לדיסק|אין הרשאה לקרוא|סנכרון/i.test(detail);
    return {
      ok: false,
      pathExists: true,
      pathUsed,
      linkedInLoggedIn: null,
      indeedReachable: null,
      chromeWasRunning: await isChromeRunning(),
      messageHe:
        alreadyHe || isChromeLockError(err) ? detail : chromeLaunchErrorHe(err),
      detail,
    };
  }

  let context;
  try {
    context = await chromium.launchPersistentContext(clonePath, {
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
      (await page.locator('[data-global-nav-link="feed"], .global-nav__me, .share-box-feed-entry').count()) >
        0;

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
        clonePath,
        linkedInLoggedIn: true,
        indeedReachable,
        chromeWasRunning,
        messageHe: `מחובר ללינקדאין דרך עותק Jobbot. ${CHROME_CLONE_HINT_HE}`,
      };
    }

    return {
      ok: false,
      pathExists: true,
      pathUsed,
      clonePath,
      linkedInLoggedIn: false,
      indeedReachable,
      chromeWasRunning,
      messageHe:
        "העותק נפתח, אך לינקדאין לא מחובר. התחבר ב-Chrome הרגיל, לחץ «רענון עותק פרופיל» (אם צריך — Cmd+Q פעם אחת), ובדוק שוב.",
      detail: `url=${url}`,
    };
  } catch (err) {
    await context?.close().catch(() => undefined);
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      pathExists: true,
      pathUsed,
      clonePath,
      linkedInLoggedIn: null,
      indeedReachable: null,
      chromeWasRunning,
      messageHe: isChromeLockError(err) ? CHROME_QUIT_MSG_HE : chromeLaunchErrorHe(err),
      detail,
    };
  }
}
