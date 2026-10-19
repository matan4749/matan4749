import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CHROME_IGNORE_DEFAULT_ARGS,
  chromePersistentLaunchOptions,
  resolveLaunchUserDataDir,
} from "./launch-chrome";

describe("chrome launch options (macOS session-safe)", () => {
  it("enables chromiumSandbox so Playwright does not inject --no-sandbox", () => {
    const opts = chromePersistentLaunchOptions({
      userDataDir: "/Users/matan_amar/Library/Application Support/Google/Chrome",
    });
    assert.equal(opts.chromiumSandbox, true);
    assert.equal(opts.channel, "chrome");
    assert.equal(opts.headless, false);
    assert.ok(opts.args.some((a: string) => a.startsWith("--profile-directory=")));
    assert.ok(!opts.args.includes("--no-sandbox"));
  });

  it("ignores mock-keychain / basic password-store / disable-sync", () => {
    const opts = chromePersistentLaunchOptions({
      userDataDir: "/Users/matan_amar/Library/Application Support/Google/Chrome",
      profileDirectory: "Default",
    });
    for (const flag of CHROME_IGNORE_DEFAULT_ARGS) {
      assert.ok(
        (opts.ignoreDefaultArgs as string[]).includes(flag),
        `missing ignore: ${flag}`,
      );
    }
  });

  it("live mode resolves to real user-data-dir, never clone", () => {
    const live = resolveLaunchUserDataDir({
      chromeUserDataDir: "/Users/matan_amar/Library/Application Support/Google/Chrome",
      jobbotChromeProfileDir: "/tmp/jobbot-data/chrome-clone",
      useChromeClone: false,
    });
    assert.equal(live, "/Users/matan_amar/Library/Application Support/Google/Chrome");

    const clone = resolveLaunchUserDataDir({
      chromeUserDataDir: "/Users/matan_amar/Library/Application Support/Google/Chrome",
      jobbotChromeProfileDir: "/tmp/jobbot-data/chrome-clone",
      useChromeClone: true,
    });
    assert.equal(clone, "/tmp/jobbot-data/chrome-clone");
  });
});
