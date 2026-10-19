#!/usr/bin/env node
/**
 * Re-pack Jobbot.app into a standard Info-ZIP archive, split for media store,
 * and ONLY write parts after cat+unzip -t round-trip succeeds.
 *
 * Usage: node scripts/split-and-verify-mac.mjs [mediaOutDir]
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(root, "release", "mac-arm64");
const appPath = path.join(appDir, "Jobbot.app");
const releaseZip = path.join(root, "release", "Jobbot-0.1.0-mac-arm64.zip");
const mediaOut =
  process.argv[2] ||
  path.join(root, "release", "media-parts");

const PART_PREFIX = "Jobbot-0.1.0-mac-arm64.zip.part";
const PART_SIZE = "45m"; // GNU split: 45 * 1024 * 1024

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").slice(0, 800);
    throw new Error(`${cmd} ${args.join(" ")} failed (${r.status}): ${err}`);
  }
  return r;
}

function sha256File(p) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(p));
  return h.digest("hex");
}

function mustExist(p, label) {
  if (!fs.existsSync(p)) throw new Error(`missing ${label}: ${p}`);
}

mustExist(appPath, "Jobbot.app");
fs.mkdirSync(path.join(root, "release"), { recursive: true });
fs.mkdirSync(mediaOut, { recursive: true });

// 1) Re-pack with Info-ZIP (deflate) — friendlier to macOS Archive Utility than
// electron-builder's store-method zip, and still preserves symlinks (-y).
console.log("Re-packing Jobbot.app with zip -r -y -X …");
if (fs.existsSync(releaseZip)) fs.unlinkSync(releaseZip);
run("zip", ["-r", "-y", "-X", "-q", releaseZip, "Jobbot.app"], {
  cwd: appDir,
  stdio: "inherit",
});

mustExist(releaseZip, "release zip");
const fullSha = sha256File(releaseZip);
const fullSize = fs.statSync(releaseZip).size;
console.log(`Full zip: ${fullSize} bytes  sha256=${fullSha}`);

console.log("unzip -t (source)…");
run("unzip", ["-t", releaseZip], { stdio: "inherit" });

// 2) Split
for (const f of fs.readdirSync(mediaOut)) {
  if (f.startsWith(PART_PREFIX) || f === "SHA256SUMS.txt" || f === "Jobbot-mac.zip") {
    fs.unlinkSync(path.join(mediaOut, f));
  }
}
const partPath = path.join(mediaOut, PART_PREFIX);
run("split", ["-b", PART_SIZE, "-d", releaseZip, partPath], { stdio: "inherit" });

const parts = fs
  .readdirSync(mediaOut)
  .filter((f) => f.startsWith(PART_PREFIX))
  .sort();
if (parts.length < 2) throw new Error(`expected multiple parts, got ${parts.join(",")}`);
console.log("Parts:", parts.map((p) => `${p}(${fs.statSync(path.join(mediaOut, p)).size})`).join(", "));

// 3) Mandatory round-trip
const rejoined = path.join(mediaOut, "Jobbot-mac.roundtrip.zip");
const catArgs = parts.map((p) => path.join(mediaOut, p));
const outFd = fs.openSync(rejoined, "w");
for (const p of catArgs) {
  fs.writeSync(outFd, fs.readFileSync(p));
}
fs.closeSync(outFd);

const rejoinSha = sha256File(rejoined);
if (rejoinSha !== fullSha) {
  throw new Error(`ROUND-TRIP SHA MISMATCH\n  src=${fullSha}\n  cat=${rejoinSha}`);
}
if (fs.statSync(rejoined).size !== fullSize) {
  throw new Error("ROUND-TRIP SIZE MISMATCH");
}

const magic = fs.readFileSync(rejoined).subarray(0, 4);
if (Buffer.compare(magic, Buffer.from([0x50, 0x4b, 0x03, 0x04])) !== 0) {
  throw new Error(`bad zip magic: ${magic.toString("hex")}`);
}

console.log("unzip -t (rejoined from parts)…");
run("unzip", ["-t", rejoined], { stdio: "inherit" });
fs.unlinkSync(rejoined);

// 4) Checksums file
const lines = [`# Jobbot Mac arm64 — verify before unzip`, `# Full: Jobbot-0.1.0-mac-arm64.zip / Jobbot-mac.zip`, `${fullSha}  Jobbot-mac.zip`, `${fullSha}  Jobbot-0.1.0-mac-arm64.zip`, ``];
for (const p of parts) {
  const abs = path.join(mediaOut, p);
  lines.push(`${sha256File(abs)}  ${p}`);
}
lines.push("");
fs.writeFileSync(path.join(mediaOut, "SHA256SUMS.txt"), lines.join("\n"), "utf8");

// Also copy full zip hash sidecar next to release
fs.writeFileSync(
  path.join(root, "release", "Jobbot-0.1.0-mac-arm64.zip.sha256"),
  `${fullSha}  Jobbot-0.1.0-mac-arm64.zip\n`,
  "utf8",
);

console.log("OK — parts verified, unzip -t passed, SHA256SUMS written");
console.log("FULL_SHA256=" + fullSha);
console.log("MEDIA_OUT=" + mediaOut);
