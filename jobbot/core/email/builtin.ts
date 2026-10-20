import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";

export interface BuiltinMailResult {
  ok: boolean;
  /** Saved locally; no network send attempted or credentials missing */
  previewOnly?: boolean;
  messageId?: string;
  outboxPath?: string;
  transport?: "resend" | "app-smtp" | "outbox";
  error?: string;
}

/**
 * App-owned mailer — user never configures SMTP.
 * Credentials come only from process env owned by the Jobbot install:
 *   JOBBOT_MAIL_API_KEY + JOBBOT_MAIL_FROM  → Resend API
 *   JOBBOT_MAIL_SMTP_HOST (+ user/pass/from) → app SMTP relay
 */
export async function sendBuiltinReport(opts: {
  to: string;
  subject: string;
  html: string;
  outboxDir: string;
}): Promise<BuiltinMailResult> {
  const to = opts.to.trim();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.mkdirSync(opts.outboxDir, { recursive: true });
  const outboxPath = path.join(opts.outboxDir, `report-${stamp}.html`);
  fs.writeFileSync(outboxPath, opts.html, "utf8");

  if (!to) {
    return {
      ok: false,
      previewOnly: true,
      outboxPath,
      transport: "outbox",
      error: "REPORT_EMAIL_MISSING",
    };
  }

  const apiKey = process.env.JOBBOT_MAIL_API_KEY?.trim();
  const from =
    process.env.JOBBOT_MAIL_FROM?.trim() ||
    process.env.JOBBOT_MAIL_SMTP_FROM?.trim() ||
    "Jobbot <noreply@jobbot.local>";

  if (apiKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject: opts.subject,
          html: opts.html,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok) {
        return {
          ok: false,
          outboxPath,
          transport: "resend",
          error: body.message || `Resend HTTP ${res.status}`,
        };
      }
      return {
        ok: true,
        messageId: body.id,
        outboxPath,
        transport: "resend",
      };
    } catch (err) {
      return {
        ok: false,
        outboxPath,
        transport: "resend",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const host = process.env.JOBBOT_MAIL_SMTP_HOST?.trim();
  if (host) {
    try {
      const port = Number(process.env.JOBBOT_MAIL_SMTP_PORT || 587);
      const user = process.env.JOBBOT_MAIL_SMTP_USER || "";
      const pass = process.env.JOBBOT_MAIL_SMTP_PASS || "";
      const secure = process.env.JOBBOT_MAIL_SMTP_SECURE === "1" || port === 465;
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: user ? { user, pass } : undefined,
      });
      const info = await transporter.sendMail({
        from,
        to,
        subject: opts.subject,
        html: opts.html,
      });
      return {
        ok: true,
        messageId: info.messageId,
        outboxPath,
        transport: "app-smtp",
      };
    } catch (err) {
      return {
        ok: false,
        outboxPath,
        transport: "app-smtp",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Dev / first-run: keep outbox + in-app preview; never ask user for SMTP
  return {
    ok: true,
    previewOnly: true,
    outboxPath,
    transport: "outbox",
    error: "BUILTIN_MAILER_UNCONFIGURED — דוח נשמר מקומית (outbox + תצוגה באפליקציה)",
  };
}
