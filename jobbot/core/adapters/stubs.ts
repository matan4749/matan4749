import type { SiteAdapter, SiteKind } from "./types";
import { demoApply, demoJobs } from "./demo";
import type { ApplyMethod, ApplyResult, JobListing, SiteAdapterContext, SiteSearchParams } from "../types";

function makeStub(opts: {
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
      const kindLabel = opts.siteKind === "career-portal" ? "פורטל קריירה" : "לוח משרות";
      ctx.log(
        "info",
        `${opts.displayNameHe} (${kindLabel}): stub — התחבר ב-Chrome לפרופיל, ואז נחבר סלקטורים`,
      );
      if (opts.careersUrl) {
        ctx.log("info", `${opts.displayNameHe}: ${opts.careersUrl}`);
      }
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
      const result = await demoApply(job, ctx, method);
      if (result.status === "failed") {
        result.reason = `STUB_ADAPTER: ${result.reason || "not implemented"}`;
      }
      return result;
    },
  };
}

export const alljobsAdapter = makeStub({
  id: "alljobs",
  displayName: "AllJobs",
  displayNameHe: "אולג'ובס",
  defaultApplyMethod: "chrome-session",
  siteKind: "board",
  careersUrl: "https://www.alljobs.co.il/",
});

export const drushimAdapter = makeStub({
  id: "drushim",
  displayName: "Drushim",
  displayNameHe: "דרושים",
  defaultApplyMethod: "chrome-session",
  siteKind: "board",
  careersUrl: "https://www.drushim.co.il/",
});

export const gotfriendsAdapter = makeStub({
  id: "gotfriends",
  displayName: "GotFriends",
  displayNameHe: "גוטפרינדס",
  defaultApplyMethod: "cv-upload",
  siteKind: "board",
  careersUrl: "https://www.gotfriends.co.il/",
});
