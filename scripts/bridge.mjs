#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';

function parseArgs(argv) {
  const out = { port: 3000, server: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') {
      const n = parseInt(argv[++i], 10);
      if (!Number.isNaN(n)) out.port = n;
    } else if (a === '--server' || a === '-s') {
      out.server = argv[++i];
    }
  }
  return out;
}

function findOnPath(cmd) {
  return new Promise((resolve) => {
    const finder = process.platform === 'win32' ? 'where.exe' : 'which';
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    let p;
    try {
      p = spawn(finder, [cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      finish(null);
      return;
    }
    let buf = '';
    p.stdout.on('data', (d) => { buf += d.toString(); });
    p.on('error', () => finish(null));
    p.on('close', (code) => {
      if (code !== 0) return finish(null);
      const first = buf.split(/\r?\n/).map((s) => s.trim()).find((s) => s.length > 0);
      finish(first || null);
    });
  });
}

function locateCloudflared() {
  const env = process.env;
  const exeName = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const candidates = [];
  if (process.platform === 'win32') {
    if (env.LOCALAPPDATA) candidates.push(`${env.LOCALAPPDATA}\\cloudflared\\${exeName}`);
    if (env.LOCALAPPDATA) candidates.push(`${env.LOCALAPPDATA}\\Programs\\cloudflared\\${exeName}`);
    if (env.PROGRAMFILES) candidates.push(`${env.PROGRAMFILES}\\cloudflared\\${exeName}`);
    if (env['ProgramFiles(x86)']) candidates.push(`${env['ProgramFiles(x86)']}\\cloudflared\\${exeName}`);
  } else if (process.platform === 'darwin') {
    candidates.push('/usr/local/bin/cloudflared', '/opt/homebrew/bin/cloudflared');
  } else {
    candidates.push(
      '/usr/local/bin/cloudflared',
      '/usr/bin/cloudflared',
      `${env.HOME || ''}/.local/bin/cloudflared`
    );
  }
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return null;
}

function installHint() {
  if (process.platform === 'win32') {
    return [
      '  winget install Cloudflare.cloudflared',
      '  choco install cloudflared',
      '  scoop install cloudflared',
      '  or download: https://github.com/cloudflare/cloudflared/releases',
    ].join('\n');
  }
  return [
    '  curl -fsSL https://pkg.cloudflare.com/cloudflared | bash',
    '  brew install cloudflared                (macOS)',
    '  sudo apt install cloudflared            (Debian/Ubuntu, if repo available)',
    '  or download: https://github.com/cloudflare/cloudflared/releases',
  ].join('\n');
}

async function findCloudflared() {
  const fromPath = await findOnPath('cloudflared');
  if (fromPath) return fromPath;
  return locateCloudflared();
}

const URL_PATTERN = /https?:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

function forwardSignal(child, signal) {
  if (!child || child.killed || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      child.kill();
    } else {
      child.kill(signal);
    }
  } catch {}
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.server) {
    process.stderr.write('Usage: node scripts/bridge.mjs --port 3000 --server "<mcp server command>"\n');
    process.exit(2);
  }

  const cloudflared = await findCloudflared();
  if (!cloudflared) {
    process.stderr.write('[bridge] cloudflared not found on PATH.\n');
    process.stderr.write('Install one of:\n');
    process.stderr.write(`${installHint()}\n`);
    process.exit(1);
  }

  process.stdout.write(`[bridge] cloudflared: ${cloudflared}\n`);
  process.stdout.write(`[bridge] starting MCP server: ${args.server}\n`);

  const mcp = spawn(args.server, { shell: true, stdio: 'inherit' });
  mcp.on('error', (err) => {
    process.stderr.write(`[bridge] failed to start MCP server: ${err.message}\n`);
  });

  const tunnelArgs = ['tunnel', '--url', `http://localhost:${args.port}`, '--no-autoupdate'];
  process.stdout.write(`[bridge] starting cloudflared tunnel -> http://localhost:${args.port}\n`);

  const tunnel = spawn(cloudflared, tunnelArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  tunnel.on('error', (err) => {
    process.stderr.write(`[bridge] failed to start cloudflared: ${err.message}\n`);
  });

  let announced = false;
  const rl = createInterface({ input: tunnel.stdout });
  rl.on('line', (line) => {
    process.stdout.write(`[cloudflared] ${line}\n`);
    if (!announced) {
      const m = line.match(URL_PATTERN);
      if (m) {
        announced = true;
        process.stdout.write(`\n[bridge] Paste this in OpenThink: ${m[0]}\n\n`);
      }
    }
  });
  tunnel.stderr.on('data', (chunk) => {
    process.stderr.write(`[cloudflared] ${chunk}`);
  });

  let shuttingDown = false;
  const cleanup = (reason) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`\n[bridge] ${reason}, shutting down children…\n`);
    forwardSignal(mcp, 'SIGINT');
    forwardSignal(tunnel, 'SIGINT');
    const timer = setTimeout(() => process.exit(0), 750);
    timer.unref();
  };

  process.on('SIGINT', () => cleanup('received SIGINT'));
  process.on('SIGTERM', () => cleanup('received SIGTERM'));

  mcp.on('exit', (code, sig) => {
    process.stdout.write(`[bridge] MCP server exited (code=${code}${sig ? ` signal=${sig}` : ''})\n`);
    cleanup('MCP server exited');
  });
  tunnel.on('exit', (code, sig) => {
    process.stdout.write(`[bridge] cloudflared exited (code=${code}${sig ? ` signal=${sig}` : ''})\n`);
    cleanup('cloudflared exited');
  });
}

main().catch((err) => {
  const msg = err && err.message ? err.message : String(err);
  process.stderr.write(`[bridge] fatal: ${msg}\n`);
  process.exit(1);
});
