import type { Page } from "playwright";
import type { LaunchedChrome } from "./launch-chrome";
import { loginUrlForSite } from "./jobbot-profile";
import { checkChromeSessionArtifacts } from "./session-artifacts";

export interface LoginGateSiteStatus {
  id: string;
  displayNameHe: string;
  url: string;
  /** Best-effort — null if unknown */
  loggedIn: boolean | null;
}

export interface LoginGateState {
  sites: LoginGateSiteStatus[];
  messageHe: string;
}

export const LOGGED_IN_SKIP_HE = "מחובר — מדלג על התחברות";

export const COOKIES_NOT_SAVED_HE =
  "נראה שההתחברות לא נשמרה בפרופיל Jobbot (Cookies ריק/חסר).\n" +
  "סגור את חלון Chrome של Jobbot לגמרי, התחבר שוב באתרים, לחץ «המשך לריצה», " +
  "ואל תמחק את תיקיית browser-profile. אם צריך — השתמש ב«נקה פרופיל Jobbot» בהגדרות ואז התחבר מחדש.";

/**
 * Open LinkedIn (and optionally other sites) to probe session.
 * When `probeOnlyPrimary` is true, only opens LinkedIn if enabled — faster skip path.
 */
export async function openLoginGatePages(
  launched: LaunchedChrome,
  sites: { id: string; displayNameHe: string }[],
  log?: (message: string) => void,
  opts?: { probeOnlyPrimary?: boolean },
): Promise<LoginGateSiteStatus[]> {
  const context = launched.context;
  const toOpen =
    opts?.probeOnlyPrimary && sites.some((s) => s.id === "linkedin")
      ? sites.filter((s) => s.id === "linkedin")
      : sites;

  const statuses: LoginGateSiteStatus[] = [];
  let first = true;
  for (const site of toOpen) {
    const url = loginUrlForSite(site.id);
    log?.(`בודק התחברות: ${site.displayNameHe}`);
    let page: Page;
    if (first) {
      page = context.pages()[0] ?? (await context.newPage());
      first = false;
    } else {
      page = await context.newPage();
    }
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      log?.(
        `אזהרה: לא נטען ${site.displayNameHe} — ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
      );
    }
    const loggedIn = await detectLoggedInBestEffort(site.id, page);
    if (loggedIn === true) {
      log?.(`${site.displayNameHe}: מחובר`);
    } else if (loggedIn === false) {
      log?.(`${site.displayNameHe}: נדרשת התחברות`);
    }
    statuses.push({
      id: site.id,
      displayNameHe: site.displayNameHe,
      url: page.url() || url,
      loggedIn,
    });
  }

  // Fill remaining enabled sites as unknown when probe-only
  if (opts?.probeOnlyPrimary) {
    for (const site of sites) {
      if (statuses.some((s) => s.id === site.id)) continue;
      statuses.push({
        id: site.id,
        displayNameHe: site.displayNameHe,
        url: loginUrlForSite(site.id),
        loggedIn: null,
      });
    }
  }
  return statuses;
}

/**
 * Skip the interactive gate when the primary session is clearly logged in.
 * LinkedIn is authoritative when enabled; otherwise any site with loggedIn===true
 * and no site with loggedIn===false.
 */
export function shouldSkipLoginGate(
  statuses: LoginGateSiteStatus[],
  enabledSiteIds: string[],
): boolean {
  const enabled = new Set(enabledSiteIds);
  const relevant = statuses.filter((s) => enabled.has(s.id));
  if (relevant.length === 0) return false;

  const linkedin = relevant.find((s) => s.id === "linkedin");
  if (linkedin) {
    return linkedin.loggedIn === true;
  }

  const anyFalse = relevant.some((s) => s.loggedIn === false);
  const anyTrue = relevant.some((s) => s.loggedIn === true);
  return anyTrue && !anyFalse;
}

/** Sites that still need a manual login tab */
export function sitesNeedingLogin(
  statuses: LoginGateSiteStatus[],
): LoginGateSiteStatus[] {
  return statuses.filter((s) => s.loggedIn !== true);
}

/**
 * After user hits «המשך», verify cookies landed on disk for the Jobbot profile.
 * Returns Hebrew error if empty — do not silently continue.
 */
export function verifyCookiesPersisted(
  profileRoot: string,
  profileDirectory = "Default",
): { ok: boolean; messageHe: string; cookiesBytes: number } {
  const check = checkChromeSessionArtifacts(profileRoot, profileDirectory);
  if (!check.ok || check.cookiesBytes < 64) {
    return {
      ok: false,
      messageHe: COOKIES_NOT_SAVED_HE,
      cookiesBytes: check.cookiesBytes,
    };
  }
  return {
    ok: true,
    messageHe: `סשן נשמר בפרופיל (Cookies ${check.cookiesBytes}B)`,
    cookiesBytes: check.cookiesBytes,
  };
}

/** Exported for unit tests */
export async function detectLoggedInBestEffort(
  siteId: string,
  page: Page,
): Promise<boolean | null> {
  try {
    const url = page.url();
    const body = ((await page.locator("body").innerText().catch(() => "")) || "").slice(0, 2500);
    if (siteId === "linkedin") {
      const wall =
        /\/login|\/uas\/login|authwall|\/checkpoint\//i.test(url) ||
        (/sign in to linkedin|התחבר ללינקדאין|join now/i.test(body) &&
          /password|סיסמ/i.test(body));
      const softWall =
        /\/login|\/uas\/login|authwall/i.test(url) ||
        (/^sign in$/im.test(body.slice(0, 200)) && /join now/i.test(body));
      const ok =
        /linkedin\.com\/feed|linkedin\.com\/in\/|linkedin\.com\/jobs/i.test(url) ||
        /start a post|כתוב פוסט|התחל פוסט/i.test(body);
      const navOk =
        (await page
          .locator(
            '[data-global-nav-link="feed"], .global-nav__me, .share-box-feed-entry__trigger, #global-nav',
          )
          .count()
          .catch(() => 0)) > 0;
      if (wall || softWall) return false;
      if (ok || (navOk && !/\/login/i.test(url))) return true;
      return null;
    }
    if (siteId === "indeed") {
      if (/account\/login|signin/i.test(url)) return false;
      if (/sign out|התנתק|my jobs|המשרות שלי/i.test(body)) return true;
      return null;
    }
    if (siteId === "alljobs") {
      if (/access\.aspx|\/login/i.test(url)) return false;
      if (/התנתק|שלום,|המשרות שלי/i.test(body)) return true;
      return null;
    }
    if (siteId === "drushim") {
      if (/\/login|\/signin/i.test(url)) return false;
      if (/התנתק|אזור אישי|מרכז ההתראות/i.test(body)) return true;
      return null;
    }
    if (siteId === "elbit") {
      if (/login|signin/i.test(url) && /password|סיסמ/i.test(body)) return false;
      if (/sign out|התנתק|my profile|הפרופיל שלי/i.test(body)) return true;
      return null;
    }
    if (siteId === "iai") {
      if (/access denied|kramerica/i.test(body)) return false;
      if (/login|signin/i.test(url) && /password/i.test(body)) return false;
      if (/התנתק|אזור אישי/i.test(body)) return true;
      return null;
    }
    return null;
  } catch {
    return null;
  }
}
