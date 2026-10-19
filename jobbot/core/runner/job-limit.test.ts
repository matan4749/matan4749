import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clampJobLimit, STABLE_JOB_LIMIT_PER_SITE } from "./orchestrator";

describe("clampJobLimit", () => {
  it("keeps stable defaults", () => {
    assert.equal(clampJobLimit(5), 5);
    assert.equal(clampJobLimit(3), 3);
    assert.equal(clampJobLimit(10), 10);
  });

  it("migrates Matan's 20 down to stable 5", () => {
    assert.equal(clampJobLimit(20), STABLE_JOB_LIMIT_PER_SITE);
    assert.equal(clampJobLimit(30), STABLE_JOB_LIMIT_PER_SITE);
  });

  it("handles invalid", () => {
    assert.equal(clampJobLimit(0), STABLE_JOB_LIMIT_PER_SITE);
    assert.equal(clampJobLimit(NaN), STABLE_JOB_LIMIT_PER_SITE);
  });
});
