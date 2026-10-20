import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CHROME_CLOSED_OK_HE,
  CHROME_QUIT_MSG_HE,
  CHROME_STILL_OPEN_HE,
  checkChromeClosed,
  chromeLaunchErrorHe,
  chromeUserDataRoot,
  hasProfileSingletonLock,
  isChromeLockError,
} from "./chrome-lock";

describe("chrome lock detection", () => {
  it("detects SingletonLock / existing session messages", () => {
    assert.equal(isChromeLockError(new Error("SingletonLock")), true);
    assert.equal(
      isChromeLockError(new Error("user data directory is already in use")),
      true,
    );
    assert.equal(
      isChromeLockError(new Error("פתיחה בסשן קיים של הדפדפן")),
      true,
    );
    assert.equal(
      isChromeLockError(new Error("Target page, context or browser has been closed")),
      true,
    );
    assert.equal(isChromeLockError(new Error("timeout waiting for selector")), false);
  });

  it("returns Hebrew quit message for lock errors", () => {
    const msg = chromeLaunchErrorHe(new Error("opening in an existing browser session"));
    assert.equal(msg, CHROME_QUIT_MSG_HE);
    assert.match(msg, /Cmd\+Q/);
  });

  it("detects SingletonLock under user-data-dir", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jobbot-lock-"));
    const root = path.join(tmp, "Chrome");
    fs.mkdirSync(path.join(root, "Default"), { recursive: true });
    assert.equal(hasProfileSingletonLock(root), false);
    fs.writeFileSync(path.join(root, "SingletonLock"), "x");
    assert.equal(hasProfileSingletonLock(root), true);
    assert.equal(hasProfileSingletonLock(path.join(root, "Default")), true);
    assert.equal(chromeUserDataRoot(path.join(root, "Default")), root);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("checkChromeClosed returns Hebrew OK or still-open (no stack)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jobbot-preflight-"));
    const root = path.join(tmp, "Chrome");
    fs.mkdirSync(path.join(root, "Default"), { recursive: true });

    const unlocked = await checkChromeClosed(root);
    // Process may or may not be running on CI — if not running and no lock → OK
    if (!unlocked.chromeRunning) {
      assert.equal(unlocked.ok, true);
      assert.equal(unlocked.messageHe, CHROME_CLOSED_OK_HE);
    } else {
      assert.equal(unlocked.ok, false);
      assert.match(unlocked.messageHe, /Cmd\+Q|פתוח/);
      assert.ok(!/at Object\.|Error:|stack/i.test(unlocked.messageHe));
    }

    fs.writeFileSync(path.join(root, "SingletonLock"), "lock");
    const locked = await checkChromeClosed(root);
    assert.equal(locked.ok, false);
    assert.equal(locked.profileLocked, true);
    assert.match(locked.messageHe, /Cmd\+Q|נעילה|פתוח/);
    assert.ok(locked.messageHe.includes(CHROME_STILL_OPEN_HE.split("—")[0].trim()) || /Cmd\+Q/.test(locked.messageHe));

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
