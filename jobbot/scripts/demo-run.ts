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
    skipped: result.progress.skipped,
    report: out,
    email: result.email,
    learningNotes: result.learningNotes,
  });

  // Honest-run gate: demo must never claim real applications
  if (result.progress.applied !== 0) {
    console.error("FAIL: demo run reported applied > 0 — false success");
    process.exit(1);
  }
  const fakeApplied = result.progress.results.filter((r) => r.status === "applied");
  if (fakeApplied.length > 0) {
    console.error("FAIL: result rows with status=applied in demo:", fakeApplied.length);
    process.exit(1);
  }
  console.log("OK: applied=0 (honest demo)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
