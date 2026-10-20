import { emptyPlan, SITE_ALIASES, type RunPlan } from "./types";

export interface ParseContext {
  current?: RunPlan | null;
  defaultKeywords?: string[];
  defaultSites?: string[];
}

/** Extract numbers like "10 משרות" / "מקסימום 3" */
function extractLimit(text: string, fallback: number): number | null {
  const m =
    text.match(/(?:מקסימום|עד|limit|max)?\s*(\d{1,2})\s*(?:משרות|jobs|לאתר)?/i) ||
    text.match(/(\d{1,2})\s*משרות/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(30, n);
}

function resolveSites(text: string): string[] | null {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const [id, aliases] of Object.entries(SITE_ALIASES)) {
    if (aliases.some((a) => lower.includes(a.toLowerCase()))) found.push(id);
  }
  if (/כל האתרים|הכל|all sites/i.test(text)) {
    return Object.keys(SITE_ALIASES);
  }
  if (/רק לינקדאין|רק linkedin/i.test(text)) return ["linkedin"];
  if (/רק אינדיד|רק indeed/i.test(text)) return ["indeed"];
  return found.length ? [...new Set(found)] : null;
}

function extractKeywords(text: string, current: string[]): string[] | null {
  // Explicit list after "מילות מפתח:" / "חפש:"
  const labeled = text.match(
    /(?:מילות?\s*מפתח|חפש|keywords?|תחפש)\s*[:：]?\s*(.+)$/im,
  );
  if (labeled?.[1]) {
    const raw = labeled[1]
      .split(/[,،]| ו | and /i)
      .map((s) => s.replace(/[.!?]+$/g, "").trim())
      .filter((s) => s.length > 1 && !/^(רק|ב|עם|את|של)$/i.test(s));
    if (raw.length) return raw.slice(0, 12);
  }

  // Known tech tokens
  const tech = [
    "React",
    "TypeScript",
    "JavaScript",
    "Node.js",
    "Next.js",
    "Python",
    "Full Stack",
    "Frontend",
    "Backend",
    "מפתח פולסטאק",
    "מהנדס תוכנה",
    "DevOps",
    "SQL",
  ];
  const hit = tech.filter((t) => new RegExp(t.replace(".", "\\."), "i").test(text));
  if (hit.length) {
    if (/הוסף|תוסיף|add/i.test(text)) {
      return [...new Set([...current, ...hit])];
    }
    if (/הסר|תוריד|בלי|remove|without/i.test(text)) {
      return current.filter((k) => !hit.some((h) => h.toLowerCase() === k.toLowerCase()));
    }
    return hit;
  }
  return null;
}

function summarize(plan: RunPlan): string {
  const sites = plan.enabledSites.join(", ") || "(אין)";
  const kw = plan.keywords.slice(0, 6).join(", ") || "(אין)";
  const mode = plan.searchMode === "cv" ? "מקו״ח" : "מילות מפתח";
  const apply = plan.applyMode === "search-only" ? "חיפוש בלבד (בלי הגשה)" : "חיפוש + הגשה";
  return `מצב: ${mode} · אתרים: ${sites} · מילות מפתח: ${kw} · עד ${plan.jobLimitPerSite} לאתר · ${apply} · מיקום: ${plan.location}`;
}

/**
 * Rule-based Hebrew/English intent → RunPlan patch.
 * Always available offline — no LLM required.
 */
