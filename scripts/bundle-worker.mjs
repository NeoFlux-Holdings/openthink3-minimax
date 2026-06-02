#!/usr/bin/env node
/**
 * Bundle the Cloudflare Worker source into a single self-contained JS file
 * that can be served as a static asset, stored in KV, and pushed to the
 * Cloudflare API as the worker's `script` content.
 *
 * Output:
 *   public/worker-bundle.js   (the bundled worker code, ready for deploy)
 *   public/worker-bundle.meta.json   (size, sha, build time)
 *
 * Invoked by `npm run build` in the frontend package.json. Safe to re-run.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const WORKER_DIR = join(ROOT, 'worker');
const PUBLIC_DIR = join(ROOT, 'public');
const OUT_FILE = join(PUBLIC_DIR, 'worker-bundle.js');
const META_FILE = join(PUBLIC_DIR, 'worker-bundle.meta.json');

function runWrangler() {
  // Wrangler's --outfile bundles via its internal esbuild, applying the
  // worker's wrangler.toml (compatibility flags, etc.) and stripping
  // nodejs-compat-incompatible APIs. Runs in --dry-run so no deploy happens.
  const args = [
    'wrangler', 'deploy',
    '--dry-run',
    '--outfile', OUT_FILE,
    '--compatibility-date', '2024-09-23',
    '--compatibility-flags', 'nodejs_compat',
  ];
  // Windows shells use npx.cmd, *nix uses npx
  const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  execFileSync(npxBin, args, { cwd: WORKER_DIR, stdio: 'inherit', shell: process.platform === 'win32' });
}

function sha256(path) {
  const h = createHash('sha256');
  h.update(readFileSync(path));
  return h.digest('hex');
}

function main() {
  if (!existsSync(PUBLIC_DIR)) {
    mkdirSync(PUBLIC_DIR, { recursive: true });
  }
  console.log('[bundle-worker] running wrangler --outfile …');
  runWrangler();

  if (!existsSync(OUT_FILE)) {
    throw new Error(`Wrangler did not produce ${OUT_FILE}`);
  }

  const stat = statSync(OUT_FILE);
  const sha = sha256(OUT_FILE);
  const meta = {
    path: 'worker-bundle.js',
    bytes: stat.size,
    sha256: sha,
    builtAt: new Date().toISOString(),
    workerDir: 'worker',
  };
  writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
  console.log(`[bundle-worker] wrote ${OUT_FILE} (${(stat.size / 1024).toFixed(1)} KB)`);
  console.log(`[bundle-worker] sha256: ${sha}`);
  console.log(`[bundle-worker] meta:   ${META_FILE}`);
}

main();
