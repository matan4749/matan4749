export type ApplyMethod = "chrome-session" | "cv-upload" | "unknown";

export type JobStatus = "found" | "applied" | "failed" | "skipped";

export type SearchMode = "cv" | "keywords";

export interface JobListing {
  id: string;
  site: string;
  title: string;
  company?: string;
  location?: string;
  url: string;
  snippet?: string;
}

export interface ApplyResult {
  job: JobListing;
  status: JobStatus;
  method: ApplyMethod;
  reason?: string;
  durationMs: number;
}

export interface SiteSearchParams {
  keywords: string[];
  location?: string;
  limit?: number;
}

export interface SiteAdapterContext {
  demo: boolean;
  chromeUserDataDir?: string;
  cvPath?: string;
  timeoutMs: number;
  knowledge: SiteKnowledge;
  log: (level: "info" | "warn" | "error", message: string) => void;
  signal: AbortSignal;
}

export interface SiteKnowledge {
  adapterVersion: string;
  preferredSelectors: Record<string, string[]>;
  skipSteps: string[];
  recentFailures: FailureRecord[];
  recentSuccesses: SuccessHint[];
}

export interface FailureRecord {
  id: string;
  site: string;
  step: string;
  selector?: string;
  error: string;
  timestamp: string;
  adapterVersion: string;
}

export interface SuccessHint {
  site: string;
  step: string;
  selector?: string;
  timestamp: string;
}

export interface RunProgress {
  phase: "idle" | "searching" | "applying" | "reporting" | "done" | "stopped" | "error";
  found: number;
  applied: number;
  failed: number;
  skipped: number;
  currentSite?: string;
  currentJob?: string;
  logs: RunLogEntry[];
  results: ApplyResult[];
  startedAt?: string;
  finishedAt?: string;
}

export interface RunLogEntry {
  id: string;
  ts: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface RunConfig {
  searchMode: SearchMode;
  keywords: string[];
  selectedKeywordIds?: string[];
  enabledSites: string[];
  location?: string;
  jobLimitPerSite: number;
  perJobTimeoutMs: number;
  perSiteTimeoutMs: number;
  maxRetries: number;
}

export interface AppSettings {
  cvPath: string;
  chromeUserDataDir: string;
  /** Destination only — SMTP is app-owned, never configured by the user */
  reportEmail: string;
  keywords: string[];
  location: string;
  enabledSites: string[];
  jobLimitPerSite: number;
  sendEmailAfterRun: boolean;
}

/** Sites the user explicitly does not use — never register or enable these */
export const EXCLUDED_SITES = ["gotfriends", "easy"] as const;

export const DEFAULT_SETTINGS: AppSettings = {
  cvPath: "",
  chromeUserDataDir: "",
  reportEmail: "matan4749@gmail.com",
  keywords: [
    "Full Stack Developer",
    "React",
    "Next.js",
    "TypeScript",
    "Node.js",
    "מפתח פולסטאק",
    "מהנדס תוכנה",
  ],
  location: "Israel",
  enabledSites: ["linkedin", "indeed", "alljobs", "drushim", "elbit", "iai"],
  jobLimitPerSite: 5,
  sendEmailAfterRun: true,
};
