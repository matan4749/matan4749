/**
 * Legacy stub factory — AllJobs / Drushim / Elbit / IAI are now live adapters.
 * Kept only so older imports / docs referencing makeStub patterns still resolve.
 * Do not register stub adapters in the runtime registry.
 */
import type { SiteAdapter, SiteKind } from "./types";
import { demoJobs } from "./demo";
import type { ApplyMethod, ApplyResult, JobListing, SiteAdapterContext, SiteSearchParams } from "../types";

/** @deprecated Prefer live adapters in alljobs.ts / drushim.ts / elbit.ts / iai.ts */
export function makeStub(opts: {
  id: string;
  displayName: string;
  displayNameHe: string;
  defaultApplyMethod: ApplyMethod;
  siteKind: SiteKind;
  careersUrl?: string;
}): SiteAdapter {
  return {
    ...opts,
    status: "stub",

    async search(params: SiteSearchParams, ctx: SiteAdapterContext): Promise<JobListing[]> {
      ctx.log("warn", `${opts.displayNameHe}: stub factory — לא בשימוש ברישום החי`);
      return demoJobs(opts.id, params).map((j) => ({
        ...j,
        url: opts.careersUrl || j.url,
        company: opts.displayName,
      }));
    },

    async detectApplyMethod(_job: JobListing, _ctx: SiteAdapterContext): Promise<ApplyMethod> {
      return opts.defaultApplyMethod;
    },

    async apply(job: JobListing, ctx: SiteAdapterContext): Promise<ApplyResult> {
      const method = await this.detectApplyMethod(job, ctx);
      const reason = `לא מיושם עדיין — אדפטר stub ל-${opts.displayNameHe}; לא הוגשה מועמדות`;
      ctx.log("warn", `⚠ ${opts.displayNameHe}: ${reason}`);
      return {
        job,
        status: "not_implemented",
        method,
        reason,
        durationMs: 0,
        confirmed: false,
        simulated: false,
      };
    },
  };
}

/* GotFriends + Easy (easy.co.il) removed — user has no accounts on those sites */
