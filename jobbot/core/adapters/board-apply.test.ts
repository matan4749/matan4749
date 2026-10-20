import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { absoluteUrl, detectSiteWall } from "./board-apply";
import type { Page } from "playwright";

function fakePage(opts: { url: string; body?: string; passwordVisible?: boolean }): Page {
  return {
    url: () => opts.url,
    locator: (sel: string) => ({
      first: () => ({
        isVisible: async () => {
          if (/password|pass/i.test(sel)) return Boolean(opts.passwordVisible);
          if (/captcha/i.test(sel)) return false;
          return false;
        },
      }),
      innerText: async () => opts.body || "",
    }),
  } as unknown as Page;
}

describe("board-apply helpers", () => {
  it("absoluteUrl joins relative paths", () => {
    assert.equal(
      absoluteUrl("/Search/UploadSingle.aspx?JobID=1", "https://www.alljobs.co.il/"),
      "https://www.alljobs.co.il/Search/UploadSingle.aspx?JobID=1",
    );
  });

  it("detects login wall from URL", async () => {
    const w = await detectSiteWall(
      fakePage({ url: "https://www.alljobs.co.il/access.aspx" }),
      "אולג'ובס",
    );
    assert.equal(w?.kind, "login");
    assert.ok(w?.reasonHe.includes("התחברות"));
  });

  it("detects bot wall from body", async () => {
    const w = await detectSiteWall(
      fakePage({
        url: "https://jobs.iai.co.il/jobs",
        body: "Access Denied — kramerica industries",
      }),
      "תע״א",
    );
    assert.equal(w?.kind, "bot");
  });

  it("returns null on normal job page", async () => {
    const w = await detectSiteWall(
      fakePage({
        url: "https://www.drushim.co.il/job/123/abc/",
        body: "Full Stack Developer הגשת מועמדות תיאור המשרה ארוך מאוד ".repeat(20),
      }),
      "דרושים",
    );
    assert.equal(w, null);
  });
});
