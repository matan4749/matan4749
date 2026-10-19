import fs from "node:fs";
import path from "node:path";

/** Persistent Jobbot Chrome user-data-dir — survives across runs; never wiped on start */
export function jobbotBrowserProfileRoot(dataDir: string): string {
  const root = path.join(dataDir, "browser-profile");
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/** Login URLs opened during the manual login gate */
export const SITE_LOGIN_URLS: Record<string, string> = {
  linkedin: "https://www.linkedin.com/feed/",
  indeed: "https://il.indeed.com/",
  elbit: "https://www.elbitsystems.com/careers/",
  iai: "https://www.iai.co.il/careers",
  alljobs: "https://www.alljobs.co.il/",
  drushim: "https://www.drushim.co.il/",
};

export function loginUrlForSite(siteId: string): string {
  return SITE_LOGIN_URLS[siteId] || "about:blank";
}
