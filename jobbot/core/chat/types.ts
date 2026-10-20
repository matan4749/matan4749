import type { SearchMode } from "../types";

export type ChatRole = "user" | "assistant" | "system";

export type ChatBackendKind = "llm" | "rules";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  ts: string;
  backend?: ChatBackendKind;
}

/** Structured plan the assistant proposes; user confirms then run */
export interface RunPlan {
  searchMode: SearchMode;
  keywords: string[];
  enabledSites: string[];
  location: string;
  jobLimitPerSite: number;
  /** apply = search+submit; search-only = find jobs, skip apply */
  applyMode: "apply" | "search-only";
  summaryHe: string;
  confirmed: boolean;
}

export interface ChatTurnResult {
  replyHe: string;
  plan: RunPlan | null;
  backend: ChatBackendKind;
  messages: ChatMessage[];
}

export interface ChatPersistedState {
  messages: ChatMessage[];
  lastPlan: RunPlan | null;
  updatedAt: string;
}

export interface LlmSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export const DEFAULT_LLM: LlmSettings = {
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
};

export const SITE_ALIASES: Record<string, string[]> = {
  linkedin: ["linkedin", "לינקדאין", "לינקדין", "לינקדאין"],
  indeed: ["indeed", "אינדיד", "אינדייד"],
  alljobs: ["alljobs", "אולג׳ובס", "אולגובס", "all jobs"],
  drushim: ["drushim", "דרושים"],
  elbit: ["elbit", "אלביט"],
  iai: ["iai", "תעשייה אווירית", "תעא", "תע״א", "תע\"א"],
};

export function emptyPlan(base?: Partial<RunPlan>): RunPlan {
  return {
    searchMode: "keywords",
    keywords: ["Full Stack Developer", "React", "TypeScript"],
    enabledSites: ["linkedin", "indeed"],
    location: "Israel",
    jobLimitPerSite: 5,
    applyMode: "apply",
    summaryHe: "",
    confirmed: false,
    ...base,
  };
}
