import fs from "node:fs";
import path from "node:path";

const SKILL_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\breact\b/i, label: "React" },
  { re: /\bnext\.?js\b/i, label: "Next.js" },
  { re: /\btypescript\b|\bts\b/i, label: "TypeScript" },
  { re: /\bjavascript\b|\bjs\b/i, label: "JavaScript" },
  { re: /\bnode\.?js\b/i, label: "Node.js" },
  { re: /\bpython\b/i, label: "Python" },
  { re: /\bfirebase\b/i, label: "Firebase" },
  { re: /\bstripe\b/i, label: "Stripe" },
  { re: /\bfull[\s-]?stack\b/i, label: "Full Stack Developer" },
  { re: /\bfront[\s-]?end\b/i, label: "Frontend Developer" },
  { re: /\bback[\s-]?end\b/i, label: "Backend Developer" },
  { re: /מפתח|מהנדס תוכנה|פול.?סטאק/i, label: "מפתח פולסטאק" },
  { re: /\bsql\b/i, label: "SQL" },
  { re: /\bdocker\b/i, label: "Docker" },
  { re: /\baws\b/i, label: "AWS" },
  { re: /\btailwind\b/i, label: "Tailwind CSS" },
];

export interface CvAnalysis {
  path: string;
  textLength: number;
  suggestedKeywords: string[];
  excerpt: string;
}

export async function analyzeCv(cvPath: string): Promise<CvAnalysis> {
  if (!cvPath || !fs.existsSync(cvPath)) {
    return {
      path: cvPath || "",
      textLength: 0,
      suggestedKeywords: ["Full Stack Developer", "React", "TypeScript"],
      excerpt: "",
    };
  }

  const ext = path.extname(cvPath).toLowerCase();
  let text = "";

  if (ext === ".txt" || ext === ".md") {
    text = fs.readFileSync(cvPath, "utf8");
  } else if (ext === ".pdf") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string }>;
      const data = await pdfParse(fs.readFileSync(cvPath));
      text = data.text || "";
    } catch {
      text = "";
    }
  } else {
    // Best-effort binary-as-utf8 for docx etc. won't work well — return empty
    try {
      text = fs.readFileSync(cvPath, "utf8");
    } catch {
      text = "";
    }
  }

  const suggested = SKILL_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label);
  const unique = [...new Set(suggested)];
  if (unique.length === 0) {
    unique.push("Software Engineer", "Full Stack Developer");
  }

  return {
    path: cvPath,
    textLength: text.length,
    suggestedKeywords: unique,
    excerpt: text.slice(0, 280).replace(/\s+/g, " ").trim(),
  };
}
