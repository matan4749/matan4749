import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Shown when Chrome profile is locked / still running */
export const CHROME_QUIT_MSG_HE =
  "סגור את Chrome לגמרי עם Cmd+Q (לא רק לסגור חלון), ודא שאין Chrome ב־Dock עם נקודה, ואז הרץ שוב.";

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
  return `פתיחת Chrome נכשלה: ${detail.slice(0, 200)}`;
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
