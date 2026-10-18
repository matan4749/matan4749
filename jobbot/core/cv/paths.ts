import fs from "node:fs";
import path from "node:path";

/** Canonical CV in the Jobbot Project store (source of truth from user upload). */
export const STORE_CV_PATH = "/cursor/stores/self/cv/matan-amar-cv.pdf";

/** Bundled copy shipped with the desktop app for local runs. */
export function bundledCvPath(appRoot?: string): string {
  const root = appRoot || process.cwd();
  return path.join(root, "assets", "cv", "matan-amar-cv.pdf");
}

/** Packaged Electron extraResources path */
export function packagedCvPath(): string | null {
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (!resources) return null;
  return path.join(resources, "cv", "matan-amar-cv.pdf");
}

/**
 * Resolve the best available CV path:
 * 1. explicit override (settings / env)
 * 2. packaged extraResources
 * 3. bundled assets copy
 * 4. Project store canonical path
 */
export function resolveDefaultCvPath(explicit?: string, appRoot?: string): string {
  const candidates = [
    explicit?.trim(),
    process.env.JOBBOT_CV_PATH?.trim(),
    packagedCvPath() || undefined,
    bundledCvPath(appRoot),
    STORE_CV_PATH,
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* skip */
    }
  }
  return candidates[0] || bundledCvPath(appRoot);
}
