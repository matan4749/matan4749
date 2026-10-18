import { chromium, type BrowserContext, type Page } from "playwright";
import type { SiteAdapterContext } from "../types";
import { chromeLaunchErrorHe, isChromeLockError } from "./chrome-lock";

export async function withBrowserPage<T>(
  ctx: SiteAdapterContext,
  fn: (page: Page, context: BrowserContext) => Promise<T>,
): Promise<T> {
  if (ctx.demo) {
    throw new Error("DEMO_MODE_NO_BROWSER");
  }

  // Prefer Jobbot clone so Matan's live Chrome can stay open
  const profileDir = ctx.jobbotChromeProfileDir || ctx.chromeUserDataDir;
  if (!profileDir) {
    throw new Error("לא הוגדר נתיב Chrome");
  }

  const launchOptions = {
    headless: false,
    channel: "chrome" as const,
    args: ["--disable-blink-features=AutomationControlled"],
  };

  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      ...launchOptions,
      viewport: { width: 1280, height: 900 },
    });
  } catch (err) {
    throw new Error(chromeLaunchErrorHe(err));
  }

  const page = context.pages()[0] ?? (await context.newPage());

  try {
    return await fn(page, context);
  } catch (err) {
    if (isChromeLockError(err)) {
      throw new Error(chromeLaunchErrorHe(err));
    }
    throw err;
  } finally {
    await context.close().catch(() => undefined);
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
