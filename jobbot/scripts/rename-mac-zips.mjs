#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const release = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "release");
const candidates = [
  ["Jobbot-0.1.0-mac-arm64.zip", "Jobbot-0.1.0-mac-arm64.zip"],
  ["Jobbot-0.1.0-mac-x64.zip", "Jobbot-0.1.0-mac-x64.zip"],
  ["Jobbot-0.1.0.zip", null], // ambiguous if both built into same name
];

for (const [from] of candidates) {
  const p = path.join(release, from);
  if (fs.existsSync(p)) console.log("present:", from, fs.statSync(p).size);
}

// Prefer explicit names already produced by artifactName template
const arm = path.join(release, "Jobbot-0.1.0-mac-arm64.zip");
const x64 = path.join(release, "Jobbot-0.1.0-mac-x64.zip");
if (!fs.existsSync(arm) && fs.existsSync(path.join(release, "mac-arm64", "Jobbot.app"))) {
  console.log("Tip: zip release/mac-arm64/Jobbot.app manually if needed");
}
if (fs.existsSync(arm)) console.log("Apple Silicon →", arm);
if (fs.existsSync(x64)) console.log("Intel Mac →", x64);
