import { useEffect, useRef, useState } from "react";
import type { AppSettings } from "@core/types";
import type { ChatMessage, RunPlan } from "@core/chat/types";

export interface PlanActionResult {
  ok: boolean;
  messageHe: string;
}

interface Props {
  settings: AppSettings;
  onApplyPlan: (plan: RunPlan) => Promise<PlanActionResult>;
  onStartFromPlan: (plan: RunPlan) => Promise<PlanActionResult>;
  running: boolean;
}

const WELCOME =
  "שלום מתן — אני עוזר Jobbot. ספר לי מה לחפש ומה לעשות בריצה.\n" +
  "דוגמאות: «חפש React בלינקדאין עד 5 משרות» · «לפי קו״ח» · «רק חיפוש בלי להגיש» · «אשר» · «הפעל ריצה»";

export default function ChatPanel({ settings, onApplyPlan, onStartFromPlan, running }: Props) {
  const api = window.jobbot;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [plan, setPlan] = useState<RunPlan | null>(null);
  const [backend, setBackend] = useState<"llm" | "rules">("rules");
  const [modelLabel, setModelLabel] = useState("rules");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackOk, setFeedbackOk] = useState(true);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!api) return;
    void (async () => {
      const s = await api.getChat();
      setMessages(s.messages);
      setPlan(s.lastPlan);
      setBackend(s.activeBackend);
      const b = await api.getChatBackend();
      setModelLabel(b.kind === "llm" ? `LLM · ${b.model}` : "כללים מקומיים (עברית)");
    })();
  }, [api]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy, feedback]);

  function showFeedback(ok: boolean, messageHe: string) {
    setFeedbackOk(ok);
    setFeedback(messageHe);
  }

  async function handleApply(p: RunPlan) {
    if (actionBusy || running) return;
    setActionBusy(true);
    showFeedback(true, "מחיל תוכנית להגדרות…");
    try {
      const r = await onApplyPlan(p);
      showFeedback(r.ok, r.messageHe);
      if (r.ok) {
        setPlan({ ...p, confirmed: true });
        try {
          await api?.saveChatPlan({ ...p, confirmed: true });
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      showFeedback(false, err instanceof Error ? err.message : String(err));
    } finally {
      setActionBusy(false);
    }
  }

  async function handleStart(p: RunPlan) {
    if (actionBusy || running) return;
    setActionBusy(true);
    showFeedback(true, "מכין ריצה (בדיקת Chrome + הפעלה)…");
    try {
      // Always apply settings first so the plan is live
      const applied = await onApplyPlan(p);
      if (!applied.ok) {
        showFeedback(false, applied.messageHe);
        return;
      }
      const r = await onStartFromPlan({ ...p, confirmed: true });
      showFeedback(r.ok, r.messageHe);
    } catch (err) {
      showFeedback(false, err instanceof Error ? err.message : String(err));
    } finally {
      setActionBusy(false);
    }
  }

  async function send(text?: string) {
    const t = (text ?? draft).trim();
    if (!api || !t || busy || actionBusy) return;
    setDraft("");
    setBusy(true);
    showFeedback(true, "");
    try {
      const res = await api.sendChat(t);
      setMessages(res.messages);
      const nextPlan = res.plan ?? res.lastPlan;
      setPlan(nextPlan);
      setBackend(res.activeBackend);

      const isConfirm = /^(אשר|מאשר|ok|כן)|אשר את התוכנית|אשר תוכנית/i.test(t);
      const isStart = /הפעל ריצה|תתחיל|התחל ריצה|start run/i.test(t);

      if (isStart && nextPlan) {
        setBusy(false);
        await handleStart(nextPlan);
        return;
      }
      if (isConfirm && nextPlan) {
        setBusy(false);
        await handleApply(nextPlan);
        return;
      }
    } catch (err) {
      showFeedback(false, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function clearChat() {
    if (!api) return;
    const s = await api.clearChat();
    setMessages(s.messages);
    setPlan(null);
    setFeedback("");
  }

  const blocked = running || actionBusy || busy;

  return (
    <section className="chat-shell rise">
      <header className="chat-head">
        <div>
          <h2>צ׳אט Jobbot</h2>
          <p className="sub">תכנון ריצה בעברית — חיפוש, אתרים, הגשה</p>
        </div>
        <div className="chat-backend" title="מקור התשובות">
          <span className={`backend-dot ${backend}`} />
          {backend === "llm" ? "מודל API פעיל" : "מצב כללים מקומי"}
          <span className="hint" style={{ marginInlineStart: 8 }}>
            {modelLabel}
          </span>
        </div>
      </header>

      {backend === "rules" && (
        <p className="hint chat-honest">
          אין מפתח LLM — עונה עם כללי עברית מקומיים. להפעלת מודל חזק: הגדרות ←{" "}
          <code>JOBBOT_LLM_API_KEY</code> / שדה מפתח (OpenAI-compatible). זה לא Cursor Composer
          בענן בתוך האפליקציה.
        </p>
      )}

      <div className="chat-stream">
        {messages.length === 0 && (
          <div className="chat-bubble assistant welcome">
            <pre>{WELCOME}</pre>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-bubble ${m.role}`}>
            <pre>{m.content}</pre>
            {m.backend && (
              <span className="chat-meta">{m.backend === "llm" ? "LLM" : "כללים"}</span>
            )}
          </div>
        ))}
        {busy && <div className="chat-bubble assistant thinking">חושב…</div>}
        <div ref={bottomRef} />
      </div>

      {plan && (
        <div className="chat-plan">
          <h3>תוכנית ריצה</h3>
          <p>{plan.summaryHe || "—"}</p>
          <div className="cta-row chat-plan-actions">
            <button
              type="button"
              className="btn"
              disabled={blocked}
              onClick={() => void handleApply(plan)}
            >
              {actionBusy ? "…" : "החל להגדרות"}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={blocked}
              onClick={() => void handleStart(plan)}
            >
              {running ? "רץ…" : actionBusy ? "מפעיל…" : "הפעל ריצה"}
            </button>
          </div>
          {feedback && (
            <p
              className="chat-action-feedback"
              role="status"
              style={{ color: feedbackOk ? "var(--mint)" : "var(--danger)" }}
            >
              {feedback}
            </p>
          )}
          {!settings.chromeUserDataDir?.trim() && (
            <p className="hint" style={{ color: "var(--danger)" }}>
              ריצה תיחסם בלי נתיב Chrome — מלא בהגדרות לפני «הפעל ריצה».
            </p>
          )}
        </div>
      )}

      {!plan && feedback && (
        <p className="chat-action-feedback" style={{ color: feedbackOk ? "var(--mint)" : "var(--danger)" }}>
          {feedback}
        </p>
      )}

      <form
        className="chat-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="למשל: חפש React בלינקדאין עד 5 משרות"
          disabled={blocked}
          aria-label="הודעה לצ׳אט"
        />
        <button type="submit" className="btn btn-primary" disabled={blocked || !draft.trim()}>
          שלח
        </button>
        <button type="button" className="btn" disabled={blocked} onClick={() => void clearChat()}>
          נקה
        </button>
      </form>

      <div className="chat-chips">
        {[
          "חפש React בלינקדאין עד 5 משרות",
          "חפש לפי קו״ח",
          "רק חיפוש בלי להגיש",
          "לינקדאין ואינדיד",
          "אשר",
          "הפעל ריצה",
          "עזרה",
        ].map((q) => (
          <button
            key={q}
            type="button"
            className="chip"
            disabled={blocked}
            onClick={() => void send(q)}
          >
            {q}
          </button>
        ))}
      </div>
    </section>
  );
}
