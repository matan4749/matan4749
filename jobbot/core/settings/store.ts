import fs from "node:fs";
import path from "node:path";
import { normalizeChromeUserDataDir } from "../browser/chrome-paths";
import { DEFAULT_SETTINGS, EXCLUDED_SITES, type AppSettings } from "../types";
import { resolveDefaultCvPath } from "../cv/paths";

export function settingsPath(dataDir: string): string {
  return path.join(dataDir, "settings.json");
}

function envDefaults(appRoot?: string): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    reportEmail: process.env.JOBBOT_REPORT_EMAIL || DEFAULT_SETTINGS.reportEmail,
    cvPath: resolveDefaultCvPath(process.env.JOBBOT_CV_PATH, appRoot),
    chromeUserDataDir: process.env.JOBBOT_CHROME_PROFILE || "",
  };
}

/** Strip legacy SMTP fields if present in older settings.json */
function normalize(
  raw: Partial<AppSettings> & { smtp?: unknown },
  appRoot?: string,
): AppSettings {
  const base = envDefaults(appRoot);
  const { smtp: _legacy, ...rest } = raw;
  void _legacy;
  const cvPath = resolveDefaultCvPath(rest.cvPath || base.cvPath, appRoot);
  const reportEmail =
    (rest.reportEmail && rest.reportEmail.trim()) || base.reportEmail;
  const chromeRaw = (rest.chromeUserDataDir ?? base.chromeUserDataDir) || "";
  return {
    ...base,
    ...rest,
    cvPath,
    reportEmail,
    chromeUserDataDir: chromeRaw ? normalizeChromeUserDataDir(chromeRaw) : "",
    enabledSites:
      rest.enabledSites && rest.enabledSites.length
        ? sanitizeSites(rest.enabledSites)
        : base.enabledSites,
  };
}

/** Drop excluded sites; ensure Elbit + IAI remain available */
function sanitizeSites(sites: string[]): string[] {
  const excluded = new Set<string>(EXCLUDED_SITES);
  const next = sites.filter((id) => !excluded.has(id));
  for (const id of ["elbit", "iai"]) {
    if (!next.includes(id)) next.push(id);
  }
  return next;
}

export function loadSettings(dataDir: string, appRoot?: string): AppSettings {
  const p = settingsPath(dataDir);
  try {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<AppSettings> & {
        smtp?: unknown;
      };
      return normalize(raw, appRoot);
    }
  } catch {
    /* defaults */
  }
  return envDefaults(appRoot);
}

export function saveSettings(dataDir: string, settings: AppSettings): void {
  fs.mkdirSync(dataDir, { recursive: true });
  const clean: AppSettings = {
    cvPath: settings.cvPath,
    chromeUserDataDir: settings.chromeUserDataDir
      ? normalizeChromeUserDataDir(settings.chromeUserDataDir)
      : "",
    reportEmail: settings.reportEmail,
    keywords: settings.keywords,
    location: settings.location,
    enabledSites: settings.enabledSites,
    jobLimitPerSite: settings.jobLimitPerSite,
    sendEmailAfterRun: settings.sendEmailAfterRun,
    llmApiKey: settings.llmApiKey || "",
    llmBaseUrl: settings.llmBaseUrl || "",
    llmModel: settings.llmModel || "",
  };
  fs.writeFileSync(settingsPath(dataDir), JSON.stringify(clean, null, 2), "utf8");
}

/** Copy store/bundled CV into app userData so Electron always has a local file */
export function seedCvIntoDataDir(dataDir: string, appRoot?: string): string {
  const source = resolveDefaultCvPath(undefined, appRoot);
  const destDir = path.join(dataDir, "cv");
  const dest = path.join(destDir, "matan-amar-cv.pdf");
  fs.mkdirSync(destDir, { recursive: true });
  try {
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, dest);
      return dest;
    }
  } catch {
    /* keep existing dest if any */
  }
  return fs.existsSync(dest) ? dest : source;
}
