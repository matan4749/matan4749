import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Shown when Chrome profile is locked / still running */
export const CHROME_QUIT_MSG_HE =
  "סגור את Chrome לגמרי עם Cmd+Q (לא רק לסגור חלון), ודא שאין Chrome ב־Dock עם נקודה, ואז הרץ שוב.";

export const CHROME_STILL_OPEN_HE =
  "Chrome עדיין פתוח — לחץ Cmd+Q ונסה שוב";

export const CHROME_CLOSED_OK_HE = "Chrome סגור — אפשר להתחיל";

export const CHROME_CLONE_HINT_HE =
  "Jobbot משתמש בעותק פרופיל נפרד — אחרי סנכרון ראשון אפשר להשאיר את Chrome פתוח. אם הסנכרון נכשל בזמן ש-Chrome פתוח, סגור פעם אחת עם Cmd+Q.";

export function isChromeLockError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    /SingletonLock|ProcessSingleton|profile.*in use|user data directory is already in use|opening in an existing browser session|פתיחה בסשן קיים|Target page, context or browser has been closed|Target closed|browser has been closed/i.test(
      msg,
    )
  );
}

export function chromeLaunchErrorHe(err: unknown): string {
  if (isChromeLockError(err)) return CHROME_QUIT_MSG_HE;
  const detail = err instanceof Error ? err.message : String(err);
  // Already mapped Hebrew guidance (timeout checklist / FDA / etc.) — first line only, no Playwright dumps
  if (
    /Full Disk Access|גישה מלאה לדיסק|אין הרשאה לקרוא את פרופיל|פתיחת Chrome נכשלה \(timeout\)|Activity Monitor|SingletonLock/i.test(
      detail,
    )
  ) {
    // Keep multi-line Hebrew checklists; strip call logs after blank line + "Call log"
    const cut = detail.split(/\nCall log/i)[0]?.trim() || detail;
    return cut.slice(0, 900);
  }
  if (/Timeout \d+ms exceeded|CDP|connectOverCDP|launchPersistentContext/i.test(detail)) {
    // Lazy import avoided — duplicate short checklist (kept in launch-chrome as CHROME_LAUNCH_TIMEOUT_HE)
    return (
      "פתיחת Chrome נכשלה (timeout).\n" +
      "בדוק:\n" +
      "1) Cmd+Q — אין «Google Chrome» ב-Activity Monitor\n" +
      "2) Full Disk Access ל־Jobbot\n" +
      "3) אם מופיעה בקשת Keychain — אשר\n" +
      "4) מחק SingletonLock יתום תחת …/Google/Chrome אם אין תהליך Chrome\n" +
      "5) הנתיב: …/Google/Chrome (בלי /Default)"
    );
  }
  if (/EPERM|operation not permitted/i.test(detail)) {
    return (
      "אין הרשאה לקרוא את פרופיל Chrome (EPERM).\n" +
      "הגדרות מערכת → פרטיות ואבטחה → Full Disk Access → הפעל Jobbot, " +
      "סגור Chrome עם Cmd+Q, והנתיב חייב להיות …/Google/Chrome."
    );
  }
  const first = detail.split("\n")[0]?.trim().slice(0, 160) || "שגיאה לא ידועה";
  return `פתיחת Chrome נכשלה: ${first}`;
}

/** True if Google Chrome (not Playwright Chromium) appears to be running */
export async function isChromeRunning(): Promise<boolean> {
  try {
    if (process.platform === "darwin") {
      const { stdout } = await execFileAsync("pgrep", ["-x", "Google Chrome"], {
        timeout: 4000,
      }).catch((e: { code?: number; stdout?: string }) => {
        if (e.code === 1) return { stdout: "" };
        throw e;
      });
      return Boolean(stdout?.trim());
    }
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync(
        "tasklist",
        ["/FI", "IMAGENAME eq chrome.exe", "/NH"],
        { timeout: 5000 },
      );
      return /chrome\.exe/i.test(stdout);
    }
    // linux
    for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
      const { stdout } = await execFileAsync("pgrep", ["-x", name], { timeout: 4000 }).catch(
        (e: { code?: number }) => {
          if (e.code === 1) return { stdout: "" };
          throw e;
        },
      );
      if (stdout?.trim()) return true;
    }
    return false;
  } catch {
    return false;
  }
}

const LOCK_NAMES = ["SingletonLock", "SingletonCookie", "SingletonSocket"] as const;

/**
 * Resolve Chrome user-data root (parent if path points at Default/Profile N).
 */
export function chromeUserDataRoot(userDataDir: string): string {
  // Local normalize to avoid circular imports with chrome-paths consumers
  const trimmed = (userDataDir || "").trim();
  if (!trimmed) return "";
  const base = path.basename(trimmed.replace(/[/\\]+$/, ""));
  if (base === "Default" || /^Profile \d+$/i.test(base)) {
    return path.dirname(trimmed.replace(/[/\\]+$/, ""));
  }
  return trimmed;
}

/** True if SingletonLock (or sibling lock files) exist under the profile root */
export function hasProfileSingletonLock(userDataDir: string): boolean {
  const root = chromeUserDataRoot(userDataDir);
  if (!root || !fs.existsSync(root)) return false;
  for (const name of LOCK_NAMES) {
    try {
      if (fs.existsSync(path.join(root, name))) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

export interface ChromeClosedCheck {
  ok: boolean;
  chromeRunning: boolean;
  profileLocked: boolean;
  pathChecked: string;
  messageHe: string;
  checkedAt: string;
}

/**
 * Pre-start safety: Chrome process not running + no SingletonLock on source profile.
 * Clear Hebrew result — no stack dumps.
 */
export async function checkChromeClosed(userDataDir?: string): Promise<ChromeClosedCheck> {
  const pathChecked = chromeUserDataRoot((userDataDir || "").trim());
  const chromeRunning = await isChromeRunning();
  const profileLocked = pathChecked ? hasProfileSingletonLock(pathChecked) : false;
  const ok = !chromeRunning && !profileLocked;
  const checkedAt = new Date().toISOString();

  if (ok) {
    return {
      ok: true,
      chromeRunning: false,
      profileLocked: false,
      pathChecked,
      messageHe: CHROME_CLOSED_OK_HE,
      checkedAt,
    };
  }

  let messageHe = CHROME_STILL_OPEN_HE;
  if (chromeRunning && profileLocked) {
    messageHe =
      "Chrome עדיין פתוח (תהליך + נעילת פרופיל) — לחץ Cmd+Q ונסה שוב";
  } else if (profileLocked && !chromeRunning) {
    messageHe =
      "נמצאה נעילת פרופיל (SingletonLock) — לחץ Cmd+Q, ודא שאין נקודה ב־Dock, ונסה שוב";
  }

  return {
    ok: false,
    chromeRunning,
    profileLocked,
    pathChecked,
    messageHe,
    checkedAt,
  };
}
