import type { ApplyResult, RunProgress } from "../types";

export function buildReportHtml(opts: {
  userName: string;
  progress: RunProgress;
  results: ApplyResult[];
}): string {
  const { userName, progress, results } = opts;
  const rows = results
    .map((r) => {
      const statusHe =
        r.status === "applied"
          ? "הוגש בהצלחה"
          : r.status === "failed"
            ? "נכשל"
            : r.status === "skipped"
              ? "דולג"
              : "נמצא";
      const statusColor =
        r.status === "applied" ? "#1fa97a" : r.status === "failed" ? "#d64545" : "#6b7c85";
      return `<tr>
        <td>${escapeHtml(r.job.site)}</td>
        <td>${escapeHtml(r.job.title)}</td>
        <td><a href="${escapeAttr(r.job.url)}">${escapeHtml(truncate(r.job.url, 48))}</a></td>
        <td style="color:${statusColor};font-weight:600">${statusHe}</td>
        <td>${escapeHtml(r.reason || "—")}</td>
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
            <p style="margin:10px 0 0;color:#9bb5b0;line-height:1.5">שלום ${escapeHtml(userName)}, להלן סיכום הריצה האחרונה.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 28px 20px">
            <table width="100%" cellpadding="12" cellspacing="0" style="background:#10262c;border-radius:12px">
              <tr>
                <td align="center"><div style="font-size:22px;font-weight:700;color:#5dffe0">${progress.found}</div><div style="font-size:12px;color:#8aa6a1">נמצאו</div></td>
                <td align="center"><div style="font-size:22px;font-weight:700;color:#5dffe0">${progress.applied}</div><div style="font-size:12px;color:#8aa6a1">הוגשו</div></td>
                <td align="center"><div style="font-size:22px;font-weight:700;color:#ff8f8f">${progress.failed}</div><div style="font-size:12px;color:#8aa6a1">נכשלו</div></td>
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
