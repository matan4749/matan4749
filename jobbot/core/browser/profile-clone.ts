import fs from "node:fs";
import path from "node:path";
import { isChromeRunning } from "./chrome-lock";

/** Lock / session files — must never be copied into Jobbot's clone */
const SKIP_BASENAMES = new Set([
  "SingletonLock",
  "SingletonCookie",
  "SingletonSocket",
  "lockfile",
  "RunningChromeVersion",
  ".DS_Store",
]);

/** Heavy / non-essential dirs — skip for faster first-run sync */
const SKIP_DIRNAMES = new Set([
  "Cache",
  "Code Cache",
  "GPUCache",
  "GrShaderCache",
  "ShaderCache",
  "DawnCache",
  "Media Cache",
  "Service Worker",
  "VideoDecodeStats",
  "BrowserMetrics",
  "Crashpad",
  "Crash Reports",
  "optimization_guide_hint_cache_store",
  "OptimizationGuidePredictionModelDownloads",
  "component_crx_cache",
  "extensions_crx_cache",
  "File System",
  "blob_storage",
  "Download Service",
  "Safe Browsing",
  "pnacl",
  "WasmTtsEngine",
]);

export interface CloneResult {
  /** Path to pass to launchPersistentContext */
  path: string;
  synced: boolean;
  skippedHeavy: boolean;
  chromeWasRunning: boolean;
  messageHe: string;
  sourcePath: string;
}

/** Exported for unit tests — false for Singleton* / heavy cache dirs */
export function shouldCopyPath(srcPath: string): boolean {
  const base = path.basename(srcPath);
  if (SKIP_BASENAMES.has(base)) return false;
  if (SKIP_DIRNAMES.has(base)) return false;
  return true;
}

function shouldCopy(srcPath: string): boolean {
  return shouldCopyPath(srcPath);
}

function cookiesPath(userDataDir: string, profile = "Default"): string {
  return path.join(userDataDir, profile, "Cookies");
}

function detectProfileName(sourceUserDataDir: string): string {
  const defaultDir = path.join(sourceUserDataDir, "Default");
  if (fs.existsSync(defaultDir)) return "Default";
  // If user pointed at .../Chrome/Default itself, treat parent as user-data and profile Default
  if (path.basename(sourceUserDataDir) === "Default") return "Default";
  try {
    const entries = fs.readdirSync(sourceUserDataDir);
    const profile = entries.find((e) => /^Profile \d+$/i.test(e));
    if (profile) return profile;
  } catch {
    /* ignore */
  }
  return "Default";
}

function normalizeSource(sourceUserDataDir: string): { root: string; profile: string } {
  const base = path.basename(sourceUserDataDir);
  if (base === "Default" || /^Profile \d+$/i.test(base)) {
    return { root: path.dirname(sourceUserDataDir), profile: base };
  }
  return { root: sourceUserDataDir, profile: detectProfileName(sourceUserDataDir) };
}

function cloneNeedsSync(sourceRoot: string, cloneRoot: string, profile: string): boolean {
  const srcCookies = cookiesPath(sourceRoot, profile);
  const dstCookies = cookiesPath(cloneRoot, profile);
  if (!fs.existsSync(cloneRoot)) return true;
  if (!fs.existsSync(dstCookies)) return true;
  if (!fs.existsSync(srcCookies)) return false;
  try {
    const srcM = fs.statSync(srcCookies).mtimeMs;
    const dstM = fs.statSync(dstCookies).mtimeMs;
    // Resync if source cookies are > 2 minutes newer
    return srcM > dstM + 120_000;
  } catch {
    return true;
  }
}

function scrubSingletonFiles(cloneRoot: string): void {
  for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket", "lockfile"]) {
    const p = path.join(cloneRoot, name);
    try {
      if (fs.existsSync(p)) fs.rmSync(p, { force: true });
    } catch {
      /* ignore */
    }
  }
}

