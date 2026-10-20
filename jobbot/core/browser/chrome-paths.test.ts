import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CHROME_EPERM_MSG_HE,
  chromeSyncErrorHe,
  isChromeEpermError,
  normalizeChromeUserDataDir,
} from "./chrome-paths";
import { normalizeSource } from "./profile-clone";

describe("chrome path normalize", () => {
  it("strips /Default and /Profile N from user-data-dir", () => {
    const root = "/Users/matan_amar/Library/Application Support/Google/Chrome";
    assert.equal(normalizeChromeUserDataDir(`${root}/Default`), root);
    assert.equal(normalizeChromeUserDataDir(`${root}/Default/`), root);
    assert.equal(normalizeChromeUserDataDir(`${root}/Profile 1`), root);
    assert.equal(normalizeChromeUserDataDir(root), root);
  });

  it("normalizeSource keeps profile name when path ends with Default", () => {
    const root = "/tmp/fake-Chrome";
    const { root: r, profile } = normalizeSource(`${root}/Default`);
    assert.equal(r, root);
    assert.equal(profile, "Default");
  });

  it("maps EPERM to Full Disk Access Hebrew steps", () => {
    const err = Object.assign(new Error("EPERM: operation not permitted, opendir '/x/Default'"), {
      code: "EPERM",
    });
    assert.equal(isChromeEpermError(err), true);
    const msg = chromeSyncErrorHe(err, false);
    assert.match(msg, /Full Disk Access/);
    assert.match(msg, /Cmd\+Q/);
    assert.match(msg, /Google\/Chrome/);
    assert.equal(msg, CHROME_EPERM_MSG_HE);
  });

  it("does not dump stack for generic sync failure", () => {
    const msg = chromeSyncErrorHe(new Error("something failed\n    at foo.js:1"), false);
    assert.doesNotMatch(msg, /at foo\.js/);
    assert.match(msg, /סנכרון פרופיל Chrome נכשל/);
  });
});
