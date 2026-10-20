import { DEFAULT_LLM, emptyPlan, type LlmSettings, type RunPlan } from "./types";
import { parseHebrewIntent } from "./parse-intent";

const SYSTEM_HE = `אתה עוזר Jobbot בעברית. המשתמש מתכנן חיפוש והגשת משרות מקומי.
החזר JSON בלבד (בלי markdown) במבנה:
{"replyHe":"תשובה קצרה בעברית","plan":{"searchMode":"cv"|"keywords","keywords":["..."],"enabledSites":["linkedin","indeed","alljobs","drushim","elbit","iai"],"location":"Israel","jobLimitPerSite":5,"applyMode":"apply"|"search-only","confirmed":false}}
אתרים מותרים בלבד: linkedin, indeed, alljobs, drushim, elbit, iai.
אם המשתמש מאשר תוכנית — confirmed:true.
אל תמציא הגשות שבוצעו.`;

function resolveLlm(partial?: Partial<LlmSettings>): LlmSettings {
  return {
    apiKey:
      (partial?.apiKey || "").trim() ||
      (process.env.JOBBOT_LLM_API_KEY || "").trim() ||
      (process.env.OPENAI_API_KEY || "").trim(),
    baseUrl:
      (partial?.baseUrl || "").trim() ||
      (process.env.JOBBOT_LLM_BASE_URL || "").trim() ||
      DEFAULT_LLM.baseUrl,
    model:
      (partial?.model || "").trim() ||
      (process.env.JOBBOT_LLM_MODEL || "").trim() ||
      DEFAULT_LLM.model,
  };
}

export function llmConfigured(partial?: Partial<LlmSettings>): boolean {
  return Boolean(resolveLlm(partial).apiKey);
}

function sanitizePlan(raw: unknown, fallback: RunPlan): RunPlan {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const allowed = new Set(["linkedin", "indeed", "alljobs", "drushim", "elbit", "iai"]);
  const sites = Array.isArray(o.enabledSites)
    ? (o.enabledSites as unknown[]).map(String).filter((s) => allowed.has(s))
    : fallback.enabledSites;
  const keywords = Array.isArray(o.keywords)
    ? (o.keywords as unknown[]).map(String).map((s) => s.trim()).filter(Boolean).slice(0, 16)
    : fallback.keywords;
  const limit = Number(o.jobLimitPerSite);
  return emptyPlan({
    ...fallback,
    searchMode: o.searchMode === "cv" ? "cv" : "keywords",
    keywords: keywords.length ? keywords : fallback.keywords,
    enabledSites: sites.length ? sites : fallback.enabledSites,
    location: typeof o.location === "string" && o.location.trim() ? o.location.trim() : fallback.location,
    jobLimitPerSite: Number.isFinite(limit) && limit >= 1 ? Math.min(30, Math.floor(limit)) : fallback.jobLimitPerSite,
    applyMode: o.applyMode === "search-only" ? "search-only" : "apply",
    confirmed: Boolean(o.confirmed),
    summaryHe: "",
  });
}

function summarize(plan: RunPlan): string {
  const mode = plan.searchMode === "cv" ? "מקו״ח" : "מילות מפתח";
  const apply = plan.applyMode === "search-only" ? "חיפוש בלבד" : "חיפוש + הגשה";
  return `מצב: ${mode} · אתרים: ${plan.enabledSites.join(", ")} · מילות: ${plan.keywords.slice(0, 6).join(", ")} · עד ${plan.jobLimitPerSite} · ${apply} · ${plan.location}`;
}

export async function chatWithLlm(opts: {
  userText: string;
  history: { role: "user" | "assistant"; content: string }[];
  currentPlan: RunPlan | null;
  llm?: Partial<LlmSettings>;
}): Promise<{ replyHe: string; plan: RunPlan } | null> {
  const cfg = resolveLlm(opts.llm);
  if (!cfg.apiKey) return null;

  const base = opts.currentPlan ?? emptyPlan();
  const url = `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;

  const body = {
    model: cfg.model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_HE },
      {
        role: "system",
        content: `תוכנית נוכחית: ${JSON.stringify(base)}`,
      },
      ...opts.history.slice(-8),
      { role: "user", content: opts.userText },
    ],
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`LLM HTTP ${res.status}: ${t.slice(0, 160)}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content) as { replyHe?: string; plan?: unknown };
    const plan = sanitizePlan(parsed.plan, base);
    plan.summaryHe = summarize(plan);
    const replyHe =
      (parsed.replyHe || "").trim() ||
      `עדכנתי תוכנית:\n${plan.summaryHe}`;
    return { replyHe, plan };
  } catch {
    // Caller falls back to rules
    return null;
  }
}

/** Prefer LLM when keyed; otherwise / on failure use Hebrew rules */
export async function resolveAssistantTurn(opts: {
  userText: string;
  history: { role: "user" | "assistant"; content: string }[];
  currentPlan: RunPlan | null;
  defaultKeywords?: string[];
  defaultSites?: string[];
  llm?: Partial<LlmSettings>;
}): Promise<{ replyHe: string; plan: RunPlan; backend: "llm" | "rules" }> {
  if (llmConfigured(opts.llm)) {
    const llmResult = await chatWithLlm(opts);
    if (llmResult) {
      return { ...llmResult, backend: "llm" };
    }
  }
  const rules = parseHebrewIntent(opts.userText, {
    current: opts.currentPlan,
    defaultKeywords: opts.defaultKeywords,
    defaultSites: opts.defaultSites,
  });
  return { replyHe: rules.replyHe, plan: rules.plan, backend: "rules" };
}
