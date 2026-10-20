import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectLinkedInBlocker } from "./linkedin";
import type { Page } from "playwright";

function fakePage(opts: {
  url: string;
  visible?: Record<string, boolean>;
}): Page {
  const visible = opts.visible ?? {};
  return {
    url: () => opts.url,
    locator: (sel: string) => ({
      first: () => ({
        isVisible: async () => {
          for (const [key, val] of Object.entries(visible)) {
            if (sel.includes(key) || sel.toLowerCase().includes(key.toLowerCase())) {
              return val;
            }
          }
          // Multi-selector strings — check each fragment
          if (visible.__any) return true;
          return false;
        },
        click: async () => {
          throw new Error("no click");
        },
      }),
    }),
  } as unknown as Page;
}

describe("LinkedIn blocker detection", () => {
  it("detects login wall from URL", async () => {
    const b = await detectLinkedInBlocker(
      fakePage({ url: "https://www.linkedin.com/login" }),
    );
    assert.equal(b?.kind, "login");
    assert.ok(b?.reasonHe.includes("התחברות"));
  });

  it("detects captcha checkpoint URL", async () => {
    const b = await detectLinkedInBlocker(
      fakePage({ url: "https://www.linkedin.com/checkpoint/challenge/" }),
    );
    assert.equal(b?.kind, "captcha");
  });

  it("returns null on normal job page without walls", async () => {
    const b = await detectLinkedInBlocker(
      fakePage({
        url: "https://www.linkedin.com/jobs/view/123",
        visible: { "Easy Apply": true },
      }),
    );
    assert.equal(b, null);
  });
});
