import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Expand ~ and resolve absolute path */
export function resolveChromeUserDataDir(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return path.resolve(trimmed);
}

/**
 * Chrome --user-data-dir is the folder that CONTAINS Default / Profile N.
 * If the user picked .../Chrome/Default, walk up to .../Chrome.
 */
export function normalizeChromeUserDataDir(raw: string): string {
  let p = resolveChromeUserDataDir(raw);
  if (!p) return "";
  // Strip trailing slashes
  while (p.length > 1 && (p.endsWith("/") || p.endsWith("\\"))) {
    p = p.slice(0, -1);
  }
  const base = path.basename(p);
  if (base === "Default" || /^Profile \d+$/i.test(base)) {
    return path.dirname(p);
  }
  return p;
}

export function defaultMacChromeUserDataDir(): string {
  return path.join(os.homedir(), "Library/Application Support/Google/Chrome");
}

/** Profile folder name inside user-data-dir */
export function detectChromeProfileName(userDataRoot: string): string {
  const root = normalizeChromeUserDataDir(userDataRoot);
  if (!root) return "Default";
  const defaultDir = path.join(root, "Default");
  try {
    if (fs.existsSync(defaultDir)) return "Default";
  } catch {
    /* EPERM etc. */
  }
  try {
    const entries = fs.readdirSync(root);
    const profile = entries.find((e) => /^Profile \d+$/i.test(e));
    if (profile) return profile;
  } catch {
    /* ignore */
  }
  return "Default";
}

export const CHROME_EPERM_MSG_HE =
  "אין הרשאה לקרוא את פרופיל Chrome (EPERM).\n\n" +
  "מה לעשות:\n" +
  "1) הגדרות מערכת → פרטיות ואבטחה → Full Disk Access → הפעל את Jobbot (ואז הפעל מחדש את Jobbot)\n" +
  "2) סגור Chrome לגמרי עם Cmd+Q\n" +
  "3) הנתיב חייב להיות …/Google/Chrome (בלי /Default בסוף)\n" +
  "   למשל: /Users/matan_amar/Library/Application Support/Google/Chrome";

export function isChromeEpermError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
  return code === "EPERM" || /EPERM|operation not permitted|opendir/i.test(msg);
}

export function chromeSyncErrorHe(err: unknown, chromeWasRunning: boolean): string {
  if (isChromeEpermError(err)) return CHROME_EPERM_MSG_HE;
  const raw = err instanceof Error ? err.message : String(err);
  // First line only — never dump stack traces to the UI
  const detail = raw.split("\n")[0]?.trim().slice(0, 160) || "שגיאה לא ידועה";
  if (chromeWasRunning || /SingletonLock|in use|already in use/i.test(detail)) {
    return (
      "סנכרון נכשל בזמן ש-Chrome פתוח או נעול. " +
      "סגור לגמרי עם Cmd+Q (לא רק חלון), ודא שאין נקודה ב־Dock, ואז נסה שוב."
    );
  }
  return `סנכרון פרופיל Chrome נכשל: ${detail}`;
}
