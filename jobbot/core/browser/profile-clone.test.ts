import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureJobbotChromeProfile, normalizeSource, shouldCopyPath } from "./profile-clone";

describe("chrome profile clone", () => {
  it("skips SingletonLock / Cookie / Socket and heavy Cache dirs", () => {
    assert.equal(shouldCopyPath("/x/SingletonLock"), false);
    assert.equal(shouldCopyPath("/x/SingletonCookie"), false);
    assert.equal(shouldCopyPath("/x/SingletonSocket"), false);
    assert.equal(shouldCopyPath("/x/Default/Cache"), false);
    assert.equal(shouldCopyPath("/x/Default/Code Cache"), false);
    assert.equal(shouldCopyPath("/x/Default/Cookies"), true);
    assert.equal(shouldCopyPath("/x/Local State"), true);
  });

  it("clones Default without lock files (no real Chrome needed)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jobbot-clone-"));
    const source = path.join(tmp, "Chrome");
    const cloneRoot = path.join(tmp, "chrome-clone");
    fs.mkdirSync(path.join(source, "Default", "Cache"), { recursive: true });
    fs.writeFileSync(path.join(source, "Local State"), "{}");
    fs.writeFileSync(path.join(source, "SingletonLock"), "LOCK");
    fs.writeFileSync(path.join(source, "SingletonCookie"), "COOKIE");
    fs.writeFileSync(path.join(source, "SingletonSocket"), "SOCK");
    fs.writeFileSync(
      path.join(source, "Default", "Cookies"),
      Buffer.alloc(128, 1), // session gate requires cookies ≥ 64 bytes
    );
    fs.writeFileSync(path.join(source, "Default", "Preferences"), "{}");
    fs.writeFileSync(path.join(source, "Default", "Login Data"), Buffer.alloc(64, 2));
    fs.writeFileSync(path.join(source, "Default", "Cache", "big"), "heavy");

    const result = await ensureJobbotChromeProfile({
      sourceUserDataDir: source,
      cloneRoot,
      force: true,
    });

    assert.equal(result.path, cloneRoot);
    assert.equal(result.synced, true);
    assert.ok(fs.existsSync(path.join(cloneRoot, "Default", "Cookies")));
    assert.ok(fs.existsSync(path.join(cloneRoot, "Local State")));
    assert.equal(fs.existsSync(path.join(cloneRoot, "SingletonLock")), false);
    assert.equal(fs.existsSync(path.join(cloneRoot, "SingletonCookie")), false);
    assert.equal(fs.existsSync(path.join(cloneRoot, "SingletonSocket")), false);
    assert.equal(fs.existsSync(path.join(cloneRoot, "Default", "Cache")), false);

    // Second call without force should skip full resync when cookies unchanged
    const again = await ensureJobbotChromeProfile({
      sourceUserDataDir: source,
      cloneRoot,
    });
    assert.equal(again.synced, false);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("accepts source path ending in /Default (uses parent as user-data-dir)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jobbot-clone-def-"));
    const source = path.join(tmp, "Chrome");
    const cloneRoot = path.join(tmp, "chrome-clone");
    fs.mkdirSync(path.join(source, "Default"), { recursive: true });
    fs.writeFileSync(path.join(source, "Local State"), "{}");
    fs.writeFileSync(path.join(source, "Default", "Cookies"), Buffer.alloc(128, 1));
    fs.writeFileSync(path.join(source, "Default", "Preferences"), "{}");
    fs.writeFileSync(path.join(source, "Default", "Login Data"), Buffer.alloc(64, 2));

    const { root, profile } = normalizeSource(path.join(source, "Default"));
    assert.equal(root, source);
    assert.equal(profile, "Default");

    const result = await ensureJobbotChromeProfile({
      sourceUserDataDir: path.join(source, "Default"),
      cloneRoot,
      force: true,
    });
    assert.equal(result.sourcePath, source);
    assert.ok(fs.existsSync(path.join(cloneRoot, "Default", "Cookies")));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
