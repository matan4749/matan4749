import fs from "node:fs";
import path from "node:path";
import { detectChromeProfileName, normalizeChromeUserDataDir } from "./chrome-paths";

/** Session files that must exist (and not be tiny) for a usable Chrome profile */
export const SESSION_CRITICAL_FILES = [
  "Cookies",
  "Login Data",
  "Preferences",
  "Network Persistent State",
] as const;

export const EMPTY_SESSION_HE =
  "פרופיל Chrome ריק / בלי Cookies — Jobbot לא ימשיך עם פרופיל ריק.\n" +
  "סגור Chrome (Cmd+Q), ודא נתיב …/Google/Chrome, הפעל Full Disk Access, " +
  "ובמצב עותק לחץ «רענון עותק פרופיל».";

export interface SessionArtifactsCheck {
  ok: boolean;
  profile: string;
  root: string;
  missing: string[];
  cookiesBytes: number;
  messageHe: string;
}

export function checkChromeSessionArtifacts(
  userDataDir: string,
  profileHint?: string,
): SessionArtifactsCheck {
  const root = normalizeChromeUserDataDir(userDataDir);
  const profile = profileHint || detectChromeProfileName(root) || "Default";
  const missing: string[] = [];
  let cookiesBytes = 0;

  if (!root || !fs.existsSync(root)) {
    return {
      ok: false,
      profile,
      root: root || "",
      missing: ["(root)"],
      cookiesBytes: 0,
      messageHe: EMPTY_SESSION_HE,
    };
  }

  const profileDir = path.join(root, profile);
  if (!fs.existsSync(profileDir)) {
    return {
      ok: false,
      profile,
      root,
      missing: [profile],
      cookiesBytes: 0,
      messageHe: EMPTY_SESSION_HE,
    };
  }

  for (const name of SESSION_CRITICAL_FILES) {
    const p = path.join(profileDir, name);
    try {
      if (!fs.existsSync(p)) {
        // Network Persistent State / Login Data optional-ish on some installs
        if (name === "Cookies" || name === "Preferences") missing.push(name);
        continue;
      }
      const st = fs.statSync(p);
      if (name === "Cookies") cookiesBytes = st.size;
      if (name === "Cookies" && st.size < 64) missing.push("Cookies(empty)");
    } catch {
      if (name === "Cookies" || name === "Preferences") missing.push(name);
    }
  }

  // Also accept Cookies-journal sibling presence when Cookies exists with size
  const ok = cookiesBytes >= 64 && !missing.includes("Cookies") && !missing.includes("Cookies(empty)");
  return {
    ok,
    profile,
    root,
    missing,
    cookiesBytes,
    messageHe: ok
      ? `סשן תקין (${profile}, Cookies ${cookiesBytes}B)`
      : EMPTY_SESSION_HE,
  };
}

export function assertChromeSessionArtifacts(userDataDir: string, profileHint?: string): void {
  const check = checkChromeSessionArtifacts(userDataDir, profileHint);
  if (!check.ok) {
    throw new Error(check.messageHe);
  }
}
