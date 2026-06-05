#!/usr/bin/env node
// Reads .env from the project root, reads the PEM file at
// GITHUB_PRIVATE_KEY_FILE, and writes worker/.dev.vars for `wrangler dev`.
// Idempotent: run it again after editing .env to refresh the local secrets.

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const envPath = resolve(root, '.env');
const devVarsPath = resolve(root, 'worker', '.dev.vars');

if (!existsSync(envPath)) {
  console.error(`No .env found at ${envPath}. Create one (see .env.example if present) and re-run.`);
  process.exit(1);
}

const raw = readFileSync(envPath, 'utf8');
const env = Object.create(null);
for (const line of raw.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq < 0) continue;
  const key = trimmed.slice(0, eq).trim();
  let val = trimmed.slice(eq + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  env[key] = val;
}

const wanted = [
  'GITHUB_APP_ID',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GITHUB_WEBHOOK_SECRET',
  'SESSION_SECRET',
  'CF_API_TOKEN',
  'GH_TOKEN',
  'OAUTH_CLIENT_ID',
  'GITHUB_INSTALL_TOKEN_KEY',
];

const out = [];
const missing = [];
for (const k of wanted) {
  if (env[k]) out.push(`${k}="${env[k].replace(/"/g, '\\"')}"`);
}
if (env.GITHUB_PRIVATE_KEY_FILE) {
  const pemPath = resolve(env.GITHUB_PRIVATE_KEY_FILE);
  if (!existsSync(pemPath)) {
    console.error(`GITHUB_PRIVATE_KEY_FILE points at ${pemPath} but the file does not exist.`);
    process.exit(1);
  }
  const pem = readFileSync(pemPath, 'utf8');
  if (!/-----BEGIN [A-Z ]+-----/.test(pem)) {
    console.error(`File at ${pemPath} does not look like a PEM (missing BEGIN header).`);
    process.exit(1);
  }
  out.push(`GITHUB_APP_PRIVATE_KEY=${JSON.stringify(pem)}`);
  console.log(`  GITHUB_APP_PRIVATE_KEY <- ${pemPath} (${statSync(pemPath).size} bytes)`);
} else if (env.GITHUB_APP_PRIVATE_KEY) {
  out.push(`GITHUB_APP_PRIVATE_KEY=${JSON.stringify(env.GITHUB_APP_PRIVATE_KEY)}`);
} else {
  missing.push('GITHUB_PRIVATE_KEY_FILE (or GITHUB_APP_PRIVATE_KEY)');
}

for (const k of wanted) {
  if (env[k]) console.log(`  ${k} = ${'*'.repeat(Math.min(env[k].length, 8))}`);
}

if (missing.length > 0) {
  console.error(`\nMissing keys: ${missing.join(', ')}`);
  process.exit(1);
}

writeFileSync(devVarsPath, out.join('\n') + '\n', 'utf8');
console.log(`\nWrote ${out.length} entries to ${devVarsPath}`);
console.log('Run `cd worker && npx wrangler dev` to start the worker with these secrets.');
