#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "release", "Jobbot-0.1.0-mac-arm64.zip");
const outDir = process.argv[2] || path.join(root, "release");
if (!fs.existsSync(src)) { console.error("missing", src); process.exit(1); }
spawnSync("split", ["-b", "45m", "-d", src, path.join(outDir, "Jobbot-0.1.0-mac-arm64.zip.part")], { stdio: "inherit" });
console.log("split into", outDir);
