import fs from "node:fs";
import path from "node:path";

/** Persistent Jobbot Chrome user-data-dir — survives across runs; never wiped on start */
export function jobbotBrowserProfileRoot(dataDir: string): string {
  const root = path.join(dataDir, "browser-profile");
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/**
 * Explicit user action only — never call automatically on start/run.
 * Wipes the Jobbot Chrome profile so the next run shows a fresh login gate.
 */
export function clearJobbotBrowserProfile(dataDir: string): {
  ok: boolean;
  path: string;
  messageHe: string;
} {
  const root = path.join(dataDir, "browser-profile");
  try {
    if (fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    fs.mkdirSync(root, { recursive: true });
    return {
      ok: true,
      path: root,
      messageHe:
        "פרופיל Jobbot נוקה. בריצה הבאה תתבקש להתחבר מחדש — ההתחברות תישמר אחרי «המשך לריצה».",
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return {
      ok: false,
      path: root,
      messageHe: `לא ניתן לנקות את פרופיל Jobbot: ${detail.slice(0, 160)}`,
    };
  }
}

/** Login URLs opened during the manual login gate / session probe */
export const SITE_LOGIN_URLS: Record<string, string> = {
  linkedin: "https://www.linkedin.com/feed/",
  indeed: "https://il.indeed.com/",
  elbit: "https://elbitsystemscareer.com/",
  iai: "https://jobs.iai.co.il/jobs",
  alljobs: "https://www.alljobs.co.il/",
  drushim: "https://www.drushim.co.il/",
};

export function loginUrlForSite(siteId: string): string {
  return SITE_LOGIN_URLS[siteId] || "about:blank";
}
