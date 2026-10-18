import type { Page } from "playwright";
import { pickSelector } from "../browser/session";
import type { SiteAdapterContext } from "../types";

/** Visible confirmation texts / selectors that prove a real application landed */
const DEFAULT_CONFIRM_SELECTORS = [
  "text=/application (was )?sent/i",
  "text=/your application was submitted/i",
  "text=/successfully applied/i",
  "text=/הבקשה נשלחה/i",
  "text=/המועמדות נשלחה/i",
  "text=/הוגשה בהצלחה/i",
  "text=/תודה על הגשת/i",
  "[data-test-applied-state]",
  ".artdeco-inline-feedback--success",
  ".post-apply-timeline",
  ".ia-BasePage-heading:has-text('Application')" ,
];

/**
 * Returns true only if a confirmation element is visible.
 * On timeout / miss → false (caller must NOT mark applied).
 */
export async function detectApplyConfirmation(
  page: Page,
  ctx: SiteAdapterContext,
  extraSelectors: string[] = [],
): Promise<{ confirmed: boolean; matched?: string }> {
  const selectors = pickSelector(ctx.knowledge, "applyConfirmation", [
    ...extraSelectors,
    ...DEFAULT_CONFIRM_SELECTORS,
  ]);

  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      await loc.waitFor({ state: "visible", timeout: 4000 });
      return { confirmed: true, matched: sel };
    } catch {
      /* try next */
    }
  }
  return { confirmed: false };
}
