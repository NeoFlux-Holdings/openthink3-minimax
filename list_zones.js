// SECURITY: tokens must NEVER be committed to the repo. This script reads
// from the local Wrangler config (same source as build-domains.js) and
// surfaces a clear error if no token is present. If you need a one-off
// manual check, use the CLOUDFLARE_API_TOKEN environment variable.
//
//   CLOUDFLARE_API_TOKEN=… node list_zones.js
//
// In production, all Cloudflare API calls go through the worker's
// /api/cf/* endpoints using the worker-stored CF_API_TOKEN secret.

const fs = require('fs');
const os = require('os');
const path = require('path');

function getToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  try {
    const home = os.homedir();
    const winPath = path.join(process.env.APPDATA || '', '.wrangler', 'config', 'default.toml');
    const nixPath = path.join(home, '.config', '.wrangler', 'config', 'default.toml');
    const configPath = fs.existsSync(winPath) ? winPath : nixPath;
    if (!fs.existsSync(configPath)) return null;
    const content = fs.readFileSync(configPath, 'utf8');
    const m = content.match(/oauth_token\s*=\s*"([^"]+)"/);
    return m ? m[1] : null;
  } catch { return null; }
}

const token = getToken();
if (!token) {
  console.error("No Cloudflare token found. Set CLOUDFLARE_API_TOKEN or run `wrangler login`.");
  process.exit(1);
}

fetch("https://api.cloudflare.com/client/v4/zones", {
  headers: { "Authorization": `Bearer ${token}` }
})
.then(res => res.json())
.then(data => {
  if (data.success) {
    const domains = data.result.map(z => z.name);
    console.log(JSON.stringify(domains));
  } else {
    console.error("API error:", data.errors);
    process.exit(1);
  }
})
.catch(err => { console.error(err); process.exit(1); });
