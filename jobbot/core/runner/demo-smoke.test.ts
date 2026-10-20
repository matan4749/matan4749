import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { JobRunner } from "./orchestrator";
import { DEFAULT_SETTINGS } from "../types";
import { isRealApplied } from "../adapters/sanitize";

describe("demo / honest-run smoke", () => {
  it("demo pipeline reports applied: 0 and no real applies", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "jobbot-demo-"));
    fs.mkdirSync(path.join(dataDir, "knowledge"), { recursive: true });
    fs.mkdirSync(path.join(dataDir, "runs"), { recursive: true });
    fs.mkdirSync(path.join(dataDir, "outbox"), { recursive: true });

    const runner = new JobRunner(dataDir, { demo: true, allowDemo: true });
    const result = await runner.run(
      {
        ...DEFAULT_SETTINGS,
        chromeUserDataDir: "", // empty — must still run in demo, not block
        sendEmailAfterRun: false,
        reportEmail: "matan4749@gmail.com",
        enabledSites: ["linkedin", "indeed", "alljobs", "drushim", "elbit", "iai"],
      },
      {
        searchMode: "keywords",
        keywords: ["React", "TypeScript"],
        enabledSites: ["linkedin", "indeed", "alljobs", "drushim", "elbit", "iai"],
        location: "Israel",
        jobLimitPerSite: 2,
        perJobTimeoutMs: 10000,
        perSiteTimeoutMs: 20000,
        maxRetries: 0,
      },
    );

    assert.equal(result.progress.applied, 0, "demo must never count real applies");
    assert.ok(result.progress.found >= 0);
    for (const r of result.progress.results) {
      assert.equal(isRealApplied(r), false, `${r.job.site}: ${r.status}`);
      assert.notEqual(r.status, "applied");
    }
    assert.match(result.reportHtml, /לא הוגשה|0|אמיתית|הדגמה|לא הוגש/i);
    assert.ok(
      result.progress.phase === "done" || result.progress.phase === "stopped",
      `phase=${result.progress.phase}`,
    );

    // Live mode without system Chrome path → early Hebrew error (jobbot mode needs no path)
    const blocker = new JobRunner(dataDir, { demo: false, allowDemo: false });
    const blocked = await blocker.run(
      {
        ...DEFAULT_SETTINGS,
        browserMode: "live",
        chromeUserDataDir: "",
        sendEmailAfterRun: false,
      },
      {
        searchMode: "keywords",
        keywords: ["React"],
        enabledSites: ["linkedin"],
        location: "Israel",
        jobLimitPerSite: 1,
        perJobTimeoutMs: 5000,
        perSiteTimeoutMs: 10000,
        maxRetries: 0,
      },
    );
    assert.equal(blocked.progress.applied, 0);
    assert.equal(blocked.progress.phase, "error");
    assert.equal(blocked.email.error, "CHROME_PROFILE_REQUIRED");
    assert.ok(
      blocked.progress.logs.some((l) => /Chrome|מערכת|נתיב/i.test(l.message)),
      "expected Hebrew chrome blocker log",
    );

    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});
