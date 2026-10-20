import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LearningEngine, inferStep } from "./engine";
import type { ApplyResult } from "../types";

describe("learning — browser-closed must not skip apply", () => {
  it("inferStep maps closed-browser to browserClosed", () => {
    assert.equal(
      inferStep("browserContext.newPage: Target page, context or browser has been closed"),
      "browserClosed",
    );
    assert.equal(inferStep("BROWSER_CLOSED"), "browserClosed");
    assert.equal(inferStep("linkedin apply timeout"), "timeout");
  });

  it("clears mistaken skipSteps.apply from closed-browser spam", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jobbot-learn-"));
    const kbDir = path.join(dir, "knowledge");
    fs.mkdirSync(kbDir, { recursive: true });
    const closed = "browserContext.newPage: Target page, context or browser has been closed";
    fs.writeFileSync(
      path.join(kbDir, "failures.json"),
      JSON.stringify(
        {
          version: 1,
          updatedAt: new Date().toISOString(),
          sites: {
            indeed: {
              adapterVersion: "1.0.1",
              preferredSelectors: {},
              skipSteps: ["apply"],
              recentFailures: Array.from({ length: 8 }, (_, i) => ({
                id: `f${i}`,
                site: "indeed",
                step: "apply",
                selector: ".newPage: Target page",
                error: closed,
                timestamp: new Date().toISOString(),
                adapterVersion: "1.0.0",
              })),
              recentSuccesses: [],
            },
          },
          failures: [],
        },
        null,
        2,
      ),
      "utf8",
    );

    const engine = new LearningEngine(dir);
    const sk = engine.getSiteKnowledge("indeed");
    assert.ok(!sk.skipSteps.includes("apply"), `skipSteps still has apply: ${sk.skipSteps}`);
  });

  it("recordResults does not add skipSteps for browserClosed", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jobbot-learn-"));
    const engine = new LearningEngine(dir);
    const results: ApplyResult[] = Array.from({ length: 6 }, (_, i) => ({
      job: {
        id: `j${i}`,
        site: "indeed",
        title: `Job ${i}`,
        url: "https://il.indeed.com/",
      },
      status: "failed",
      method: "cv-upload",
      reason: "browserContext.newPage: Target page, context or browser has been closed",
      durationMs: 1,
      confirmed: false,
    }));
    engine.recordResults(results);
    const sk = engine.getSiteKnowledge("indeed");
    assert.ok(!sk.skipSteps.includes("apply"));
    assert.ok(!sk.skipSteps.includes("browserClosed"));
  });
});
