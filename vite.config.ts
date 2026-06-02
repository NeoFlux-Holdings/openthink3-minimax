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
              const token = getWranglerToken();
              if (!token) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'No wrangler token found' }));
                return;
              }
              let page = 1;
              let allZones: any[] = [];
              while (true) {
                const response = await fetch(`https://api.cloudflare.com/client/v4/zones?page=${page}&per_page=50`, {
                  headers: {
                    'Authorization': `Bearer ${token}`
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
              res.end(JSON.stringify({ domains }));
            } catch (err: any) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message }));
            }
            return;
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
