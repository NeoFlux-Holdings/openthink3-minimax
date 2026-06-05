#!/usr/bin/env node
// scripts/publish-build.mjs
//
// Uploads a dist/ folder to the worker's R2 bucket (builds/latest/*).
// After running this you can either:
//   1. Hit POST /api/cf/deploy/agent/:name/republish
//      to push the build to an existing agent's Pages project.
//   2. Hit POST /api/cf/deploy/agent (with a new name)
//      to provision a new agent using this build as the initial deploy.
//
// Usage:
//   node scripts/publish-build.mjs
//   node scripts/publish-build.mjs --dist ../path/to/dist
//   node scripts/publish-build.mjs --dist dist --worker https://openthink3-worker.thomas-zarebczan.workers.dev
//
// Auth: reads CF_API_TOKEN + CF_ACCOUNT_ID from .env (or pass --token/--account).

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { existsSync } from "node:fs";
import { config } from "dotenv";

const args = process.argv.slice(2);
const get = (flag, def) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : def;
};

const DIST = resolve(get("--dist", "dist"));
const WORKER = get("--worker", "https://openthink3-worker.thomas-zarebczan.workers.dev");

// Load .env from the project root (one level up from scripts/).
const ROOT = new URL("..", import.meta.url).pathname;
config({ path: join(ROOT, ".env") });
const TOKEN = get("--token", process.env.CF_API_TOKEN);
const ACCOUNT = get("--account", process.env.CF_ACCOUNT_ID || "5c7b9547d3e8e93f815ccb235fb5be8b");

if (!TOKEN) {
  console.error("CF_API_TOKEN is required. Set it in .env or pass --token.");
  process.exit(1);
}
if (!existsSync(DIST)) {
  console.error(`dist directory not found: ${DIST}`);
  console.error("Run your build first (npm run build).");
  process.exit(1);
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

console.log(`[publish-build] dist:   ${DIST}`);
console.log(`[publish-build] worker: ${WORKER}`);

const files = [];
for await (const f of walk(DIST)) {
  const rel = relative(DIST, f).split(sep).join("/");
  const buf = await readFile(f);
  files.push({ path: rel, content: buf, size: buf.byteLength });
  console.log(`  + ${rel} (${buf.byteLength} bytes)`);
}
if (files.length === 0) {
  console.error("No files in dist/.");
  process.exit(1);
}
console.log(`[publish-build] total: ${files.length} files, ${files.reduce((s, f) => s + f.size, 0)} bytes`);

const fd = new FormData();
for (const f of files) {
  // The worker reads the file's `.name` to determine the relative path.
  // We use a fresh File with the relative path as the filename.
  const blob = new Blob([f.content], { type: guessType(f.path) });
  fd.append("files", blob, f.path);
}

console.log(`[publish-build] POST ${WORKER}/api/cf/agent/publish-build ...`);
const r = await fetch(`${WORKER}/api/cf/agent/publish-build`, {
  method: "POST",
  headers: {
    "X-CF-Token": TOKEN,
    "X-CF-Account-Id": ACCOUNT,
  },
  body: fd,
});
const text = await r.text();
let body;
try { body = JSON.parse(text); } catch { body = { raw: text }; }
console.log(`[publish-build] status: ${r.status}`);
console.log(JSON.stringify(body, null, 2));
if (!r.ok) process.exit(1);

function guessType(p) {
  if (p.endsWith(".html")) return "text/html";
  if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript";
  if (p.endsWith(".css")) return "text/css";
  if (p.endsWith(".json")) return "application/json";
  if (p.endsWith(".svg")) return "image/svg+xml";
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".ico")) return "image/x-icon";
  if (p.endsWith(".woff")) return "font/woff";
  if (p.endsWith(".woff2")) return "font/woff2";
  if (p.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}
