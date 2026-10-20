import type { ApplyResult, JobStatus, RunProgress } from "../types";
import { isRealApplied } from "../adapters/sanitize";

const STATUS_HE: Record<JobStatus, string> = {
  found: "נמצא",
  applied: "הוגש באמת (אומת)",
  failed: "נכשל",
  skipped: "לא הוגש / דולג",
  not_implemented: "לא מיושם",
  unknown: "לא אומת",
};

export function buildReportHtml(opts: {
  userName: string;
  progress: RunProgress;
  results: ApplyResult[];
}): string {
  const { userName, progress, results } = opts;

  const realApplied = results.filter(isRealApplied).length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter(
    (r) =>
      r.status === "skipped" ||
      r.status === "not_implemented" ||
      r.status === "unknown",
  ).length;
  const simulated = results.filter((r) => r.simulated).length;

  // Counts in the banner must match row truths (not optimistic progress alone)
  const found = progress.found;
  const honestyBanner =
    realApplied === 0
      ? `<tr><td style="padding:0 28px 16px">
          <div style="background:#3a1c1c;border:1px solid #ff8f8f;border-radius:12px;padding:14px 16px;color:#ffd0d0;font-size:14px;line-height:1.5">
            <strong>חשוב:</strong> בריצה זו <strong>לא הוגשה אף מועמדות אמיתית</strong>
            (0 הגשות מאומתות). שורות עם סטטוס אחר אינן הגשות מוצלחות.
            ${simulated ? ` · ${simulated} שורות הן הדגמה/סימולציה בלבד.` : ""}
          </div>
        </td></tr>`
      : "";

  const rows = results
    .map((r) => {
      const statusHe = STATUS_HE[r.status] || r.status;
      const statusColor =
        r.status === "applied" && r.confirmed
          ? "#1fa97a"
          : r.status === "failed"
            ? "#d64545"
            : r.status === "unknown"
              ? "#e6b84d"
              : "#6b7c85";
      const reason =
        (r.simulated ? "[הדגמה] " : "") + (r.reason || "—");
      return `<tr>
        <td>${escapeHtml(r.job.site)}</td>
        <td>${escapeHtml(r.job.title)}</td>
        <td><a href="${escapeAttr(r.job.url)}">${escapeHtml(truncate(r.job.url, 48))}</a></td>
        <td style="color:${statusColor};font-weight:600">${escapeHtml(statusHe)}</td>
        <td>${escapeHtml(reason)}</td>
      </tr>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>דוח Jobbot</title>
</head>
<body style="margin:0;padding:0;background:#071218;font-family:Heebo,Arial,sans-serif;color:#e7f2ef">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(160deg,#071218,#0c2a2e);padding:32px 12px">
    <tr><td align="center">
      <table width="680" cellpadding="0" cellspacing="0" style="background:#0b1c22;border-radius:16px;overflow:hidden;border:1px solid #1c3d44">
        <tr>
          <td style="padding:28px 28px 12px">
            <div style="font-size:13px;letter-spacing:0.12em;color:#5dffe0;font-weight:700">JOBBOT</div>
            <h1 style="margin:8px 0 0;font-size:26px;color:#f3fffb">דוח ריצת חיפוש משרות</h1>
            <p style="margin:10px 0 0;color:#9bb5b0;line-height:1.5">שלום ${escapeHtml(userName)}, להלן סיכום <strong>אמין</strong> של הריצה — רק הגשות מאומתות נספרות כ״הוגש״.</p>
          </td>
        </tr>
        ${honestyBanner}
        <tr>
          <td style="padding:8px 28px 20px">
            <table width="100%" cellpadding="12" cellspacing="0" style="background:#10262c;border-radius:12px">
              <tr>
                <td align="center"><div style="font-size:22px;font-weight:700;color:#5dffe0">${found}</div><div style="font-size:12px;color:#8aa6a1">נמצאו</div></td>
                <td align="center"><div style="font-size:22px;font-weight:700;color:#5dffe0">${realApplied}</div><div style="font-size:12px;color:#8aa6a1">הוגשו באמת</div></td>
                <td align="center"><div style="font-size:22px;font-weight:700;color:#ff8f8f">${failed}</div><div style="font-size:12px;color:#8aa6a1">נכשלו</div></td>
                <td align="center"><div style="font-size:22px;font-weight:700;color:#c9b27a">${skipped}</div><div style="font-size:12px;color:#8aa6a1">לא הוגש / לא מיושם</div></td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 28px 28px">
            <table width="100%" cellpadding="10" cellspacing="0" style="border-collapse:collapse;font-size:13px">
              <thead>
                <tr style="background:#143038;color:#9ef5e2">
                  <th align="right">אתר</th>
                  <th align="right">כותרת</th>
                  <th align="right">קישור</th>
                  <th align="right">סטטוס</th>
                  <th align="right">סיבה</th>
                </tr>
              </thead>
              <tbody>
                ${rows || `<tr><td colspan="5" style="padding:16px;color:#8aa6a1">אין תוצאות בריצה זו.</td></tr>`}
              </tbody>
            </table>
            <p style="margin:18px 0 0;font-size:12px;color:#6f8a85">
              התחלה: ${escapeHtml(progress.startedAt || "—")} · סיום: ${escapeHtml(progress.finishedAt || "—")} · מצב: ${escapeHtml(progress.phase)}
              · התאמת מונים: הוגשו=${realApplied} / נכשלו=${failed} / אחר=${skipped}
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
