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

export async function demoApply(
  job: JobListing,
  ctx: SiteAdapterContext,
  method: ApplyResult["method"],
): Promise<ApplyResult> {
  const started = Date.now();
  await sleep(400 + Math.random() * 600, ctx.signal);

  // Deterministic-ish failure for learning demos (~20%)
  const fail = hashFail(job.id);
  if (fail) {
    return {
      job,
      status: "failed",
      method,
      reason: "DEMO_SELECTOR_TIMEOUT: button.apply not found",
      durationMs: Date.now() - started,
    };
  }

  return {
    job,
    status: "applied",
    method,
    durationMs: Date.now() - started,
  };
}

function hashFail(id: string): boolean {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 5 === 0;
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
