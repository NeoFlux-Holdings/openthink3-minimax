import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'

function getWranglerToken() {
  try {
    const home = os.homedir();
    const configPath = path.join(home, 'AppData', 'Roaming', 'xdg.config', '.wrangler', 'config', 'default.toml');
    if (!fs.existsSync(configPath)) {
      return null;
    }
    const content = fs.readFileSync(configPath, 'utf8');
    const match = content.match(/oauth_token\s*=\s*"([^"]+)"/);
    return match ? match[1] : null;
  } catch (err) {
    return null;
  }
}

function getBearerFromRequest(req: any): string | null {
  const h = req.headers?.authorization || req.headers?.Authorization;
  if (typeof h === 'string' && h.toLowerCase().startsWith('bearer ')) {
    return h.slice(7).trim();
  }
  return null;
}

function resolveCfToken(req: any): { token: string; source: 'oauth' | 'wrangler' } | null {
  const bearer = getBearerFromRequest(req);
  if (bearer) return { token: bearer, source: 'oauth' };
  const w = getWranglerToken();
  if (w) return { token: w, source: 'wrangler' };
  return null;
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'cloudflare-orchestrator-api',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url === '/api/cloudflare-zones') {
            try {
              const auth = resolveCfToken(req);
              if (!auth) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'No Cloudflare credentials. Sign in with Cloudflare or run `wrangler login`.' }));
                return;
              }
              let page = 1;
              let allZones: any[] = [];
              while (true) {
                const response = await fetch(`https://api.cloudflare.com/client/v4/zones?page=${page}&per_page=50`, {
                  headers: {
                    'Authorization': `Bearer ${auth.token}`
                  }
                });
                const data = await response.json() as any;
                if (!data.success) {
                  throw new Error(JSON.stringify(data.errors));
                }
                allZones = allZones.concat(data.result);
                const totalCount = data.result_info?.total_count || 0;
                const totalPages = Math.ceil(totalCount / 50);
                if (page >= totalPages || data.result.length === 0) {
                  break;
                }
                page++;
              }
              const domains = allZones.map((z: any) => z.name);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ domains, source: auth.source }));
            } catch (err: any) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message }));
            }
            return;
          }

          if (req.url === '/api/cloudflare-attach-domain' && req.method === 'POST') {
            const sendJson = (status: number, body: any) => {
              res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
              res.end(JSON.stringify(body));
            };
            try {
              const auth = resolveCfToken(req);
              if (!auth) return sendJson(503, { error: 'No Cloudflare credentials. Sign in with Cloudflare or run `wrangler login`.' });
              let body: any = {};
              try {
                const chunks: Buffer[] = [];
                for await (const chunk of req) chunks.push(chunk);
                body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
              } catch {
                return sendJson(400, { error: 'Invalid JSON body' });
              }
              const target = (body.domain || '').trim().toLowerCase();
              if (!target) return sendJson(400, { error: 'domain is required' });

              // Find the zone that is a suffix of the target.
              const allZones: any[] = [];
              let page = 1;
              while (true) {
                const r = await fetch(`https://api.cloudflare.com/client/v4/zones?page=${page}&per_page=50`, {
                  headers: { Authorization: `Bearer ${auth.token}` },
                });
                const d = await r.json() as any;
                if (!d.success) return sendJson(502, { error: JSON.stringify(d.errors) });
                allZones.push(...d.result);
                const totalPages = Math.ceil((d.result_info?.total_count || 0) / 50);
                if (page >= totalPages || d.result.length === 0) break;
                page++;
              }
              const zone = allZones.find(z => target === z.name || target.endsWith('.' + z.name));
              if (!zone) return sendJson(404, { error: `No Cloudflare zone found for ${target}. Add the domain to Cloudflare first.` });

              // Create or update the worker route.
              const pattern = `${target}/*`;
              const routeRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone.id}/workers/routes`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ pattern, script: 'openthink3-worker' }),
              });
              const routeData = await routeRes.json() as any;
              if (!routeData.success) {
                // Idempotent: if the route already exists, that's fine.
                const msg = JSON.stringify(routeData.errors || {});
                if (/already exists|duplicate/i.test(msg)) {
                  return sendJson(200, { url: `https://${target}`, note: 'route already existed' });
                }
                return sendJson(502, { error: msg });
              }
              return sendJson(200, { url: `https://${target}`, route: routeData.result });
            } catch (err: any) {
              return sendJson(500, { error: err.message });
            }
          }

          if (req.url === '/api/deploy') {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
              'Access-Control-Allow-Origin': '*'
            });

            const sendLog = (message: string) => {
              res.write(`data: ${JSON.stringify({ log: message })}\n\n`);
            };

            const runCommand = (cmd: string, args: string[], cwd: string): Promise<void> => {
              return new Promise((resolve, reject) => {
                sendLog(`Running: ${cmd} ${args.join(' ')}`);
                const child = spawn(cmd, args, { cwd, shell: true });
                child.stdout.on('data', (data) => {
                  sendLog(data.toString().trim());
                });
                child.stderr.on('data', (data) => {
                  sendLog(`[Stderr] ${data.toString().trim()}`);
                });
                child.on('close', (code) => {
                  if (code === 0) {
                    resolve();
                  } else {
                    reject(new Error(`Command failed with exit code ${code}`));
                  }
                });
              });
            };

            try {
              sendLog("🚀 Starting real-time infrastructure deployment to Cloudflare...");
              
              const workerPath = path.join(process.cwd(), 'worker');
              sendLog("Step 1: Deploying Cloudflare Worker 'openthink3-worker'...");
              await runCommand('npx', ['wrangler', 'deploy'], workerPath);
              
              sendLog("Step 2: Building React production assets...");
              await runCommand('npm', ['run', 'build'], process.cwd());

              sendLog("Step 3: Deploying static files to Cloudflare Pages 'openthink-harness'...");
              await runCommand('npx', ['wrangler', 'pages', 'deploy', 'dist', '--project-name=openthink-harness'], process.cwd());

              res.write(`data: ${JSON.stringify({ status: 'success' })}\n\n`);
              res.end();
            } catch (err: any) {
              res.write(`data: ${JSON.stringify({ status: 'error', error: err.message })}\n\n`);
              res.end();
            }
            return;
          }

          next();
        });
      }
    }
  ],
})
