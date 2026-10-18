import path from "node:path";
import type { AppSettings } from "../types";
import { sendBuiltinReport, type BuiltinMailResult } from "./builtin";

/** Public send entry — always uses app-owned mailer; user only supplies destination. */
export async function sendReportEmail(opts: {
  settings: AppSettings;
  subject: string;
  html: string;
  dataDir: string;
}): Promise<BuiltinMailResult> {
  return sendBuiltinReport({
    to: opts.settings.reportEmail,
    subject: opts.subject,
    html: opts.html,
    outboxDir: path.join(opts.dataDir, "outbox"),
  });
}

export type { BuiltinMailResult };
