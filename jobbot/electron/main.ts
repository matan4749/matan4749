import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { JobRunner } from "../core/runner/orchestrator";
import { loadSettings, saveSettings, seedCvIntoDataDir } from "../core/settings/store";
import { analyzeCv } from "../core/cv/analyze";
import { listAdapters } from "../core/adapters/registry";
import { LearningEngine } from "../core/learning/engine";
import type { AppSettings, RunConfig } from "../core/types";

let mainWindow: BrowserWindow | null = null;
let runner: JobRunner | null = null;
let lastReportHtml = "";

function appRoot(): string {
  // Dev: project root; packaged: resources
  if (process.env.VITE_DEV_SERVER_URL) {
    return path.join(__dirname, "..");
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

function ensureSettings(): AppSettings {
  const dir = dataDir();
  const seededCv = seedCvIntoDataDir(dir, appRoot());
  const settings = loadSettings(dir, appRoot());
  if (!settings.cvPath || !fs.existsSync(settings.cvPath)) {
    settings.cvPath = seededCv;
    saveSettings(dir, settings);
  } else if (!settings.cvPath.includes("matan-amar-cv") && fs.existsSync(seededCv)) {
    // Prefer seeded Matan CV when settings still empty-ish
  }
  // Always ensure a usable CV when empty
  if (!settings.cvPath) {
    settings.cvPath = seededCv;
    saveSettings(dir, settings);
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
    runner = new JobRunner(dataDir(), { demo: process.env.JOBBOT_DEMO === "1" });
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

  ipcMain.handle("run:start", async (_e, payload: { settings: AppSettings; config: RunConfig }) => {
    const settings = { ...payload.settings };
    if (!settings.cvPath || !fs.existsSync(settings.cvPath)) {
      settings.cvPath = seedCvIntoDataDir(dataDir(), appRoot());
    }
    saveSettings(dataDir(), settings);
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
