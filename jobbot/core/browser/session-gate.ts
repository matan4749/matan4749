import { chromeLaunchErrorHe, isChromeLockError } from "./chrome-lock";
import { detectChromeProfileName, normalizeChromeUserDataDir } from "./chrome-paths";
import { launchChromePersistent } from "./launch-chrome";

export const LINKEDIN_NOT_LOGGED_IN_HE =
  "לא מחובר בלינקדאין בפרופיל הזה — סגור Chrome לגמרי עם Cmd+Q, ודא שהנתיב הוא …/Google/Chrome (בלי /Default), הפעל Full Disk Access ל־Jobbot, ואם במצב עותק לחץ «רענון עותק פרופיל».";

export interface SessionGateResult {
  ok: boolean;
  loggedIn: boolean;
  url: string;
  profileDir: string;
  messageHe: string;
}

/**
 * Open LinkedIn feed with the given user-data-dir. Abort-style result if login wall.
 */
export async function verifyLinkedInSession(opts: {
  userDataDir: string;
  profileDirectory?: string;
  log?: (message: string) => void;
}): Promise<SessionGateResult> {
  const profileDir = normalizeChromeUserDataDir(opts.userDataDir);
  const profileDirectory =
    opts.profileDirectory || detectChromeProfileName(profileDir) || "Default";
  const log = opts.log ?? (() => undefined);

  if (!profileDir) {
    return {
      ok: false,
      loggedIn: false,
      url: "",
      profileDir: "",
      messageHe: "לא הוגדר נתיב Chrome",
    };
  }

  log(`בודק התחברות LinkedIn… (${profileDir} · ${profileDirectory})`);

  let launched;
  try {
    launched = await launchChromePersistent({
      userDataDir: profileDir,
      profileDirectory,
      viewport: { width: 1100, height: 800 },
      log,
    });
    const page = launched.context.pages()[0] ?? (await launched.context.newPage());
    await page.goto("https://www.linkedin.com/feed/", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await new Promise((r) => setTimeout(r, 2500));

    const url = page.url();
    const body = ((await page.locator("body").innerText().catch(() => "")) || "").slice(0, 2500);

    const loginWall =
      /\/login|\/uas\/login|authwall|checkpoint/i.test(url) ||
      /sign in|sign in to linkedin|התחבר|להתחבר|join now|הצטרף/i.test(body);

    const loggedInHints =
      /linkedin\.com\/feed|linkedin\.com\/in\//i.test(url) ||
      /start a post|כתוב פוסט|התחל פוסט|משרות|jobs/i.test(body) ||
      (await page
        .locator('[data-global-nav-link="feed"], .global-nav__me, .share-box-feed-entry__trigger')
        .count()) > 0;

    const loggedIn = Boolean(loggedInHints && !loginWall);
    await launched.close().catch(() => undefined);
    launched = undefined;

    if (!loggedIn) {
      return {
        ok: false,
        loggedIn: false,
        url,
        profileDir,
        messageHe: LINKEDIN_NOT_LOGGED_IN_HE,
      };
    }

    return {
      ok: true,
      loggedIn: true,
      url,
      profileDir,
      messageHe: "מחובר ללינקדאין בפרופיל Chrome — ממשיכים.",
    };
  } catch (err) {
    if (launched) await launched.close().catch(() => undefined);
    return {
      ok: false,
      loggedIn: false,
      url: "",
      profileDir,
      messageHe: isChromeLockError(err) ? chromeLaunchErrorHe(err) : chromeLaunchErrorHe(err),
    };
  }
}