export function parseHebrewIntent(userText: string, ctx: ParseContext = {}): {
  plan: RunPlan;
  replyHe: string;
  matched: boolean;
} {
  const text = (userText || "").trim();
  const base = emptyPlan({
    ...(ctx.current ?? {}),
    keywords: ctx.current?.keywords?.length
      ? [...ctx.current.keywords]
      : [...(ctx.defaultKeywords ?? emptyPlan().keywords)],
    enabledSites: ctx.current?.enabledSites?.length
      ? [...ctx.current.enabledSites]
      : [...(ctx.defaultSites ?? ["linkedin", "indeed"])],
    confirmed: false,
  });

  if (!text) {
    return {
      plan: { ...base, summaryHe: summarize(base) },
      replyHe: "כתוב לי מה לחפש — למשל: «חפש React בלינקדאין, עד 5 משרות».",
      matched: false,
    };
  }

  let matched = false;

  // Help
  if (/^(עזרה|help|\?)$/i.test(text) || /מה אתה יכול|איך משתמשים/i.test(text)) {
    return {
      plan: { ...base, summaryHe: summarize(base) },
      replyHe:
        "אפשר לבקש בעברית:\n" +
        "• «חפש לפי קו״ח» / «חפש React ו-TypeScript»\n" +
        "• «רק לינקדאין» / «לינקדאין ואינדיד ואלביט»\n" +
        "• «עד 8 משרות לאתר»\n" +
        "• «רק חיפוש בלי להגיש» / «הגש מועמדויות»\n" +
        "• «אשר תוכנית» ואז «הפעל ריצה»",
      matched: true,
    };
  }

  // Confirm
  if (/^(אשר|מאשר|ok|כן|סבבה|יאללה)|אשר את התוכנית|אשר תוכנית/i.test(text)) {
    matched = true;
    const plan = { ...base, confirmed: true, summaryHe: summarize(base) };
    return {
      plan,
      replyHe: `מאושר.\n${plan.summaryHe}\n\nלחץ «הפעל ריצה» או כתוב «הפעל ריצה».`,
      matched,
    };
  }

  // Start run cue (UI also has button) — keep plan, mark confirmed
  if (/הפעל ריצה|תתחיל|התחל ריצה|start run/i.test(text)) {
    matched = true;
    const plan = { ...base, confirmed: true, summaryHe: summarize(base) };
    return {
      plan,
      replyHe: `מפעיל לפי התוכנית:\n${plan.summaryHe}`,
      matched,
    };
  }

  if (/לפי קו[״"']?ח|מקו[״"']?ח|מהקו[״"']?ח|cv[- ]?based|from cv/i.test(text)) {
    matched = true;
    base.searchMode = "cv";
  }
  if (/מילות מפתח|keywords|לא לפי קו/i.test(text) && !/לפי קו/i.test(text)) {
    matched = true;
    base.searchMode = "keywords";
  }

  if (/רק חיפוש|בלי להגיש|search[- ]?only|אל תגיש|לא להגיש/i.test(text)) {
    matched = true;
    base.applyMode = "search-only";
  }
  if (/הגש|הגשות|apply|תגיש מועמד/i.test(text) && !/בלי להגיש|אל תגיש/i.test(text)) {
    matched = true;
    base.applyMode = "apply";
  }

  const sites = resolveSites(text);
  if (sites) {
    matched = true;
    base.enabledSites = sites;
  }

  const explicitCv = /לפי קו[״"']?ח|מקו[״"']?ח|מהקו[״"']?ח|cv[- ]?based|from cv/i.test(text);
  const kws = extractKeywords(text, base.keywords);
  if (kws) {
    matched = true;
    base.keywords = kws;
    // Don't override an explicit CV request just because the sentence contains «חפש»
    if (!explicitCv && (/מילות|keywords/i.test(text) || !/לפי קו|מקו/i.test(text))) {
      base.searchMode = "keywords";
    }
  }

  const limit = extractLimit(text, base.jobLimitPerSite);
  if (limit != null) {
    matched = true;
    base.jobLimitPerSite = limit;
  }

  if (/תל אביב|tel aviv/i.test(text)) {
    matched = true;
    base.location = "Tel Aviv";
  } else if (/ישראל|israel/i.test(text)) {
    matched = true;
    base.location = "Israel";
  } else if (/מרחוק|remote/i.test(text)) {
    matched = true;
    base.location = "Remote";
  }

  base.summaryHe = summarize(base);
  base.confirmed = false;

  if (!matched) {
    return {
      plan: base,
      replyHe:
        "לא הבנתי לגמרי — נסה למשל:\n«חפש React בלינקדאין עד 5 משרות»\nאו «עזרה».\n\nתוכנית נוכחית:\n" +
        base.summaryHe,
      matched: false,
    };
  }

  return {
    plan: base,
    replyHe: `עדכנתי תוכנית:\n${base.summaryHe}\n\nאם זה נכון — כתוב «אשר» או לחץ «הפעל ריצה».`,
    matched: true,
  };
}
