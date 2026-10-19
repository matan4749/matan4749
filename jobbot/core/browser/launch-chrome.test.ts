import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromeLaunchErrorHe } from "./chrome-lock";
import {
  CHROME_IGNORE_DEFAULT_ARGS,
  CHROME_LAUNCH_TIMEOUT_HE,
  chromePersistentLaunchOptions,
  findFreePort,
  resolveLaunchUserDataDir,
  scrubOrphanSingletonLocks,
} from "./launch-chrome";

describe("chrome launch options (macOS session-safe)", () => {
  it("enables chromiumSandbox so Playwright does not inject --no-sandbox", () => {
    const opts = chromePersistentLaunchOptions({
      userDataDir: "/Users/matan_amar/Library/Application Support/Google/Chrome",
    });
    assert.equal(opts.chromiumSandbox, true);
    assert.equal(opts.channel, "chrome");
    assert.equal(opts.headless, false);
    assert.ok(opts.timeout <= 60_000);
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

  it("findFreePort returns a usable port", async () => {
    const port = await findFreePort();
    assert.ok(port > 0 && port < 65536);
  });

  it("scrubs orphan SingletonLock files when present", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jobbot-lock-"));
    fs.writeFileSync(path.join(tmp, "SingletonLock"), "x");
    fs.writeFileSync(path.join(tmp, "SingletonCookie"), "y");
    const logs: string[] = [];
    const removed = scrubOrphanSingletonLocks(tmp, (m) => logs.push(m));
    assert.deepEqual(removed.sort(), ["SingletonCookie", "SingletonLock"]);
    assert.equal(fs.existsSync(path.join(tmp, "SingletonLock")), false);
    assert.match(logs.join("\n"), /יתומים/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("maps Playwright timeout to short Hebrew checklist (no Call log dump)", () => {
    const huge = new Error(
      "browserType.launchPersistentContext: Timeout 180000ms exceeded.\nCall log:\n" +
        "  - <launching> /Applications/Google Chrome.app/...\n".repeat(40),
    );
    const msg = chromeLaunchErrorHe(huge);
    assert.match(msg, /timeout/i);
    assert.match(msg, /Cmd\+Q|Activity Monitor|Full Disk Access|SingletonLock/);
    assert.doesNotMatch(msg, /Call log/);
    assert.ok(msg.length < 800);
    assert.match(CHROME_LAUNCH_TIMEOUT_HE, /Activity Monitor/);
  });
});
