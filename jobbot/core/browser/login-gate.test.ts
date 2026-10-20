import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  shouldSkipLoginGate,
  sitesNeedingLogin,
  verifyCookiesPersisted,
  COOKIES_NOT_SAVED_HE,
  type LoginGateSiteStatus,
} from "./login-gate";
import { clearJobbotBrowserProfile, jobbotBrowserProfileRoot } from "./jobbot-profile";

describe("login gate skip-if-logged-in", () => {
  it("skips when LinkedIn is logged in", () => {
    const statuses: LoginGateSiteStatus[] = [
      { id: "linkedin", displayNameHe: "לינקדאין", url: "https://www.linkedin.com/feed/", loggedIn: true },
      { id: "indeed", displayNameHe: "אינדיד", url: "https://il.indeed.com/", loggedIn: null },
    ];
    assert.equal(shouldSkipLoginGate(statuses, ["linkedin", "indeed"]), true);
  });

  it("shows gate when LinkedIn is on login wall", () => {
    const statuses: LoginGateSiteStatus[] = [
      {
        id: "linkedin",
        displayNameHe: "לינקדאין",
        url: "https://www.linkedin.com/login",
        loggedIn: false,
      },
    ];
    assert.equal(shouldSkipLoginGate(statuses, ["linkedin"]), false);
  });

  it("shows gate when LinkedIn status unknown", () => {
    const statuses: LoginGateSiteStatus[] = [
      {
        id: "linkedin",
        displayNameHe: "לינקדאין",
        url: "https://www.linkedin.com/",
        loggedIn: null,
      },
    ];
    assert.equal(shouldSkipLoginGate(statuses, ["linkedin"]), false);
  });

  it("empty profile (no cookies) fails verifyCookiesPersisted", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jobbot-empty-"));
    const root = jobbotBrowserProfileRoot(tmp);
    fs.mkdirSync(path.join(root, "Default"), { recursive: true });
    const check = verifyCookiesPersisted(root, "Default");
    assert.equal(check.ok, false);
    assert.ok(check.messageHe.includes("Cookies") || check.messageHe === COOKIES_NOT_SAVED_HE);
  });

  it("profile with Cookies file passes verify", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jobbot-cookies-"));
    const root = jobbotBrowserProfileRoot(tmp);
    const def = path.join(root, "Default");
    fs.mkdirSync(def, { recursive: true });
    fs.writeFileSync(path.join(def, "Cookies"), Buffer.alloc(256, 1));
    fs.writeFileSync(path.join(def, "Preferences"), "{}");
    const check = verifyCookiesPersisted(root, "Default");
    assert.equal(check.ok, true);
    assert.ok(check.cookiesBytes >= 64);
  });

  it("clearJobbotBrowserProfile wipes only on explicit call", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jobbot-clear-"));
    const root = jobbotBrowserProfileRoot(tmp);
    const marker = path.join(root, "Default", "Cookies");
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, Buffer.alloc(128, 2));
    assert.ok(fs.existsSync(marker));
    const r = clearJobbotBrowserProfile(tmp);
    assert.equal(r.ok, true);
    assert.ok(!fs.existsSync(marker));
    // Root recreated empty — never auto-cleared by jobbotBrowserProfileRoot alone
    const again = jobbotBrowserProfileRoot(tmp);
    assert.equal(again, root);
  });

  it("sitesNeedingLogin filters logged-in", () => {
    const statuses: LoginGateSiteStatus[] = [
      { id: "linkedin", displayNameHe: "לינקדאין", url: "u", loggedIn: true },
      { id: "indeed", displayNameHe: "אינדיד", url: "u", loggedIn: false },
      { id: "alljobs", displayNameHe: "אולג'ובס", url: "u", loggedIn: null },
    ];
    const need = sitesNeedingLogin(statuses);
    assert.deepEqual(
      need.map((s) => s.id),
      ["indeed", "alljobs"],
    );
  });
});
