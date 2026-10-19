import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext } from "playwright";
import {
  CHROME_QUIT_MSG_HE,
  chromeUserDataRoot,
  isChromeRunning,
} from "./chrome-lock";
import { detectChromeProfileName, normalizeChromeUserDataDir } from "./chrome-paths";

/**
 * Playwright defaults that break a real Chrome login session on macOS.
 * Kept for any fallback persistent path — CDP spawn never sends these.
 */
export const CHROME_IGNORE_DEFAULT_ARGS = [
  "--use-mock-keychain",
  "--password-store=basic",
  "--disable-sync",
  "--enable-automation",
] as const;

const LOCK_NAMES = ["SingletonLock", "SingletonCookie", "SingletonSocket"] as const;

/** Short checklist — no Playwright stack dumps */
export const CHROME_LAUNCH_TIMEOUT_HE =
  "פתיחת Chrome נכשלה (timeout).\n" +
  "בדוק:\n" +
  "1) Cmd+Q — אין «Google Chrome» ב-Activity Monitor\n" +
  "2) Full Disk Access ל־Jobbot (הגדרות מערכת → פרטיות ואבטחה)\n" +
  "3) אם מופיעה בקשת Keychain — אשר ל-Jobbot/Chrome\n" +
  "4) אם אין תהליך Chrome אבל יש נעילה: מחק SingletonLock / SingletonCookie / SingletonSocket תחת …/Google/Chrome\n" +
  "5) הנתיב חייב להיות …/Google/Chrome (בלי /Default)";

export interface LaunchChromePersistentOpts {
  userDataDir: string;
  profileDirectory?: string;
  viewport?: { width: number; height: number };
  log?: (message: string) => void;
  /** Total wait for CDP (ms). Default 45000 — prefer fail-fast over 180s hang. */
  connectTimeoutMs?: number;
}

export interface LaunchedChrome {
  context: BrowserContext;
  browser: Browser;
  mode: "cdp" | "persistent";
  debuggingPort?: number;
  close: () => Promise<void>;
}

export interface ChromePersistentLaunchOptions {
  headless: false;
  channel: "chrome";
  chromiumSandbox: true;
  ignoreDefaultArgs: string[];
  args: string[];
  viewport: { width: number; height: number };
  timeout: number;
}

export function chromePersistentLaunchOptions(
  opts: LaunchChromePersistentOpts,
): ChromePersistentLaunchOptions {
  const profileDirectory =
    opts.profileDirectory ||
    detectChromeProfileName(normalizeChromeUserDataDir(opts.userDataDir)) ||
    "Default";

  return {
    headless: false,
    channel: "chrome",
    chromiumSandbox: true,
    ignoreDefaultArgs: [...CHROME_IGNORE_DEFAULT_ARGS],
    args: [
      `--profile-directory=${profileDirectory}`,
      "--disable-blink-features=AutomationControlled",
    ],
    viewport: opts.viewport ?? { width: 1280, height: 900 },
    // Prefer CDP; if we fall back, don't sit 180s
    timeout: opts.connectTimeoutMs ?? 45_000,
  };
}

export async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("לא נמצא פורט פנוי"));
        return;
      }
      const port = addr.port;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on("error", reject);
  });
}

export function resolveChromeExecutable(): string {
  if (process.env.JOBBOT_CHROME_PATH && fs.existsSync(process.env.JOBBOT_CHROME_PATH)) {
    return process.env.JOBBOT_CHROME_PATH;
  }
  if (process.platform === "darwin") {
    const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    if (fs.existsSync(mac)) return mac;
  }
  if (process.platform === "win32") {
    const candidates = [
      path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google/Chrome/Application/chrome.exe"),
      path.join(
        process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)",
        "Google/Chrome/Application/chrome.exe",
      ),
      path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
    ];
    for (const c of candidates) {
      if (c && fs.existsSync(c)) return c;
    }
  }
  for (const name of ["google-chrome-stable", "google-chrome", "chromium-browser", "chromium"]) {
    // PATH lookup left to spawn — return bare name as last resort
    void name;
  }
  return process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "google-chrome";
}

/** Remove orphan lock files when no Chrome process is running */
export function scrubOrphanSingletonLocks(
  userDataDir: string,
  log?: (message: string) => void,
): string[] {
  const root = chromeUserDataRoot(userDataDir);
  const removed: string[] = [];
  if (!root) return removed;
  for (const name of LOCK_NAMES) {
    const p = path.join(root, name);
    try {
      if (fs.existsSync(p)) {
        fs.rmSync(p, { force: true });
        removed.push(name);
      }
    } catch {
      /* ignore */
    }
  }
  if (removed.length) {
    log?.(
      `הוסרו קבצי נעילה יתומים (${removed.join(", ")}) — אין תהליך Chrome פעיל`,
    );
  }
  return removed;
}

