#!/usr/bin/env node
/**
 * Headless demo of the JobRunner (no Electron window).
 * Usage: node scripts/demo-run.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const require = createRequire(import.meta.url);

// Compile-free path: run via tsx if available, else instruct user
async function main() {
  process.env.JOBBOT_DEMO = "1";
  const dataDir = path.join(root, "data", "local");
  fs.mkdirSync(path.join(dataDir, "knowledge"), { recursive: true });
  fs.mkdirSync(path.join(dataDir, "runs"), { recursive: true });

  let JobRunner;
  try {
    // Prefer compiled / tsx register
    ({ JobRunner } = await import("../core/runner/orchestrator.ts"));
  } catch {
    console.error("Run with: npx tsx scripts/demo-run.ts");
    process.exit(1);
  }

  const { DEFAULT_SETTINGS } = await import("../core/types.ts");
  const runner = new JobRunner(dataDir, { demo: true });
  runner.onProgress((p) => {
    const last = p.logs[p.logs.length - 1];
    if (last) console.log(`[${p.phase}] ${last.message}`);
  });

  const result = await runner.run(
    { ...DEFAULT_SETTINGS, sendEmailAfterRun: false, enabledSites: ["linkedin", "indeed", "alljobs"] },
    {
      searchMode: "keywords",
      keywords: ["React", "TypeScript"],
      enabledSites: ["linkedin", "indeed", "alljobs"],
      location: "Israel",
      jobLimitPerSite: 3,
      perJobTimeoutMs: 15000,
      perSiteTimeoutMs: 30000,
      maxRetries: 1,
    },
  );

  const out = path.join(dataDir, "runs", "demo-report.html");
  fs.writeFileSync(out, result.reportHtml, "utf8");
  console.log("\nDone:", {
    found: result.progress.found,
    applied: result.progress.applied,
    failed: result.progress.failed,
    report: out,
    learningNotes: result.learningNotes,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
