import fs from "node:fs";
import path from "node:path";
import type { ChatPersistedState, ChatMessage, RunPlan } from "./types";

function chatPath(dataDir: string): string {
  return path.join(dataDir, "chat", "history.json");
}

export function loadChatState(dataDir: string): ChatPersistedState {
  const p = chatPath(dataDir);
  try {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, "utf8")) as ChatPersistedState;
      return {
        messages: Array.isArray(raw.messages) ? raw.messages : [],
        lastPlan: raw.lastPlan ?? null,
        updatedAt: raw.updatedAt || new Date().toISOString(),
      };
    }
  } catch {
    /* ignore */
  }
  return { messages: [], lastPlan: null, updatedAt: new Date().toISOString() };
}

export function saveChatState(
  dataDir: string,
  state: { messages: ChatMessage[]; lastPlan: RunPlan | null },
): ChatPersistedState {
  const dir = path.join(dataDir, "chat");
  fs.mkdirSync(dir, { recursive: true });
  const next: ChatPersistedState = {
    messages: state.messages.slice(-80),
    lastPlan: state.lastPlan,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(chatPath(dataDir), JSON.stringify(next, null, 2), "utf8");
  return next;
}
