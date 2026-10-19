import { chromium, type BrowserContext } from "playwright";
import { detectChromeProfileName, normalizeChromeUserDataDir } from "./chrome-paths";

/**
 * Playwright defaults that break a real Chrome login session on macOS:
 * - `--no-sandbox` (unless chromiumSandbox: true) → yellow unsupported-flag banner
 * - `--use-mock-keychain` → cannot decrypt Cookies from the real profile
 * - `--password-store=basic` → bypasses OS keychain
 * - `--disable-sync` → can disrupt signed-in Google/LinkedIn state
 *
 * Keep CDP-compatible defaults; only strip the session-breaking ones.
 */
export const CHROME_IGNORE_DEFAULT_ARGS = [
  "--use-mock-keychain",
  "--password-store=basic",
  "--disable-sync",
  "--enable-automation",
] as const;

export interface LaunchChromePersistentOpts {
  /** Chrome user-data-dir (…/Google/Chrome), never …/Default */
  userDataDir: string;
  /** Profile folder name inside user-data-dir */
  profileDirectory?: string;
  viewport?: { width: number; height: number };
}

export interface ChromePersistentLaunchOptions {
  headless: false;
  channel: "chrome";
  chromiumSandbox: true;
  ignoreDefaultArgs: string[];
  args: string[];
  viewport: { width: number; height: number };
}

/**
 * Minimal desktop launch against Matan's real (or cloned) Chrome profile.
 * Always uses channel:'chrome' + chromiumSandbox so macOS does not get --no-sandbox.
 */
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
    // Critical: without this Playwright always injects --no-sandbox
    chromiumSandbox: true,
    ignoreDefaultArgs: [...CHROME_IGNORE_DEFAULT_ARGS],
    args: [
      `--profile-directory=${profileDirectory}`,
      "--disable-blink-features=AutomationControlled",
    ],
    viewport: opts.viewport ?? { width: 1280, height: 900 },
  };
}

export async function launchChromePersistent(
  opts: LaunchChromePersistentOpts,
): Promise<BrowserContext> {
  const userDataDir = normalizeChromeUserDataDir(opts.userDataDir);
  if (!userDataDir) {
    throw new Error("לא הוגדר נתיב Chrome");
  }
  return chromium.launchPersistentContext(userDataDir, chromePersistentLaunchOptions(opts));
}

/** Resolve which directory Playwright should open (live vs clone) */
export function resolveLaunchUserDataDir(opts: {
  chromeUserDataDir?: string;
  jobbotChromeProfileDir?: string;
  useChromeClone?: boolean;
}): string {
  if (opts.useChromeClone && opts.jobbotChromeProfileDir) {
    return normalizeChromeUserDataDir(opts.jobbotChromeProfileDir);
  }
  // Live mode — never fall back to a blank clone path
  return normalizeChromeUserDataDir(opts.chromeUserDataDir || "");
}
