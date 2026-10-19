import type { BrowserContext, Page } from "playwright";
import type { SiteAdapterContext } from "../types";
import { chromeLaunchErrorHe, isChromeLockError } from "./chrome-lock";
import { launchChromePersistent, resolveLaunchUserDataDir, type LaunchedChrome } from "./launch-chrome";

/** True when adapters should use real browser automation (not demo stubs) */
export function hasBrowserSession(ctx: SiteAdapterContext): boolean {
  return Boolean(
    ctx.sharedBrowser ||
      ctx.jobbotChromeProfileDir ||
      ctx.chromeUserDataDir,
  );
}

export async function withBrowserPage<T>(
  ctx: SiteAdapterContext,
  fn: (page: Page, context: BrowserContext) => Promise<T>,
): Promise<T> {
  if (ctx.demo) {
    throw new Error("DEMO_MODE_NO_BROWSER");
  }

  // Prefer shared session from login gate (same Chrome for whole run)
  if (ctx.sharedBrowser) {
    const context = ctx.sharedBrowser.context;
    const page = await context.newPage();
    try {
      return await fn(page, context);
    } catch (err) {
      if (isChromeLockError(err)) {
        throw new Error(chromeLaunchErrorHe(err));
      }
      throw err;
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  const profileDir = resolveLaunchUserDataDir({
    chromeUserDataDir: ctx.chromeUserDataDir,
    jobbotChromeProfileDir: ctx.jobbotChromeProfileDir,
    useChromeClone: Boolean(ctx.jobbotChromeProfileDir && !ctx.chromeUserDataDir),
  });
  // Prefer jobbot profile path when both set
  const userDataDir = ctx.jobbotChromeProfileDir || profileDir;
  if (!userDataDir) {
    throw new Error("לא הוגדר נתיב Chrome");
  }

  let launched: LaunchedChrome;
  try {
    launched = await launchChromePersistent({
      userDataDir,
      profileDirectory: ctx.chromeProfileDirectory,
      log: (m) => ctx.log("info", m),
    });
  } catch (err) {
    throw new Error(chromeLaunchErrorHe(err));
  }

  const page = launched.context.pages()[0] ?? (await launched.context.newPage());

  try {
    return await fn(page, launched.context);
  } catch (err) {
    if (isChromeLockError(err)) {
      throw new Error(chromeLaunchErrorHe(err));
    }
    throw err;
  } finally {
    await launched.close().catch(() => undefined);
  }
}

export function pickSelector(
  knowledge: SiteAdapterContext["knowledge"],
  key: string,
  fallbacks: string[],
): string[] {
  const preferred = knowledge.preferredSelectors[key] ?? [];
  const merged = [...preferred, ...fallbacks.filter((s) => !preferred.includes(s))];
  return merged;
}

export async function clickFirst(
  page: Page,
  selectors: string[],
  timeoutMs: number,
): Promise<string> {
  const per = Math.max(1500, Math.floor(timeoutMs / Math.max(selectors.length, 1)));
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      await loc.waitFor({ state: "visible", timeout: per });
      await loc.click({ timeout: per });
      return sel;
    } catch {
      /* try next */
    }
  }
  throw new Error(`No clickable selector matched: ${selectors.join(" | ")}`);
}

export async function fillFirst(
  page: Page,
  selectors: string[],
  value: string,
  timeoutMs: number,
): Promise<string> {
  const per = Math.max(1500, Math.floor(timeoutMs / Math.max(selectors.length, 1)));
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      await loc.waitFor({ state: "visible", timeout: per });
      await loc.fill(value, { timeout: per });
      return sel;
    } catch {
      /* try next */
    }
  }
  throw new Error(`No fillable selector matched: ${selectors.join(" | ")}`);
}
