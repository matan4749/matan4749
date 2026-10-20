import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseHebrewIntent } from "./parse-intent";
import { emptyPlan } from "./types";

describe("Hebrew chat intent → run plan", () => {
  it("parses LinkedIn React search with limit", () => {
    const { plan, matched } = parseHebrewIntent("חפש React בלינקדאין עד 5 משרות");
    assert.equal(matched, true);
    assert.equal(plan.searchMode, "keywords");
    assert.ok(plan.keywords.some((k) => /react/i.test(k)));
    assert.deepEqual(plan.enabledSites, ["linkedin"]);
    assert.equal(plan.jobLimitPerSite, 5);
    assert.equal(plan.applyMode, "apply");
    assert.equal(plan.confirmed, false);
  });

  it("parses CV mode and search-only", () => {
    const { plan } = parseHebrewIntent("חפש לפי קו״ח — רק חיפוש בלי להגיש");
    assert.equal(plan.searchMode, "cv");
    assert.equal(plan.applyMode, "search-only");
  });

  it("confirm marks plan confirmed", () => {
    const current = emptyPlan({
      keywords: ["TypeScript"],
      enabledSites: ["indeed"],
      jobLimitPerSite: 3,
    });
    const { plan, replyHe } = parseHebrewIntent("אשר", { current });
    assert.equal(plan.confirmed, true);
    assert.match(replyHe, /מאושר|הפעל/);
    assert.deepEqual(plan.enabledSites, ["indeed"]);
  });

  it("adds keywords and multiple sites", () => {
    const current = emptyPlan({ keywords: ["React"], enabledSites: ["linkedin"] });
    const { plan } = parseHebrewIntent("הוסף TypeScript, לינקדאין ואינדיד", { current });
    assert.ok(plan.keywords.some((k) => /typescript/i.test(k)));
    assert.ok(plan.enabledSites.includes("linkedin"));
    assert.ok(plan.enabledSites.includes("indeed"));
  });
});
