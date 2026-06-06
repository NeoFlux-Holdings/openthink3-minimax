#!/usr/bin/env node
// scripts/setup-gh-platform.mjs
//
// One-time operator setup: install open-think-auth on NeoFlux-Holdings
// (via the GitHub web UI), then run this CLI. The worker mints a
// platform installation token using its own App private key, encrypts
// it with GITHUB_INSTALL_TOKEN_KEY, and stores it at
// `gh:install:token:platform` in ARTIFACTS. After this, deploy/agent
// works in "platform" mode without requiring the end user to install
// the App.
//
// Usage:
//   node scripts/setup-gh-platform.mjs
//   node scripts/setup-gh-platform.mjs --org MyOrg
//
// Requirements:
//   - The operator is a NeoFlux-Holdings owner
//   - open-think-auth is installed on NeoFlux-Holdings (visit
//     https://github.com/apps/open-think-auth/installations/new once)
//   - A GitHub PAT from the operator with admin:org:read (so the
//     worker can list the org's installations). Add to .env as
//     GITHUB_OPERATOR_PAT.

import { config } from "dotenv";
import { join } from "node:path";

const args = process.argv.slice(2);
const get = (flag, def) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : def;
};

const ROOT = new URL("..", import.meta.url).pathname;
config({ path: join(ROOT, ".env") });

const OPERATOR_PAT = get("--pat", process.env.GITHUB_OPERATOR_PAT);
const ORG = get("--org", "NeoFlux-Holdings");
const WORKER = get("--worker", "https://openthink3-worker.thomas-zarebczan.workers.dev");

if (!OPERATOR_PAT) {
  console.error("GITHUB_OPERATOR_PAT required (set in .env or pass --pat).");
  console.error("Create a PAT at https://github.com/settings/tokens with admin:org:read scope.");
  process.exit(1);
}

console.log(`[setup] Org:    ${ORG}`);
console.log(`[setup] Worker: ${WORKER}`);

const resp = await fetch(`${WORKER}/api/cf/github/platform/setup`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Operator-Pat": OPERATOR_PAT,
  },
  body: JSON.stringify({ org: ORG }),
});
const text = await resp.text();
let body;
try { body = JSON.parse(text); } catch { body = { raw: text }; }
console.log(`[setup] status: ${resp.status}`);
console.log(JSON.stringify(body, null, 2));
if (!resp.ok) process.exit(1);

if (body.ok) {
  console.log(`[setup] Done. Platform mode is now active.`);
  console.log(`[setup] New agents created via /api/cf/deploy/agent will use the platform token automatically.`);
  console.log(`[setup] Token expires at: ${body.expiresAt}`);
}
