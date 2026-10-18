import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CHROME_QUIT_MSG_HE, chromeLaunchErrorHe, isChromeLockError } from "./chrome-lock";

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
});
