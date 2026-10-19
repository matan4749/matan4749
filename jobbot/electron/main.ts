import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { JobRunner } from "../core/runner/orchestrator";
import { loadSettings, saveSettings, seedCvIntoDataDir } from "../core/settings/store";
import { analyzeCv } from "../core/cv/analyze";
import { listAdapters } from "../core/adapters/registry";
import { LearningEngine } from "../core/learning/engine";
import {
  defaultMacChromeHint,
  normalizeChromeUserDataDir,
  probeChromeProfile,
} from "../core/browser/probe";
import { checkChromeClosed } from "../core/browser/chrome-lock";
import { resolveAssistantTurn, llmConfigured } from "../core/chat/llm";
import { loadChatState, saveChatState } from "../core/chat/store";
import type { ChatMessage, RunPlan } from "../core/chat/types";
import { randomUUID } from "node:crypto";
import type { AppSettings, RunConfig } from "../core/types";

let mainWindow: BrowserWindow | null = null;
let runner: JobRunner | null = null;
let lastReportHtml = "";

function appRoot(): string {
  if (process.env.VITE_DEV_SERVER_URL) {
    return path.join(__dirname, "..");
  }
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  return app.getAppPath();
}

function dataDir(): string {
  const dir = path.join(app.getPath("userData"), "jobbot-data");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "knowledge"), { recursive: true });
  fs.mkdirSync(path.join(dir, "runs"), { recursive: true });
  fs.mkdirSync(path.join(dir, "outbox"), { recursive: true });
  return dir;
}

/** Packaged Mac/Windows builds never use JOBBOT_DEMO — real applies only */
function demoAllowed(): boolean {
  if (app.isPackaged) return false;
  return process.env.JOBBOT_DEMO === "1";
}

