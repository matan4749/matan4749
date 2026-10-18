import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AppSettings, RunConfig, RunProgress } from "../core/types";

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
  getProgress: () => Promise<RunProgress>;
  getLastReport: () => Promise<string>;
  getLearningSnapshot: () => Promise<unknown>;
  openPath: (p: string) => Promise<string>;
  getDataDir: () => Promise<string>;
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
  getProgress: () => ipcRenderer.invoke("run:progress"),
  getLastReport: () => ipcRenderer.invoke("report:last"),
  getLearningSnapshot: () => ipcRenderer.invoke("learning:snapshot"),
  openPath: (p) => ipcRenderer.invoke("shell:openPath", p),
  getDataDir: () => ipcRenderer.invoke("app:dataDir"),
  onProgress: (cb) => {
    const handler = (_event: IpcRendererEvent, progress: RunProgress) => cb(progress);
    ipcRenderer.on("run:progress", handler);
    return () => ipcRenderer.removeListener("run:progress", handler);
  },
};

contextBridge.exposeInMainWorld("jobbot", api);
