import { randomUUID } from "node:crypto";
import type { ApplyResult, JobListing, SiteAdapterContext, SiteSearchParams } from "../types";

export function demoJobs(site: string, params: SiteSearchParams): JobListing[] {
  const kw = params.keywords.slice(0, 3).join(" · ") || "Software Engineer";
  const limit = params.limit ?? 3;
  return Array.from({ length: limit }, (_, i) => ({
    id: `${site}-demo-${i + 1}`,
    site,
    title: `${kw} — תפקיד לדוגמה ${i + 1}`,
    company: `Demo Corp ${i + 1}`,
    location: params.location || "Israel",
    url: `https://example.com/jobs/${site}/${i + 1}`,
    snippet: `משרת הדגמה עבור Jobbot (${site}). מילות מפתח: ${kw}`,
  }));
}

/**
 * Demo / offline path — NEVER returns status "applied".
 * Always honest: skipped + simulated, with a clear Hebrew reason.
 */
export async function demoApply(
  job: JobListing,
  ctx: SiteAdapterContext,
  method: ApplyResult["method"],
): Promise<ApplyResult> {
  const started = Date.now();
  await sleep(200 + Math.random() * 300, ctx.signal);

  const reason = ctx.demo
    ? "הדגמה בלבד (JOBBOT_DEMO) — לא הוגשה מועמדות אמיתית"
    : "אין פרופיל Chrome מחובר — לא בוצעה הגשה אמיתית";

  ctx.log("warn", `⚠ לא הוגש (הדגמה): ${job.title} — ${reason}`);

  return {
    job,
    status: "skipped",
    method,
    reason,
    durationMs: Date.now() - started,
    confirmed: false,
    simulated: true,
  };
}

function abortError(): Error {
  return Object.assign(new Error("Aborted"), { name: "AbortError" });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(abortError());
      },
      { once: true },
    );
  });
}

export function newId(): string {
  return randomUUID();
}
