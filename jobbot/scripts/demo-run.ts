import fs from "node:fs";
import path from "node:path";
import { JobRunner } from "../core/runner/orchestrator";
import { DEFAULT_SETTINGS } from "../core/types";
import { resolveDefaultCvPath } from "../core/cv/paths";
import { analyzeCv } from "../core/cv/analyze";

async function main() {
  process.env.JOBBOT_DEMO = "1";
  const dataDir = path.join(process.cwd(), "data", "local");
  fs.mkdirSync(path.join(dataDir, "knowledge"), { recursive: true });
  fs.mkdirSync(path.join(dataDir, "runs"), { recursive: true });
  fs.mkdirSync(path.join(dataDir, "outbox"), { recursive: true });

  const cvPath = resolveDefaultCvPath(undefined, process.cwd());
  const analysis = await analyzeCv(cvPath);
  console.log("CV:", cvPath, "→ keywords:", analysis.suggestedKeywords.join(", ") || "(none)");

  const runner = new JobRunner(dataDir, { demo: true });
  runner.onProgress((p) => {
    const last = p.logs[p.logs.length - 1];
    if (last) console.log(`[${p.phase}] ${last.message}`);
  });

  const result = await runner.run(
    {
      ...DEFAULT_SETTINGS,
      cvPath,
      sendEmailAfterRun: true,
      reportEmail: process.env.JOBBOT_REPORT_EMAIL || "matan4749@gmail.com",
      enabledSites: ["linkedin", "indeed", "elbit", "iai"],
    },
    {
      searchMode: "cv",
      keywords: analysis.suggestedKeywords,
      enabledSites: ["linkedin", "indeed", "elbit", "iai"],
      location: "Israel",
      jobLimitPerSite: 2,
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
    email: result.email,
    learningNotes: result.learningNotes,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
