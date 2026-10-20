import type { SiteAdapter } from "./types";
import type { ApplyResult } from "../types";

/**
 * Hard gate: never allow a fake "applied" to escape into progress/email.
 * - Demo / simulated → skipped
 * - Stub adapters → not_implemented
 * - applied without confirmed:true → unknown
 */
export function sanitizeApplyResult(
  result: ApplyResult,
  adapter: SiteAdapter,
  demo: boolean,
): ApplyResult {
  if (result.status !== "applied") {
    return {
      ...result,
      confirmed: result.confirmed ?? false,
      simulated: result.simulated ?? demo,
    };
  }

  if (demo || result.simulated) {
    return {
      ...result,
      status: "skipped",
      confirmed: false,
      simulated: true,
      reason:
        result.reason ||
        "הדגמה/סימולציה — סומן בטעות כהצלחה ותוקן; לא הוגשה מועמדות אמיתית",
    };
  }

  if (adapter.status === "stub") {
    return {
      ...result,
      status: "not_implemented",
      confirmed: false,
      simulated: false,
      reason:
        result.reason ||
        `אדפטר stub (${adapter.displayNameHe}) — לא הוגשה מועמדות`,
    };
  }

  if (!result.confirmed) {
    return {
      ...result,
      status: "unknown",
      confirmed: false,
      reason:
        result.reason ||
        "הגשה לא אומתה במסך/תשובה — לא מסומן כהצלחה",
    };
  }

  return { ...result, confirmed: true, simulated: false };
}

/** True only for a real verified submit */
export function isRealApplied(r: ApplyResult): boolean {
  return r.status === "applied" && r.confirmed === true && !r.simulated;
}
