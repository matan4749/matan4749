export type ApplyMethod = "chrome-session" | "cv-upload" | "unknown";

/**
 * Reliability rule: `applied` is ONLY for a verified real submission.
 * Demo/stub paths must never emit `applied`.
 */
export type JobStatus =
  | "found"
  | "applied"
  | "failed"
  | "skipped"
  | "not_implemented"
  | "unknown";

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
  /** True only when UI/network confirmation of a real submit was observed */
  confirmed?: boolean;
  /** True for demo/mock paths — must never be counted as a real submit */
  simulated?: boolean;
}

export interface SiteSearchParams {
  keywords: string[];
  location?: string;
  limit?: number;
}

export interface SiteAdapterContext {
  demo: boolean;
  /** Source Chrome user-data-dir (Matan's real profile) — used in live mode */
  chromeUserDataDir?: string;
  /**
   * Only set when useChromeClone is on. Live mode leaves this undefined so
   * Playwright opens the real user-data-dir (never a blank profile).
   */
  jobbotChromeProfileDir?: string;
  /** Chrome --profile-directory (usually Default) */
  chromeProfileDirectory?: string;
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
  /** When true, search only — skip apply adapters */
  searchOnly?: boolean;
}

export interface AppSettings {
  cvPath: string;
  chromeUserDataDir: string;
  /**
   * When false (default): launchPersistentContext against the live Chrome
   * user-data-dir. Chrome must be fully quit (Cmd+Q).
   * When true: sync a Jobbot clone and launch against the clone (Chrome may stay open).
   */
  useChromeClone: boolean;
  /** Destination only — SMTP is app-owned, never configured by the user */
  reportEmail: string;
  keywords: string[];
  location: string;
  enabledSites: string[];
  jobLimitPerSite: number;
  sendEmailAfterRun: boolean;
  /** Optional OpenAI-compatible LLM for in-app chat (also JOBBOT_LLM_API_KEY) */
  llmApiKey?: string;
  llmBaseUrl?: string;
  llmModel?: string;
}

/** Sites the user explicitly does not use — never register or enable these */
export const EXCLUDED_SITES = ["gotfriends", "easy"] as const;

export const DEFAULT_SETTINGS: AppSettings = {
  cvPath: "",
  chromeUserDataDir: "",
  useChromeClone: false,
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
  // Live adapters first — stubs stay available in Settings but off by default
  enabledSites: ["linkedin", "indeed"],
  jobLimitPerSite: 5,
  sendEmailAfterRun: true,
  llmApiKey: "",
  llmBaseUrl: "https://api.openai.com/v1",
  llmModel: "gpt-4o-mini",
};