async function copyFiltered(src: string, dest: string): Promise<void> {
  await fs.promises.cp(src, dest, {
    recursive: true,
    force: true,
    errorOnExist: false,
    filter: (srcPath) => shouldCopy(srcPath),
  });
}

/**
 * Ensure a Jobbot-owned Chrome user-data-dir exists, synced from Matan's profile.
 * Playwright always launches against the clone — so normal Chrome can stay open
 * after the first successful sync.
 */
export async function ensureJobbotChromeProfile(opts: {
  sourceUserDataDir: string;
  cloneRoot: string;
  force?: boolean;
  log?: (message: string) => void;
}): Promise<CloneResult> {
  const log = opts.log ?? (() => undefined);
  const { root: sourceRoot, profile } = normalizeSource(opts.sourceUserDataDir);
  const cloneRoot = opts.cloneRoot;
  const chromeWasRunning = await isChromeRunning();

  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`נתיב Chrome לא קיים: ${sourceRoot}`);
  }

  const needs = opts.force || cloneNeedsSync(sourceRoot, cloneRoot, profile);

  if (!needs) {
    scrubSingletonFiles(cloneRoot);
    log(`עותק פרופיל Jobbot מוכן (ללא סנכרון מחדש): ${cloneRoot}`);
    return {
      path: cloneRoot,
      synced: false,
      skippedHeavy: true,
      chromeWasRunning,
      sourcePath: sourceRoot,
      messageHe: chromeWasRunning
        ? "משתמש בעותק פרופיל קיים — אפשר להשאיר את Chrome פתוח."
        : "משתמש בעותק פרופיל קיים.",
    };
  }

  log(
    chromeWasRunning
      ? "מסנכרן עותק פרופיל בזמן ש-Chrome פתוח — אם נכשל, סגור עם Cmd+Q ונסה שוב (פעם אחת)."
      : "מסנכרן עותק פרופיל Chrome ל-Jobbot (פעם ראשונה / עדכון) — זה יכול לקחת דקה…",
  );

  fs.mkdirSync(cloneRoot, { recursive: true });

  // Copy Local State + selected top-level bits
  for (const name of ["Local State", "First Run"]) {
    const from = path.join(sourceRoot, name);
    const to = path.join(cloneRoot, name);
    if (fs.existsSync(from)) {
      try {
        await fs.promises.copyFile(from, to);
      } catch (err) {
        log(`אזהרה: לא הועתק ${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const srcProfile = path.join(sourceRoot, profile);
  const dstProfile = path.join(cloneRoot, profile);
  if (!fs.existsSync(srcProfile)) {
    throw new Error(`תיקיית פרופיל לא נמצאה: ${srcProfile}`);
  }

  try {
    // Remove stale profile dir then copy filtered
    if (fs.existsSync(dstProfile)) {
      fs.rmSync(dstProfile, { recursive: true, force: true });
    }
    await copyFiltered(srcProfile, dstProfile);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (chromeWasRunning) {
      throw new Error(
        `סנכרון הפרופיל נכשל בזמן ש-Chrome פתוח (${detail.slice(0, 120)}). סגור את Chrome לגמרי עם Cmd+Q (לא רק לסגור חלון), ודא שאין Chrome ב־Dock עם נקודה, ואז הרץ שוב.`,
      );
    }
    throw new Error(`סנכרון פרופיל Chrome נכשל: ${detail.slice(0, 180)}`);
  }

  scrubSingletonFiles(cloneRoot);
  log(`סנכרון הושלם → ${cloneRoot} (פרופיל: ${profile})`);

  return {
    path: cloneRoot,
    synced: true,
    skippedHeavy: true,
    chromeWasRunning,
    sourcePath: sourceRoot,
    messageHe: chromeWasRunning
      ? "סנכרון הצליח גם עם Chrome פתוח. מעתה Jobbot רץ על עותק נפרד."
      : "סנכרון פרופיל הושלם. מעתה אפשר להשאיר את Chrome פתוח בזמן ריצות Jobbot.",
  };
}

export function jobbotCloneRoot(dataDir: string): string {
  return path.join(dataDir, "chrome-clone");
}
