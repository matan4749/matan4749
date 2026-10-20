import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  defaultApplicant,
  planApplySteps,
  signalsFromDomHints,
  type PageApplySignals,
} from "./form-fill";
import { iaiApplicationUrl } from "./iai";
import type { JobListing, SiteAdapterContext } from "../types";

function baseSignals(over: Partial<PageApplySignals> = {}): PageApplySignals {
  return {
    siteId: "iai",
    hasLoginWall: false,
    hasBotWall: false,
    hasApplyButton: true,
    hasFileInput: true,
    hasTextFields: true,
    ...over,
  };
}

describe("planApplySteps — site fixtures", () => {
  it("IAI: fill fields + upload CV + submit (no fake easy-apply skip)", () => {
    const steps = planApplySteps(
      baseSignals({
        siteId: "iai",
        hasApplyButton: true,
        hasFileInput: true,
        hasTextFields: true,
      }),
    );
    assert.deepEqual(steps, ["click-apply", "fill-fields", "upload-cv", "submit", "confirm"]);
  });

  it("IAI bot-wall: stop before upload", () => {
    const steps = planApplySteps(
      baseSignals({ siteId: "iai", hasBotWall: true, hasFileInput: true }),
    );
    assert.deepEqual(steps, ["bot-wall"]);
  });

  it("AllJobs login-wall: stop before apply", () => {
    const steps = planApplySteps(
      baseSignals({ siteId: "alljobs", hasLoginWall: true, hasApplyButton: true }),
    );
    assert.deepEqual(steps, ["login-wall"]);
  });

  it("AllJobs: apply + upload when file input present", () => {
    const steps = planApplySteps(
      baseSignals({
        siteId: "alljobs",
        hasApplyButton: true,
        hasFileInput: true,
        hasTextFields: false,
      }),
    );
    assert.ok(steps.includes("click-apply"));
    assert.ok(steps.includes("upload-cv"));
    assert.ok(steps.includes("confirm"));
    assert.ok(!steps.includes("login-wall"));
  });

  it("Drushim: upload-cv even if file input not yet in DOM (site policy)", () => {
    const steps = planApplySteps(
      baseSignals({
        siteId: "drushim",
        hasApplyButton: true,
        hasFileInput: false,
        hasTextFields: true,
      }),
    );
    assert.ok(steps.includes("upload-cv"), "drushim always plans CV upload");
    assert.ok(steps.includes("fill-fields"));
  });

  it("Elbit: upload + fields on Hunter-style form", () => {
    const steps = planApplySteps(
      baseSignals({
        siteId: "elbit",
        hasApplyButton: true,
        hasFileInput: true,
        hasTextFields: true,
      }),
    );
    assert.deepEqual(steps, ["click-apply", "fill-fields", "upload-cv", "submit", "confirm"]);
  });

  it("Indeed: plans upload-cv (Easy Apply / resume step)", () => {
    const steps = planApplySteps(
      baseSignals({
        siteId: "indeed",
        hasApplyButton: true,
        hasFileInput: false,
        hasTextFields: true,
      }),
    );
    assert.ok(steps.includes("click-apply"));
    assert.ok(steps.includes("upload-cv"));
    assert.ok(steps.includes("confirm"));
  });

  it("bot-wall wins over login-wall", () => {
    const steps = planApplySteps(
      baseSignals({ hasBotWall: true, hasLoginWall: true, siteId: "iai" }),
    );
    assert.deepEqual(steps, ["bot-wall"]);
  });
});

describe("signalsFromDomHints — fixtures from public HTML", () => {
  it("maps AllJobs upload page", () => {
    const s = signalsFromDomHints({
      siteId: "alljobs",
      url: "https://www.alljobs.co.il/Search/UploadSingle.aspx?JobID=123",
      bodySnippet: '<input id="inp_UploadCvFile" type="file" /> הגשת מועמדות',
      hasFileInput: true,
      hasApplyText: true,
    });
    assert.equal(s.hasFileInput, true);
    assert.equal(s.hasApplyButton, true);
    assert.equal(s.hasLoginWall, false);
    const steps = planApplySteps(s);
    assert.ok(steps.includes("upload-cv"));
  });

  it("maps Drushim job details apply button", () => {
    const s = signalsFromDomHints({
      siteId: "drushim",
      url: "https://www.drushim.co.il/job/123/abc/",
      bodySnippet: 'data-nagish="job-details-apply-button" הגשה שם מייל',
      hasApplyText: true,
      hasFileInput: false,
    });
    assert.equal(s.hasApplyButton, true);
    assert.ok(planApplySteps(s).includes("upload-cv"));
  });

  it("maps IAI kramerica bot wall", () => {
    const s = signalsFromDomHints({
      siteId: "iai",
      url: "https://jobs.iai.co.il/jobs",
      bodySnippet: "Access Denied — kramerica industries bot detection",
      hasApplyText: false,
    });
    assert.equal(s.hasBotWall, true);
    assert.deepEqual(planApplySteps(s), ["bot-wall"]);
  });

  it("maps Elbit Hunter ContactForm cvfile", () => {
    const s = signalsFromDomHints({
      siteId: "elbit",
      url: "https://elbitlead.hunterhrms.com/contact",
      bodySnippet: 'ContactForm[cvfile] ContactForm[name] ContactForm[email]',
      hasFileInput: true,
      hasApplyText: true,
    });
    assert.equal(s.hasTextFields, true);
    assert.ok(planApplySteps(s).includes("fill-fields"));
    assert.ok(planApplySteps(s).includes("upload-cv"));
  });

  it("maps Indeed login wall", () => {
    const s = signalsFromDomHints({
      siteId: "indeed",
      url: "https://secure.indeed.com/auth?continue=…",
      bodySnippet: "Sign in password",
      hasPassword: true,
      hasApplyText: false,
    });
    // URL has no /login path — rely on password + sign-in body
    assert.equal(s.hasLoginWall, true);
    assert.deepEqual(planApplySteps(s), ["login-wall"]);
  });
});

describe("IAI application URL + applicant defaults", () => {
  it("iaiApplicationUrl prefers /application/{id}/", () => {
    const job: JobListing = {
      id: "iai-991122",
      site: "iai",
      title: "מהנדס תוכנה",
      company: "IAI",
      url: "https://jobs.iai.co.il/application/991122/?q=1",
    };
    assert.equal(iaiApplicationUrl(job), "https://jobs.iai.co.il/application/991122/");
  });

  it("iaiApplicationUrl extracts numeric id from query string", () => {
    const job: JobListing = {
      id: "iai-x",
      site: "iai",
      title: "x",
      url: "https://jobs.iai.co.il/jobs?jobId=778899",
    };
    assert.equal(iaiApplicationUrl(job), "https://jobs.iai.co.il/application/778899/");
  });

  it("defaultApplicant seeds Matan profile", () => {
    const ctx = {
      demo: true,
      timeoutMs: 1,
      knowledge: {
        adapterVersion: "1",
        preferredSelectors: {},
        skipSteps: [],
        recentFailures: [],
        recentSuccesses: [],
      },
      log: () => undefined,
      signal: new AbortController().signal,
    } as SiteAdapterContext;
    const a = defaultApplicant(ctx);
    assert.equal(a.fullNameHe, "מתן עמר");
    assert.equal(a.email, "matan4749@gmail.com");
  });
});
