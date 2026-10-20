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
  /** Path used as Chrome user-data-dir for this run (Jobbot profile or system) */
  chromeUserDataDir?: string;
  /** Dedicated Jobbot profile under jobbot-data/browser-profile */
  jobbotChromeProfileDir?: string;
  /** Chrome --profile-directory (usually Default) */
  chromeProfileDirectory?: string;
  /**
   * Shared browser from the login gate — adapters must reuse this and must NOT
   * close it (orchestrator closes after the run).
   */
  sharedBrowser?: import("./browser/launch-chrome").LaunchedChrome;
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

export interface LoginGateProgress {
  sites: {
    id: string;
    displayNameHe: string;
    url: string;
    loggedIn: boolean | null;
  }[];
  messageHe: string;
}

export interface RunProgress {
  phase:
    | "idle"
    | "awaiting-login"
    | "searching"
    | "applying"
    | "reporting"
    | "done"
    | "stopped"
    | "error";
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
  /** Present while phase === awaiting-login */
  loginGate?: LoginGateProgress;
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

/** jobbot = dedicated persistent profile + login gate (default). live = system Chrome. */
export type BrowserMode = "jobbot" | "live";

export interface AppSettings {
  cvPath: string;
  chromeUserDataDir: string;
  /**
   * Default `jobbot`: persistent Jobbot profile + manual login gate.
   * Normal Chrome can stay open. Logins persist across runs.
   */
  browserMode: BrowserMode;
  /**
   * Legacy advanced: clone system Chrome into jobbot-data/chrome-clone.
   * Ignored when browserMode is `jobbot`.
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
  browserMode: "jobbot",
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
  // All six adapters are live; boards on by default — enable portals in Settings
  enabledSites: ["linkedin", "indeed", "alljobs", "drushim"],
  jobLimitPerSite: 5,
  sendEmailAfterRun: true,
  llmApiKey: "",
  llmBaseUrl: "https://api.openai.com/v1",
  llmModel: "gpt-4o-mini",
};
