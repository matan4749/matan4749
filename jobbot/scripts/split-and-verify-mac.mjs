#!/usr/bin/env node
/**
 * Primary Mac delivery: Jobbot.app as .tar.gz (Finder/Archive Utility friendly),
 * split into ≤45MB parts. Ships ONLY after cat + tar -tzf round-trip + SHA match.
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
const releaseTgz = path.join(root, "release", "Jobbot-0.1.0-mac-arm64.tar.gz");
const mediaOut = process.argv[2] || path.join(root, "release", "media-parts");

const PART_PREFIX = "Jobbot-0.1.0-mac-arm64.tar.gz.part";
const PART_SIZE = "45m";

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

if (!fs.existsSync(appPath)) throw new Error(`missing Jobbot.app: ${appPath}`);
fs.mkdirSync(path.join(root, "release"), { recursive: true });
fs.mkdirSync(mediaOut, { recursive: true });

console.log("Creating tar.gz (symlinks preserved)…");
if (fs.existsSync(releaseTgz)) fs.unlinkSync(releaseTgz);
run("tar", ["-czf", releaseTgz, "Jobbot.app"], { cwd: appDir, stdio: "inherit" });

const fullSha = sha256File(releaseTgz);
const fullSize = fs.statSync(releaseTgz).size;
console.log(`Full tar.gz: ${fullSize} bytes  sha256=${fullSha}`);

const magic = fs.readFileSync(releaseTgz).subarray(0, 2);
if (magic[0] !== 0x1f || magic[1] !== 0x8b) {
  throw new Error(`not gzip magic: ${magic.toString("hex")}`);
}

console.log("tar -tzf (source)…");
run("tar", ["-tzf", releaseTgz], { stdio: "pipe" });

// Clean old zip AND tar parts in out dir
for (const f of fs.readdirSync(mediaOut)) {
  if (
    f.startsWith("Jobbot-0.1.0-mac-arm64.") ||
    f === "SHA256SUMS.txt" ||
    f.startsWith("Jobbot-mac.")
  ) {
    fs.unlinkSync(path.join(mediaOut, f));
  }
}

run("split", ["-b", PART_SIZE, "-d", releaseTgz, path.join(mediaOut, PART_PREFIX)], {
  stdio: "inherit",
});

const parts = fs
  .readdirSync(mediaOut)
  .filter((f) => f.startsWith(PART_PREFIX))
  .sort();
if (parts.length < 2) throw new Error(`expected multiple parts, got ${parts.join(",")}`);
console.log(
  "Parts:",
  parts.map((p) => `${p}(${fs.statSync(path.join(mediaOut, p)).size})`).join(", "),
);

const rejoined = path.join(mediaOut, "Jobbot-mac.roundtrip.tar.gz");
const outFd = fs.openSync(rejoined, "w");
for (const p of parts) {
  fs.writeSync(outFd, fs.readFileSync(path.join(mediaOut, p)));
}
fs.closeSync(outFd);

const rejoinSha = sha256File(rejoined);
if (rejoinSha !== fullSha) {
  throw new Error(`ROUND-TRIP SHA MISMATCH\n  src=${fullSha}\n  cat=${rejoinSha}`);
}
if (fs.statSync(rejoined).size !== fullSize) throw new Error("ROUND-TRIP SIZE MISMATCH");

console.log("tar -tzf (rejoined from parts)…");
const list = run("tar", ["-tzf", rejoined], { stdio: "pipe" });
if (!list.stdout.includes("Jobbot.app/")) {
  throw new Error("rejoined tar.gz missing Jobbot.app/");
}

// Smoke extract to temp
const extractDir = path.join(mediaOut, "_extract_test");
fs.rmSync(extractDir, { recursive: true, force: true });
fs.mkdirSync(extractDir, { recursive: true });
run("tar", ["-xzf", rejoined, "-C", extractDir], { stdio: "inherit" });
if (!fs.existsSync(path.join(extractDir, "Jobbot.app", "Contents", "MacOS", "Jobbot"))) {
  throw new Error("extract smoke failed — Jobbot binary missing");
}
fs.rmSync(extractDir, { recursive: true, force: true });
fs.unlinkSync(rejoined);

const lines = [
  `# Jobbot Mac arm64 — PRIMARY artifact is .tar.gz (not zip)`,
  `# After cat → Jobbot-mac.tar.gz`,
  `${fullSha}  Jobbot-mac.tar.gz`,
  `${fullSha}  Jobbot-0.1.0-mac-arm64.tar.gz`,
  ``,
];
for (const p of parts) {
  lines.push(`${sha256File(path.join(mediaOut, p))}  ${p}`);
}
lines.push("");
fs.writeFileSync(path.join(mediaOut, "SHA256SUMS.txt"), lines.join("\n"), "utf8");
fs.writeFileSync(
  path.join(root, "release", "Jobbot-0.1.0-mac-arm64.tar.gz.sha256"),
  `${fullSha}  Jobbot-0.1.0-mac-arm64.tar.gz\n`,
  "utf8",
);

console.log("OK — tar.gz parts verified (tar -tzf + extract smoke)");
console.log("FULL_SHA256=" + fullSha);
console.log("MEDIA_OUT=" + mediaOut);
console.log("ARTIFACT=tar.gz");
