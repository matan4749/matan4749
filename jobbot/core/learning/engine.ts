import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ApplyResult,
  FailureRecord,
  SiteKnowledge,
  SuccessHint,
} from "../types";

export interface KnowledgeBase {
  version: number;
  updatedAt: string;
  sites: Record<string, SiteKnowledge>;
  failures: FailureRecord[];
}

const DEFAULT_ADAPTER_VERSION = "1.0.0";

function emptySiteKnowledge(): SiteKnowledge {
  return {
    adapterVersion: DEFAULT_ADAPTER_VERSION,
    preferredSelectors: {},
    skipSteps: [],
    recentFailures: [],
    recentSuccesses: [],
  };
}

export class LearningEngine {
  private kbPath: string;
  private kb: KnowledgeBase;

  constructor(dataDir: string) {
    this.kbPath = path.join(dataDir, "knowledge", "failures.json");
    this.kb = this.load();
  }

  getSiteKnowledge(site: string): SiteKnowledge {
    if (!this.kb.sites[site]) {
      this.kb.sites[site] = emptySiteKnowledge();
    }
    return structuredClone(this.kb.sites[site]);
  }

  recordResults(results: ApplyResult[]): void {
    for (const r of results) {
      const site = r.job.site;
      const sk = this.kb.sites[site] ?? emptySiteKnowledge();

      if (r.status === "failed") {
        const step = inferStep(r.reason);
        const selector = extractSelector(r.reason);
        const failure: FailureRecord = {
          id: randomUUID(),
          site,
          step,
          selector,
          error: r.reason || "unknown",
          timestamp: new Date().toISOString(),
          adapterVersion: sk.adapterVersion,
        };
        this.kb.failures.unshift(failure);
        sk.recentFailures = [failure, ...sk.recentFailures].slice(0, 50);

        // Heuristic: repeated same selector failure → deprioritize / skip
        const same = sk.recentFailures.filter(
          (f) => f.step === step && f.selector && f.selector === selector,
        ).length;
        if (selector && same >= 3) {
          for (const key of Object.keys(sk.preferredSelectors)) {
            sk.preferredSelectors[key] = sk.preferredSelectors[key].filter((s) => s !== selector);
          }
        }
        if (same >= 5 && !sk.skipSteps.includes(step)) {
          sk.skipSteps.push(step);
        }
      } else if (r.status === "applied" && r.confirmed && !r.simulated) {
        const hint: SuccessHint = {
          site,
          step: "apply",
          timestamp: new Date().toISOString(),
        };
        sk.recentSuccesses = [hint, ...sk.recentSuccesses].slice(0, 30);
      }

      this.kb.sites[site] = sk;
    }

    // Cap global failures
    this.kb.failures = this.kb.failures.slice(0, 500);
    this.kb.updatedAt = new Date().toISOString();
    this.save();
  }

  /** Post-run analysis: bump adapter version when many new failures of same type */
  analyze(): { bumped: string[]; notes: string[] } {
    const bumped: string[] = [];
    const notes: string[] = [];

    for (const [site, sk] of Object.entries(this.kb.sites)) {
      const recent = sk.recentFailures.slice(0, 10);
      if (recent.length >= 5) {
        const next = bumpPatch(sk.adapterVersion);
        sk.adapterVersion = next;
        bumped.push(site);
        notes.push(`${site}: adapterVersion → ${next} אחרי ${recent.length} כישלונות אחרונים`);
      }

      // Promote selectors mentioned in older successes that still appear in preferred list gaps
      if (sk.skipSteps.length) {
        notes.push(`${site}: דילוג על שלבים שבורים: ${sk.skipSteps.join(", ")}`);
      }
    }

    this.kb.updatedAt = new Date().toISOString();
    this.save();
    return { bumped, notes };
  }

  preferSelector(site: string, key: string, selector: string): void {
    const sk = this.kb.sites[site] ?? emptySiteKnowledge();
    const list = sk.preferredSelectors[key] ?? [];
    sk.preferredSelectors[key] = [selector, ...list.filter((s) => s !== selector)].slice(0, 8);
    this.kb.sites[site] = sk;
    this.save();
  }

  snapshot(): KnowledgeBase {
    return structuredClone(this.kb);
  }

  private load(): KnowledgeBase {
    try {
      if (fs.existsSync(this.kbPath)) {
        const raw = fs.readFileSync(this.kbPath, "utf8");
        return JSON.parse(raw) as KnowledgeBase;
      }
    } catch {
      /* fresh */
    }
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      sites: {},
      failures: [],
    };
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.kbPath), { recursive: true });
    fs.writeFileSync(this.kbPath, JSON.stringify(this.kb, null, 2), "utf8");
  }
}

function inferStep(reason?: string): string {
  if (!reason) return "unknown";
  const r = reason.toLowerCase();
  if (r.includes("selector") || r.includes("not found") || r.includes("clickable")) return "selector";
  if (r.includes("cv") || r.includes("upload") || r.includes("file")) return "cvUpload";
  if (r.includes("timeout") || r.includes("navigation")) return "timeout";
  if (r.includes("easyapply")) return "easyApplyClick";
  if (r.includes("stub")) return "stub";
  return "apply";
}

function extractSelector(reason?: string): string | undefined {
  if (!reason) return undefined;
  const m = reason.match(/matched:\s*(.+)$/i) || reason.match(/([.#\[][\w\-="'[\] .#>:+~]+)/);
  return m?.[1]?.trim().slice(0, 120);
}

function bumpPatch(v: string): string {
  const parts = v.split(".").map((n) => Number(n) || 0);
  while (parts.length < 3) parts.push(0);
  parts[2] += 1;
  return parts.join(".");
}
