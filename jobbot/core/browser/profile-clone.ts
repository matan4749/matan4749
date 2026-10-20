import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { isChromeRunning } from "./chrome-lock";
import {
  chromeSyncErrorHe,
  detectChromeProfileName,
  isChromeEpermError,
  normalizeChromeUserDataDir,
} from "./chrome-paths";
import { assertChromeSessionArtifacts, checkChromeSessionArtifacts } from "./session-artifacts";

const execFileAsync = promisify(execFile);

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

function cookiesPath(userDataDir: string, profile = "Default"): string {
  return path.join(userDataDir, profile, "Cookies");
}

/** Exported for tests */
export function normalizeSource(sourceUserDataDir: string): { root: string; profile: string } {
  const root = normalizeChromeUserDataDir(sourceUserDataDir);
  const base = path.basename(resolveKeepProfileHint(sourceUserDataDir));
  if (base === "Default" || /^Profile \d+$/i.test(base)) {
    return { root, profile: base };
  }
  return { root, profile: detectChromeProfileName(root) };
}

function resolveKeepProfileHint(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return path.resolve(trimmed);
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
    return srcM > dstM + 120_000;
  } catch (err) {
    if (isChromeEpermError(err)) throw err;
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
    filter: (srcPath) => shouldCopyPath(srcPath),
  });
}

/** macOS ditto often handles TCC better than Node fs.cp for large trees */
async function copyWithDitto(src: string, dest: string): Promise<void> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  await execFileAsync("/usr/bin/ditto", [src, dest], { timeout: 180_000 });
  // Strip heavy caches from clone after ditto
  for (const name of SKIP_DIRNAMES) {
    const p = path.join(dest, name);
    try {
      if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  for (const name of SKIP_BASENAMES) {
    const p = path.join(dest, name);
    try {
      if (fs.existsSync(p)) fs.rmSync(p, { force: true });
    } catch {
      /* ignore */
    }
  }
}

function assertReadableDir(dir: string): void {
  try {
    fs.readdirSync(dir);
  } catch (err) {
    throw err;
  }
}

/**
 * Ensure a Jobbot-owned Chrome user-data-dir exists, synced from Matan's profile.
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

  if (!sourceRoot) {
    throw new Error("לא הוגדר נתיב Chrome");
  }
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`נתיב Chrome לא קיים: ${sourceRoot}`);
  }

  // Probe readability early (clears EPERM before long copy)
  const srcProfile = path.join(sourceRoot, profile);
  try {
    assertReadableDir(sourceRoot);
    if (fs.existsSync(srcProfile)) assertReadableDir(srcProfile);
  } catch (err) {
    throw new Error(chromeSyncErrorHe(err, chromeWasRunning));
  }

  let needs: boolean;
  try {
    needs = opts.force || cloneNeedsSync(sourceRoot, cloneRoot, profile);
  } catch (err) {
    throw new Error(chromeSyncErrorHe(err, chromeWasRunning));
  }

  if (!needs) {
    scrubSingletonFiles(cloneRoot);
    const existing = checkChromeSessionArtifacts(cloneRoot, profile);
    if (!existing.ok) {
      // Stale/empty clone — force a full resync instead of launching blank
      log("עותק קיים בלי Cookies — מסנכרן מחדש מהפרופיל החי…");
      needs = true;
    } else {
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
  }

  log(
    chromeWasRunning
      ? "מסנכרן עותק פרופיל בזמן ש-Chrome פתוח — אם נכשל: Cmd+Q או Full Disk Access."
      : "מסנכרן עותק פרופיל Chrome ל-Jobbot (פעם ראשונה / עדכון)…",
  );
  log(`מקור (user-data-dir): ${sourceRoot} · פרופיל: ${profile}`);

  fs.mkdirSync(cloneRoot, { recursive: true });

  // Top-level bits Chrome needs to recognize the same profiles
  for (const name of [
    "Local State",
    "First Run",
    "Last Version",
    "Variations",
    "Secure Preferences",
  ]) {
    const from = path.join(sourceRoot, name);
    const to = path.join(cloneRoot, name);
    if (fs.existsSync(from)) {
      try {
        await fs.promises.copyFile(from, to);
      } catch (err) {
        if (isChromeEpermError(err)) throw new Error(chromeSyncErrorHe(err, chromeWasRunning));
        log(`אזהרה: לא הועתק ${name}`);
      }
    }
  }

  if (!fs.existsSync(srcProfile)) {
    throw new Error(
      `תיקיית פרופיל לא נמצאה: ${srcProfile}\nודא שהנתיב הוא …/Google/Chrome (לא תיקייה ריקה).`,
    );
  }

  const dstProfile = path.join(cloneRoot, profile);
  try {
    if (fs.existsSync(dstProfile)) {
      fs.rmSync(dstProfile, { recursive: true, force: true });
    }
    if (process.platform === "darwin" && fs.existsSync("/usr/bin/ditto")) {
      try {
        await copyWithDitto(srcProfile, dstProfile);
      } catch (dittoErr) {
        if (isChromeEpermError(dittoErr)) throw dittoErr;
        log("ditto נכשל — מנסה העתקה רגילה…");
        await copyFiltered(srcProfile, dstProfile);
      }
    } else {
      await copyFiltered(srcProfile, dstProfile);
    }
  } catch (err) {
    throw new Error(chromeSyncErrorHe(err, chromeWasRunning));
  }

  scrubSingletonFiles(cloneRoot);

  // Never continue with an empty clone — abort hard
  try {
    assertChromeSessionArtifacts(cloneRoot, profile);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      detail.includes("Cookies")
        ? detail
        : `סנכרון העותק נכשל — אין Cookies בפרופיל. ${detail}`,
    );
  }

  log(`סנכרון הושלם → ${cloneRoot} (פרופיל: ${profile})`);

  return {
    path: cloneRoot,
    synced: true,
    skippedHeavy: true,
    chromeWasRunning,
    sourcePath: sourceRoot,
    messageHe: chromeWasRunning
      ? "סנכרון הצליח גם עם Chrome פתוח. מעתה Jobbot רץ על עותק נפרד עם Cookies."
      : "סנכרון פרופיל הושלם (כולל Cookies/Login Data). אפשר להשאיר Chrome פתוח בריצות הבאות.",
  };
}

export function jobbotCloneRoot(dataDir: string): string {
  return path.join(dataDir, "chrome-clone");
}
