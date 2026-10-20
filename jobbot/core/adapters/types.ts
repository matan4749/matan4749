import type {
  ApplyMethod,
  ApplyResult,
  JobListing,
  SiteAdapterContext,
  SiteSearchParams,
} from "../types";

export type SiteKind = "board" | "career-portal";

export interface SiteAdapter {
  id: string;
  displayName: string;
  displayNameHe: string;
  /** board = job board search; career-portal = company careers site */
  siteKind: SiteKind;
  /** Live = real automation paths; stub = framework only */
  status: "live" | "stub";
  defaultApplyMethod: ApplyMethod;
  careersUrl?: string;
  search(params: SiteSearchParams, ctx: SiteAdapterContext): Promise<JobListing[]>;
  detectApplyMethod(job: JobListing, ctx: SiteAdapterContext): Promise<ApplyMethod>;
  apply(job: JobListing, ctx: SiteAdapterContext): Promise<ApplyResult>;
  parseResult?(raw: unknown): ApplyResult | null;
}
