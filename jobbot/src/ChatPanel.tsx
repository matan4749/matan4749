import { useEffect, useRef, useState } from "react";
import type { AppSettings } from "@core/types";
import type { ChatMessage, RunPlan } from "@core/chat/types";

interface Props {
  settings: AppSettings;
  onApplyPlan: (plan: RunPlan) => void;
  onStartFromPlan: (plan: RunPlan) => void;
  running: boolean;
}

const WELCOME =
  "שלום מתן — אני עוזר Jobbot. ספר לי מה לחפש ומה לעשות בריצה.\n" +
  "דוגמאות: «חפש React בלינקדאין עד 5 משרות» · «לפי קו״ח» · «רק חיפוש בלי להגיש» · «אשר»";

export default function ChatPanel({ settings, onApplyPlan, onStartFromPlan, running }: Props) {
  const api = window.jobbot;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [plan, setPlan] = useState<RunPlan | null>(null);
  const [backend, setBackend] = useState<"llm" | "rules">("rules");
  const [modelLabel, setModelLabel] = useState("rules");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
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
  }, [messages, busy]);

  async function send(text?: string) {
    const t = (text ?? draft).trim();
    if (!api || !t || busy) return;
    setDraft("");
    setBusy(true);
    try {
      const res = await api.sendChat(t);
      setMessages(res.messages);
      setPlan(res.plan ?? res.lastPlan);
      setBackend(res.activeBackend);
      if (/הפעל ריצה|תתחיל|התחל ריצה/i.test(t) && (res.plan ?? res.lastPlan)) {
        const p = res.plan ?? res.lastPlan!;
        onStartFromPlan({ ...p, confirmed: true });
      }
    } finally {
      setBusy(false);
    }
  }

  async function clearChat() {
    if (!api) return;
    const s = await api.clearChat();
    setMessages(s.messages);
    setPlan(null);
  }

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
          <div className="cta-row">
            <button
              type="button"
              className="btn"
              disabled={running}
              onClick={() => onApplyPlan(plan)}
            >
              החל להגדרות
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={running}
              onClick={() => onStartFromPlan({ ...plan, confirmed: true })}
            >
              הפעל ריצה
            </button>
          </div>
        </div>
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
          disabled={busy || running}
          aria-label="הודעה לצ׳אט"
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !draft.trim()}>
          שלח
        </button>
        <button type="button" className="btn" onClick={() => void clearChat()}>
          נקה
        </button>
      </form>

      <div className="chat-chips">
        {[
          "חפש React בלינקדאין עד 5 משרות",
          "חפש לפי קו״ח",
          "רק חיפוש בלי להגיש",
          "לינקדאין ואינדיד",
          "עזרה",
        ].map((q) => (
          <button key={q} type="button" className="chip" disabled={busy} onClick={() => void send(q)}>
            {q}
          </button>
        ))}
      </div>

      {/* keep settings in scope for future CV hints */}
      <span className="sr-only">{settings.reportEmail}</span>
    </section>
  );
}
