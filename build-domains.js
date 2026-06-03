import fs from 'fs';
import path from 'path';
import os from 'os';

const fallbackDomains = [
  "circlejerk.app",
  "cyphzec.com",
  "jiggytom.com",
  "neofluxholdings.com",
  "open-think.app",
  "ordchard.com",
  "pourhub.app",
  "pouroverhub.com",
  "rpow2stats.com",
  "vaults.care",
  "whatismyiq.ai"
];

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

async function run() {
  const publicDir = path.join(process.cwd(), 'public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }
  const targetPath = path.join(publicDir, 'detected-domains.json');

  const token = getWranglerToken();
  if (!token) {
    console.log("No Wrangler token found, writing fallback domains list.");
    fs.writeFileSync(targetPath, JSON.stringify(fallbackDomains, null, 2));
    return;
  }

  try {
    let page = 1;
    let allZones = [];
    const fetchPage = async (p) => {
      const response = await fetch(`https://api.cloudflare.com/client/v4/zones?page=${p}&per_page=50`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      return await response.json();
    };
    const paginateAllZones = async () => {
      const data = await fetchPage(page);
      if (!data.success) {
        throw new Error(JSON.stringify(data.errors));
      }
      allZones = allZones.concat(data.result);
      const totalCount = data.result_info?.total_count || 0;
      const totalPages = Math.ceil(totalCount / 50);
      if (page < totalPages && data.result.length > 0) {
        page++;
        await paginateAllZones();
      }
    };
    await paginateAllZones();
    const domains = allZones.map(z => z.name);
    console.log(`Successfully fetched ${domains.length} domains from Cloudflare.`);
    fs.writeFileSync(targetPath, JSON.stringify(domains, null, 2));
  } catch (err) {
    console.error("Error fetching domains from Cloudflare, using fallback:", err.message);
    fs.writeFileSync(targetPath, JSON.stringify(fallbackDomains, null, 2));
  }
}

run();