/**
 * Preflight before opening Matan's profile:
 * - refuse if Chrome still running
 * - scrub orphan Singleton* locks
 */
export async function preflightChromeForLaunch(
  userDataDir: string,
  log?: (message: string) => void,
): Promise<void> {
  const root = normalizeChromeUserDataDir(userDataDir);
  if (!root) throw new Error("לא הוגדר נתיב Chrome");

  if (await isChromeRunning()) {
    log?.("Chrome עדיין רץ — ממתין/עצירה נדרשת");
    throw new Error(CHROME_QUIT_MSG_HE);
  }

  scrubOrphanSingletonLocks(root, log);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function connectWithRetries(
  endpoint: string,
  timeoutMs: number,
  log?: (message: string) => void,
): Promise<Browser> {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    attempt += 1;
    log?.(attempt === 1 ? "ממתין ל־Chrome…" : `ממתין ל־Chrome… (ניסיון ${attempt})`);
    try {
      return await chromium.connectOverCDP(endpoint, { timeout: 4000 });
    } catch (err) {
      lastErr = err;
      await sleep(800);
    }
  }
  const detail = lastErr instanceof Error ? lastErr.message.split("\n")[0] : String(lastErr ?? "");
  throw Object.assign(new Error(CHROME_LAUNCH_TIMEOUT_HE), {
    code: "CHROME_CDP_TIMEOUT",
    causeDetail: detail.slice(0, 120),
  });
}

/**
 * Preferred strategy: spawn real Chrome with --remote-debugging-port, then connectOverCDP.
 * Avoids Playwright launchPersistentContext hangs (180s) on macOS live profiles.
 */
export async function launchChromePersistent(
  opts: LaunchChromePersistentOpts,
): Promise<LaunchedChrome> {
  const userDataDir = normalizeChromeUserDataDir(opts.userDataDir);
  if (!userDataDir) {
    throw new Error("לא הוגדר נתיב Chrome");
  }
  const profileDirectory =
    opts.profileDirectory || detectChromeProfileName(userDataDir) || "Default";
  const log = opts.log;
  const connectTimeoutMs = opts.connectTimeoutMs ?? 45_000;

  await preflightChromeForLaunch(userDataDir, log);

  const port = await findFreePort();
  const exe = resolveChromeExecutable();
  const endpoint = `http://127.0.0.1:${port}`;

  // Minimal args — no --no-sandbox, no mock-keychain, no disable-sync
  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--profile-directory=${profileDirectory}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-blink-features=AutomationControlled",
    "about:blank",
  ];

  log?.(`מפעיל Chrome (CDP :${port}) · ${profileDirectory}`);

  let child: ChildProcess | undefined;
  try {
    child = spawn(exe, chromeArgs, {
      stdio: "ignore",
      detached: false,
      env: {
        ...process.env,
        // Do not inherit electron/playwright sandbox overrides
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    throw new Error(`לא ניתן להפעיל את Chrome: ${msg.slice(0, 120)}`);
  }

  let browser: Browser | undefined;
  try {
    browser = await connectWithRetries(endpoint, connectTimeoutMs, log);
    const contexts = browser.contexts();
    let context = contexts[0];
    if (!context) {
      context = await browser.newContext({
        viewport: opts.viewport ?? { width: 1280, height: 900 },
      });
    }
    log?.("Chrome מחובר (CDP) — פרופיל חי");

    const childRef = child;
    return {
      context,
      browser,
      mode: "cdp",
      debuggingPort: port,
      close: async () => {
        await browser?.close().catch(() => undefined);
        if (childRef && !childRef.killed) {
          try {
            childRef.kill("SIGTERM");
          } catch {
            /* ignore */
          }
          await sleep(400);
          if (!childRef.killed) {
            try {
              childRef.kill("SIGKILL");
            } catch {
              /* ignore */
            }
          }
        }
        // After our Chrome exits, scrub locks we may have left
        if (!(await isChromeRunning())) {
          scrubOrphanSingletonLocks(userDataDir);
        }
      },
    };
  } catch (err) {
    if (child && !child.killed) {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
    await browser?.close().catch(() => undefined);
    throw err;
  }
}

/** Resolve which directory Playwright/Chrome should open (live vs clone) */
export function resolveLaunchUserDataDir(opts: {
  chromeUserDataDir?: string;
  jobbotChromeProfileDir?: string;
  useChromeClone?: boolean;
}): string {
  if (opts.useChromeClone && opts.jobbotChromeProfileDir) {
    return normalizeChromeUserDataDir(opts.jobbotChromeProfileDir);
  }
  return normalizeChromeUserDataDir(opts.chromeUserDataDir || "");
}
