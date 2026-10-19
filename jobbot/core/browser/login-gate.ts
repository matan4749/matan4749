import type { Page } from "playwright";
import type { LaunchedChrome } from "./launch-chrome";
import { loginUrlForSite } from "./jobbot-profile";

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

/**
 * Open login/home pages for enabled sites in the shared Chrome window.
 * Best-effort login detection; user confirm is authoritative.
 */
export async function openLoginGatePages(
  launched: LaunchedChrome,
  sites: { id: string; displayNameHe: string }[],
  log?: (message: string) => void,
): Promise<LoginGateSiteStatus[]> {
  const statuses: LoginGateSiteStatus[] = [];
  const context = launched.context;

  // Reuse first page, open extras as new tabs
  let first = true;
  for (const site of sites) {
    const url = loginUrlForSite(site.id);
    log?.(`פותח להתחברות: ${site.displayNameHe}`);
    let page: Page;
    if (first) {
      page = context.pages()[0] ?? (await context.newPage());
      first = false;
    } else {
      page = await context.newPage();
    }
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await new Promise((r) => setTimeout(r, 1200));
    } catch (err) {
      log?.(
        `אזהרה: לא נטען ${site.displayNameHe} — ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
      );
    }
    const loggedIn = await detectLoggedInBestEffort(site.id, page);
    statuses.push({
      id: site.id,
      displayNameHe: site.displayNameHe,
      url: page.url() || url,
      loggedIn,
    });
  }
  return statuses;
}

async function detectLoggedInBestEffort(siteId: string, page: Page): Promise<boolean | null> {
  try {
    const url = page.url();
    const body = ((await page.locator("body").innerText().catch(() => "")) || "").slice(0, 2000);
    if (siteId === "linkedin") {
      const wall =
        /\/login|\/uas\/login|authwall/i.test(url) ||
        /sign in|התחבר|להתחבר|join now/i.test(body);
      const ok =
        /linkedin\.com\/feed|linkedin\.com\/in\//i.test(url) ||
        /start a post|כתוב פוסט|התחל פוסט/i.test(body);
      if (wall) return false;
      if (ok) return true;
      return null;
    }
    if (siteId === "indeed") {
      if (/account\/login|signin/i.test(url)) return false;
      return null;
    }
    return null;
  } catch {
    return null;
  }
}
