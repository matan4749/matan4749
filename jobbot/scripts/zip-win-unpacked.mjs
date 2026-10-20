#!/usr/bin/env node
/**
 * Creates Jobbot-Windows-x64.zip from release/win-unpacked.
 * User unzips and double-clicks Jobbot.exe — no terminal needed.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const unpacked = path.join(root, "release", "win-unpacked");
const out = path.join(root, "release", "Jobbot-Windows-x64.zip");

if (!fs.existsSync(path.join(unpacked, "Jobbot.exe"))) {
  console.error("Missing release/win-unpacked/Jobbot.exe — run pack:win-folder first");
  process.exit(1);
}

if (fs.existsSync(out)) fs.unlinkSync(out);

const r = spawnSync("zip", ["-r", "-q", out, "."], { cwd: unpacked, stdio: "inherit" });
if (r.status !== 0) {
  // fallback to tar.gz if zip missing
  const tarOut = path.join(root, "release", "Jobbot-Windows-x64.tar.gz");
  const t = spawnSync("tar", ["-czf", tarOut, "-C", unpacked, "."], { stdio: "inherit" });
  if (t.status !== 0) process.exit(t.status || 1);
  console.log("Created", tarOut);
  process.exit(0);
}

console.log("Created", out);
console.log("User path: unzip → double-click Jobbot.exe");