function ensureSettings(): AppSettings {
  const dir = dataDir();
  const seededCv = seedCvIntoDataDir(dir, appRoot());
  const settings = loadSettings(dir, appRoot());
  if (!settings.cvPath || !fs.existsSync(settings.cvPath)) {
    settings.cvPath = seededCv;
    saveSettings(dir, settings);
  }
  if (!settings.cvPath) {
    settings.cvPath = seededCv;
    saveSettings(dir, settings);
  }
  // Seed Mac Chrome hint path if empty and the folder exists
  if (!settings.chromeUserDataDir?.trim() && process.platform === "darwin") {
    const hint = defaultMacChromeHint();
    if (fs.existsSync(hint)) {
      // Don't auto-save — only expose via IPC hint; user must confirm after login
    }
  }
  return loadSettings(dir, appRoot());
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#071218",
    title: "Jobbot",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function getRunner(): JobRunner {
  if (!runner) {
    runner = new JobRunner(dataDir(), {
      demo: demoAllowed(),
      allowDemo: demoAllowed(),
    });
    runner.onProgress((progress) => {
      mainWindow?.webContents.send("run:progress", progress);
    });
  }
  return runner;
}

function registerIpc(): void {
  ipcMain.handle("settings:get", () => ensureSettings());

  ipcMain.handle("settings:save", (_e, settings: AppSettings) => {
    saveSettings(dataDir(), settings);
    return loadSettings(dataDir(), appRoot());
  });

  ipcMain.handle("adapters:list", () =>
    listAdapters().map((a) => ({
      id: a.id,
      displayName: a.displayName,
      displayNameHe: a.displayNameHe,
      status: a.status,
      siteKind: a.siteKind,
      careersUrl: a.careersUrl,
      defaultApplyMethod: a.defaultApplyMethod,
    })),
  );

  ipcMain.handle("cv:analyze", async (_e, cvPath: string) => analyzeCv(cvPath));

  ipcMain.handle("dialog:pickFile", async (_e, filters?: Electron.FileFilter[]) => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openFile"],
      filters: filters ?? [{ name: "Documents", extensions: ["pdf", "txt", "md", "doc", "docx"] }],
    });
    return res.canceled ? null : res.filePaths[0] ?? null;
  });

  ipcMain.handle("dialog:pickDir", async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openDirectory"],
    });
    return res.canceled ? null : res.filePaths[0] ?? null;
  });

  ipcMain.handle("chrome:defaultHint", () => {
    if (process.platform === "darwin") return defaultMacChromeHint();
    if (process.platform === "win32") {
      return path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data");
    }
    return path.join(os.homedir(), ".config", "google-chrome");
  });

  ipcMain.handle(
    "chrome:probe",
    async (_e, chromeUserDataDir: string, opts?: { forceSync?: boolean }) => {
      return probeChromeProfile(chromeUserDataDir, {
        dataDir: dataDir(),
        forceSync: opts?.forceSync,
      });
    },
  );

  ipcMain.handle("chrome:checkClosed", async (_e, chromeUserDataDir?: string) => {
    const raw = chromeUserDataDir?.trim() || "";
    const resolved = raw ? normalizeChromeUserDataDir(raw) : "";
    return checkChromeClosed(resolved);
  });

  ipcMain.handle("chrome:resolvePath", (_e, raw: string) => normalizeChromeUserDataDir(raw));

  ipcMain.handle("run:start", async (_e, payload: { settings: AppSettings; config: RunConfig }) => {
    const settings = { ...payload.settings };
    if (!settings.cvPath || !fs.existsSync(settings.cvPath)) {
      settings.cvPath = seedCvIntoDataDir(dataDir(), appRoot());
    }
    if (settings.chromeUserDataDir) {
      settings.chromeUserDataDir = normalizeChromeUserDataDir(settings.chromeUserDataDir);
    }
    saveSettings(dataDir(), settings);
    // Recreate runner each run so packaged/demo flags stay correct
    runner = null;
    const r = getRunner();
    const result = await r.run(settings, payload.config);
    lastReportHtml = result.reportHtml;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(path.join(dataDir(), "runs", `report-${stamp}.html`), result.reportHtml, "utf8");
    return result;
  });

  ipcMain.handle("run:stop", () => {
    getRunner().stop();
    return true;
  });

  ipcMain.handle("run:progress", () => getRunner().getProgress());

  ipcMain.handle("report:last", () => lastReportHtml);

  ipcMain.handle("learning:snapshot", () => {
    const engine = new LearningEngine(dataDir());
    return engine.snapshot();
  });

  ipcMain.handle("shell:openPath", async (_e, p: string) => shell.openPath(p));

  ipcMain.handle("app:dataDir", () => dataDir());

  ipcMain.handle("app:isPackaged", () => app.isPackaged);

  ipcMain.handle("chat:get", () => {
    const state = loadChatState(dataDir());
    const settings = loadSettings(dataDir(), appRoot());
    const backend = llmConfigured({
      apiKey: settings.llmApiKey,
      baseUrl: settings.llmBaseUrl,
      model: settings.llmModel,
    })
      ? "llm"
      : "rules";
    return { ...state, activeBackend: backend };
  });

  ipcMain.handle("chat:clear", () => {
    return saveChatState(dataDir(), { messages: [], lastPlan: null });
  });

  ipcMain.handle("chat:send", async (_e, userText: string) => {
    const settings = loadSettings(dataDir(), appRoot());
    const state = loadChatState(dataDir());
    const userMsg: ChatMessage = {
      id: randomUUID(),
      role: "user",
      content: userText,
      ts: new Date().toISOString(),
    };
    const history = state.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const turn = await resolveAssistantTurn({
      userText,
      history,
      currentPlan: state.lastPlan,
      defaultKeywords: settings.keywords,
      defaultSites: settings.enabledSites,
      llm: {
        apiKey: settings.llmApiKey,
        baseUrl: settings.llmBaseUrl,
        model: settings.llmModel,
      },
    });

    const assistantMsg: ChatMessage = {
      id: randomUUID(),
      role: "assistant",
      content: turn.replyHe,
      ts: new Date().toISOString(),
      backend: turn.backend,
    };
    const messages = [...state.messages, userMsg, assistantMsg];
    const saved = saveChatState(dataDir(), { messages, lastPlan: turn.plan });
    return {
      ...saved,
      activeBackend: turn.backend,
      latestReply: turn.replyHe,
      plan: turn.plan,
    };
  });

  ipcMain.handle("chat:savePlan", (_e, plan: RunPlan) => {
    const state = loadChatState(dataDir());
    return saveChatState(dataDir(), { messages: state.messages, lastPlan: plan });
  });

  ipcMain.handle("chat:backend", () => {
    const settings = loadSettings(dataDir(), appRoot());
    return {
      kind: llmConfigured({
        apiKey: settings.llmApiKey,
        baseUrl: settings.llmBaseUrl,
        model: settings.llmModel,
      })
        ? "llm"
        : "rules",
      model: settings.llmModel || process.env.JOBBOT_LLM_MODEL || "gpt-4o-mini",
    };
  });
}

app.whenReady().then(() => {
  ensureSettings();
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
