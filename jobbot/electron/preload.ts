import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AppSettings, RunConfig, RunProgress } from "../core/types";
import type { ChatMessage, RunPlan } from "../core/chat/types";

export interface ChromeProbeResult {
  ok: boolean;
  pathExists: boolean;
  pathUsed: string;
  launchPath?: string;
  mode?: "live" | "clone";
  linkedInLoggedIn: boolean | null;
  indeedReachable: boolean | null;
  chromeWasRunning?: boolean;
  messageHe: string;
  detail?: string;
}

export interface ChromeClosedCheck {
  ok: boolean;
  chromeRunning: boolean;
  profileLocked: boolean;
  pathChecked: string;
  messageHe: string;
  checkedAt: string;
}

export interface ChatStatePayload {
  messages: ChatMessage[];
  lastPlan: RunPlan | null;
  updatedAt?: string;
  activeBackend: "llm" | "rules";
  latestReply?: string;
  plan?: RunPlan;
}

export interface JobbotApi {
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: AppSettings) => Promise<AppSettings>;
  listAdapters: () => Promise<
    {
      id: string;
      displayName: string;
      displayNameHe: string;
      status: "live" | "stub";
      siteKind: "board" | "career-portal";
      careersUrl?: string;
      defaultApplyMethod: string;
    }[]
  >;
  analyzeCv: (cvPath: string) => Promise<{
    path: string;
    textLength: number;
    suggestedKeywords: string[];
    excerpt: string;
  }>;
  pickFile: (filters?: { name: string; extensions: string[] }[]) => Promise<string | null>;
  pickDir: () => Promise<string | null>;
  startRun: (payload: {
    settings: AppSettings;
    config: RunConfig;
  }) => Promise<{
    progress: RunProgress;
    reportHtml: string;
    email: { ok: boolean; previewOnly?: boolean; messageId?: string; error?: string };
    learningNotes: string[];
  }>;
  stopRun: () => Promise<boolean>;
  resolveLoginGate: (action: "continue" | "cancel") => Promise<boolean>;
  getProgress: () => Promise<RunProgress>;
  getLastReport: () => Promise<string>;
  getLearningSnapshot: () => Promise<unknown>;
  openPath: (p: string) => Promise<string>;
  getDataDir: () => Promise<string>;
  getChromeHint: () => Promise<string>;
  probeChrome: (
    chromeUserDataDir: string,
    opts?: { forceSync?: boolean; useClone?: boolean },
  ) => Promise<ChromeProbeResult>;
  checkChromeClosed: (chromeUserDataDir?: string) => Promise<ChromeClosedCheck>;
  resolveChromePath: (raw: string) => Promise<string>;
  isPackaged: () => Promise<boolean>;
  getChat: () => Promise<ChatStatePayload>;
  sendChat: (text: string) => Promise<ChatStatePayload>;
  clearChat: () => Promise<ChatStatePayload>;
  saveChatPlan: (plan: RunPlan) => Promise<ChatStatePayload>;
  getChatBackend: () => Promise<{ kind: "llm" | "rules"; model: string }>;
  onProgress: (cb: (progress: RunProgress) => void) => () => void;
}

const api: JobbotApi = {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  listAdapters: () => ipcRenderer.invoke("adapters:list"),
  analyzeCv: (cvPath) => ipcRenderer.invoke("cv:analyze", cvPath),
  pickFile: (filters) => ipcRenderer.invoke("dialog:pickFile", filters),
  pickDir: () => ipcRenderer.invoke("dialog:pickDir"),
  startRun: (payload) => ipcRenderer.invoke("run:start", payload),
  stopRun: () => ipcRenderer.invoke("run:stop"),
  resolveLoginGate: (action) => ipcRenderer.invoke("run:loginGate", action),
  getProgress: () => ipcRenderer.invoke("run:progress"),
  getLastReport: () => ipcRenderer.invoke("report:last"),
  getLearningSnapshot: () => ipcRenderer.invoke("learning:snapshot"),
  openPath: (p) => ipcRenderer.invoke("shell:openPath", p),
  getDataDir: () => ipcRenderer.invoke("app:dataDir"),
  getChromeHint: () => ipcRenderer.invoke("chrome:defaultHint"),
  probeChrome: (chromeUserDataDir, opts) =>
    ipcRenderer.invoke("chrome:probe", chromeUserDataDir, opts),
  checkChromeClosed: (chromeUserDataDir) =>
    ipcRenderer.invoke("chrome:checkClosed", chromeUserDataDir),
  resolveChromePath: (raw) => ipcRenderer.invoke("chrome:resolvePath", raw),
  isPackaged: () => ipcRenderer.invoke("app:isPackaged"),
  getChat: () => ipcRenderer.invoke("chat:get"),
  sendChat: (text) => ipcRenderer.invoke("chat:send", text),
  clearChat: () => ipcRenderer.invoke("chat:clear"),
  saveChatPlan: (plan) => ipcRenderer.invoke("chat:savePlan", plan),
  getChatBackend: () => ipcRenderer.invoke("chat:backend"),
  onProgress: (cb) => {
    const handler = (_event: IpcRendererEvent, progress: RunProgress) => cb(progress);
    ipcRenderer.on("run:progress", handler);
    return () => ipcRenderer.removeListener("run:progress", handler);
  },
};

contextBridge.exposeInMainWorld("jobbot", api);
