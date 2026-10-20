import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { demoApply, demoJobs } from "./demo";
import { alljobsAdapter } from "./alljobs";
import { drushimAdapter } from "./drushim";
import { elbitAdapter } from "./elbit";
import { iaiAdapter } from "./iai";
import { linkedinAdapter } from "./linkedin";
import { indeedAdapter } from "./indeed";
import { listAdapters } from "./registry";
import { sanitizeApplyResult, isRealApplied } from "./sanitize";
import type { ApplyResult, SiteAdapterContext } from "../types";

function ctx(demo: boolean): SiteAdapterContext {
  return {
    demo,
    timeoutMs: 5000,
    knowledge: {
      adapterVersion: "1.0.0",
      preferredSelectors: {},
      skipSteps: [],
      recentFailures: [],
      recentSuccesses: [],
    },
    log: () => undefined,
    signal: new AbortController().signal,
  };
}

describe("apply reliability — no fake success", () => {
  it("all registered adapters are live (no stubs)", () => {
    for (const a of listAdapters()) {
      assert.equal(a.status, "live", `${a.id} should be live`);
    }
  });

  it("demoApply never returns applied", async () => {
    const jobs = demoJobs("linkedin", { keywords: ["React"], limit: 5 });
    for (const job of jobs) {
      const r = await demoApply(job, ctx(true), "chrome-session");
      assert.notEqual(r.status, "applied");
      assert.equal(r.simulated, true);
      assert.equal(r.confirmed, false);
      assert.ok(r.reason && /הדגמה|לא הוגש/i.test(r.reason));
    }
  });

  it("board/portal adapters demo path never returns applied", async () => {
    const c = ctx(true);
    for (const adapter of [
      alljobsAdapter,
      drushimAdapter,
      elbitAdapter,
      iaiAdapter,
      linkedinAdapter,
      indeedAdapter,
    ]) {
      const jobs = await adapter.search({ keywords: ["TS"], limit: 2 }, c);
      for (const job of jobs) {
        const r = await adapter.apply(job, c);
        assert.notEqual(r.status, "applied", adapter.id);
        assert.equal(isRealApplied(r), false);
      }
    }
  });

  it("sanitize strips fake applied from demo", () => {
    const job = demoJobs("x", { keywords: ["a"], limit: 1 })[0];
    const fake: ApplyResult = {
      job,
      status: "applied",
      method: "chrome-session",
      durationMs: 1,
      confirmed: false,
      simulated: true,
    };
    const scrubbed = sanitizeApplyResult(fake, alljobsAdapter, true);
    assert.notEqual(scrubbed.status, "applied");
    assert.equal(isRealApplied(scrubbed), false);
  });

  it("applied without confirmed becomes unknown", () => {
    const job = demoJobs("linkedin", { keywords: ["a"], limit: 1 })[0];
    const soft: ApplyResult = {
      job,
      status: "applied",
      method: "chrome-session",
      durationMs: 1,
    };
    const scrubbed = sanitizeApplyResult(soft, linkedinAdapter, false);
    assert.equal(scrubbed.status, "unknown");
    assert.equal(isRealApplied(scrubbed), false);
  });

  it("only confirmed non-simulated applied counts as real", () => {
    const job = demoJobs("linkedin", { keywords: ["a"], limit: 1 })[0];
    const real: ApplyResult = {
      job,
      status: "applied",
      method: "chrome-session",
      durationMs: 10,
      confirmed: true,
      simulated: false,
      reason: "אושר במסך",
    };
    assert.equal(isRealApplied(sanitizeApplyResult(real, linkedinAdapter, false)), true);
  });

  it("live adapters still sanitize unconfirmed applied", () => {
    for (const adapter of [alljobsAdapter, drushimAdapter, elbitAdapter, iaiAdapter]) {
      const job = demoJobs(adapter.id, { keywords: ["a"], limit: 1 })[0];
      const soft: ApplyResult = {
        job,
        status: "applied",
        method: "cv-upload",
        durationMs: 1,
        confirmed: false,
      };
      const scrubbed = sanitizeApplyResult(soft, adapter, false);
      assert.equal(scrubbed.status, "unknown", adapter.id);
    }
  });
});
