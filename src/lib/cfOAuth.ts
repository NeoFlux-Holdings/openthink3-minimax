export type CfOAuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  accountId?: string;
  accountName?: string;
  email?: string;
};

const STORAGE_KEY = 'openthink_cf_oauth_v1';
const PENDING_KEY = 'openthink_cf_oauth_pending_v1';

export const CF_OAUTH_CONFIG = {
  clientId: '23e10929d8b4e594d8756f6e24b2578c',
  authorizeUrl: 'https://dash.cloudflare.com/oauth2/auth',
  tokenUrl: 'https://dash.cloudflare.com/oauth2/token',
  revokeUrl: 'https://dash.cloudflare.com/oauth2/revoke',
  userInfoUrl: 'https://dash.cloudflare.com/oauth2/userinfo',

  // ── Tier 1: account discovery + worker/Pages/KV/D1 deploy ──────────
  SCOPES_BASIC: [
    'account-settings.read',
    'user-details.read',
    'workers-scripts.read',
    'workers-scripts.write',
    'workers-routes.read',
    'workers-routes.write',
    'workers-kv-storage.read',
    'workers-kv-storage.write',
    'page.read',
    'page.write',
    'd1.write',
    'd1.metadata_read',
    'zone.read',
    'memberships.read',
    'offline_access',
  ] as const,

  // ── Tier 2: custom-domain subdomain deploy + SSL automation ────────
  SCOPES_DOMAIN: [
    'zone.write',
    'zone-settings.read',
    'zone-settings.write',
    'ssl-and-certificates.read',
    'ssl-and-certificates.write',
  ] as const,

  // ── Tier 3: full platform surface (R2 / Vectorize / Queues / AI / Tunnels) ──
  SCOPES_PLATFORM: [
    'vectorize.read',
    'vectorize.write',
    'workers-r2.read',
    'workers-r2.write',
    'workers-r2-bucket-item.read',
    'workers-r2-bucket-item.write',
    'queues.read',
    'queues.write',
    'pipelines.read',
    'pipelines.write',
    'pipelines.send',
    'ai.read',
    'ai.write',
    'workers-observability.read',
    'workers-tail.read',
    'workers-ci.read',
    'teams.read',
    'teams.write',
    'secrets-store.read',
    'secrets-store.write',
    'containers.read',
    'containers.write',
    'account-logs.read',
    'logs.read',
    'account-settings.write',
  ] as const,

  // Union — what gets registered on the OAuth client.
  scopes: [
    'account-settings.read',
    'account-settings.write',
    'user-details.read',
    'memberships.read',
    'workers-scripts.read',
    'workers-scripts.write',
    'workers-routes.read',
    'workers-routes.write',
    'workers-kv-storage.read',
    'workers-kv-storage.write',
    'page.read',
    'page.write',
    'd1.write',
    'd1.metadata_read',
    'zone.read',
    'zone.write',
    'zone-settings.read',
    'zone-settings.write',
    'ssl-and-certificates.read',
    'ssl-and-certificates.write',
    'vectorize.read',
    'vectorize.write',
    'workers-r2.read',
    'workers-r2.write',
    'workers-r2-bucket-item.read',
    'workers-r2-bucket-item.write',
    'queues.read',
    'queues.write',
    'pipelines.read',
    'pipelines.write',
    'pipelines.send',
    'ai.read',
    'ai.write',
    'workers-observability.read',
    'workers-tail.read',
    'workers-ci.read',
    'teams.read',
    'teams.write',
    'secrets-store.read',
    'secrets-store.write',
    'containers.read',
    'containers.write',
    'account-logs.read',
    'logs.read',
    'offline_access',
  ] as const,

  isConfigured(): boolean {
    return this.clientId.length > 0 && !this.clientId.startsWith('REPLACE_');
  },
};

export type AuthTier = 'basic' | 'domain' | 'platform' | 'full';

export function scopesForTier(tier: AuthTier): readonly string[] {
  const c = CF_OAUTH_CONFIG;
  switch (tier) {
    case 'basic':    return c.SCOPES_BASIC;
    case 'domain':   return [...c.SCOPES_BASIC, ...c.SCOPES_DOMAIN];
    case 'platform': return [...c.SCOPES_BASIC, ...c.SCOPES_DOMAIN, ...c.SCOPES_PLATFORM];
    case 'full':     return c.scopes;
  }
}

type PendingFlow = {
  verifier: string;
  state: string;
  redirectAfter: string;
  createdAt: number;
};

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomBase64Url(byteLen: number): string {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(digest);
}

export function getRedirectUri(origin: string = window.location.origin): string {
  return `${origin}/oauth/callback`;
}

export function getSession(): CfOAuthSession | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as CfOAuthSession; } catch { return null; }
}

export function setSession(s: CfOAuthSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

function getPending(): PendingFlow | null {
  const raw = sessionStorage.getItem(PENDING_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as PendingFlow; } catch { return null; }
}

function setPending(p: PendingFlow): void {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(p));
}

function clearPending(): void {
  sessionStorage.removeItem(PENDING_KEY);
}

export async function beginAuthorize(redirectAfter: string = '/app', tier: AuthTier = 'basic'): Promise<void> {
  if (!CF_OAUTH_CONFIG.isConfigured()) {
    throw new Error(
      'CF_OAUTH_CLIENT_ID not set. Create a Cloudflare OAuth client (Manage Account → OAuth clients) and paste its Client ID into src/lib/cfOAuth.ts.'
    );
  }
  const verifier = randomBase64Url(48);
  const challenge = await sha256Base64Url(verifier);
  const state = randomBase64Url(24);
  setPending({ verifier, state, redirectAfter, createdAt: Date.now() });

  const url = new URL(CF_OAUTH_CONFIG.authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CF_OAUTH_CONFIG.clientId);
  url.searchParams.set('redirect_uri', getRedirectUri());
  url.searchParams.set('scope', scopesForTier(tier).join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  window.location.href = url.toString();
}

export type CallbackResult = {
  ok: boolean;
  redirectTo?: string;
  error?: string;
  description?: string;
};

export async function handleCallback(search: string = window.location.search): Promise<CallbackResult> {
  const params = new URLSearchParams(search);
  const error = params.get('error');
  if (error) {
    return { ok: false, error, description: params.get('error_description') ?? undefined };
  }
  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) {
    return { ok: false, error: 'invalid_callback', description: 'Missing code or state' };
  }
  const pending = getPending();
  if (!pending) {
    return { ok: false, error: 'no_pending_flow', description: 'No in-progress OAuth flow in this session. Please try again.' };
  }
  if (pending.state !== state) {
    clearPending();
    return { ok: false, error: 'state_mismatch', description: 'OAuth state mismatch — possible CSRF. Please retry.' };
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: CF_OAUTH_CONFIG.clientId,
    redirect_uri: getRedirectUri(),
    code_verifier: pending.verifier,
  });

  const res = await fetch(CF_OAUTH_CONFIG.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    clearPending();
    return { ok: false, error: data.error ?? 'token_exchange_failed', description: data.error_description ?? `HTTP ${res.status}` };
  }

  const session: CfOAuthSession = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    scope: data.scope ?? CF_OAUTH_CONFIG.scopes.join(' '),
  };

  try {
    const user = await fetchUserInfo(session.accessToken);
    session.email = user.email;
    session.accountId = user.accountId;
    session.accountName = user.accountName;
  } catch {
    // Non-fatal; user info fetch can fail in some envs.
  }

  setSession(session);
  const redirectTo = pending.redirectAfter;
  clearPending();
  return { ok: true, redirectTo };
}

type UserInfo = { email?: string; accountId?: string; accountName?: string };

// CF's userinfo + /accounts endpoints don't return CORS headers, so we must
// proxy through our worker. The worker does the fetch server-side (no CORS),
// then returns the data to the SPA with our own CORS headers.
async function proxyUserInfo(accessToken: string, path: string): Promise<any | null> {
  try {
    const apiBase = (typeof window !== 'undefined' && localStorage.getItem('openthink_api_url'))
      || (typeof window !== 'undefined' ? window.location.origin : '');
    const r = await fetch(`${apiBase}/api/cf/proxy/${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export async function fetchUserInfo(accessToken: string): Promise<UserInfo> {
  const out: UserInfo = {};
  const info = await proxyUserInfo(accessToken, 'userinfo');
  if (info) {
    out.email = info.email;
    out.accountId = info.account_id ?? info.sub;
  }
  const accounts = await proxyUserInfo(accessToken, 'accounts');
  const a = accounts?.result?.[0];
  if (a) {
    out.accountId = out.accountId ?? a.id;
    out.accountName = a.name;
  }
  return out;
}

export async function refreshSession(): Promise<CfOAuthSession | null> {
  const s = getSession();
  if (!s?.refreshToken) return null;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: s.refreshToken,
    client_id: CF_OAUTH_CONFIG.clientId,
  });
  const r = await fetch(CF_OAUTH_CONFIG.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await r.json();
  if (!r.ok || data.error) {
    clearSession();
    return null;
  }
  const next: CfOAuthSession = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? s.refreshToken,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    scope: data.scope ?? s.scope,
    accountId: s.accountId,
    accountName: s.accountName,
    email: s.email,
  };
  setSession(next);
  return next;
}

export async function getValidAccessToken(): Promise<string | null> {
  const s = getSession();
  if (!s) return null;
  if (Date.now() < s.expiresAt - 30_000) return s.accessToken;
  const next = await refreshSession();
  return next?.accessToken ?? null;
}

export async function revokeAndSignOut(): Promise<void> {
  const s = getSession();
  if (s?.accessToken) {
    try {
      await fetch(CF_OAUTH_CONFIG.revokeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: s.accessToken, client_id: CF_OAUTH_CONFIG.clientId }).toString(),
      });
    } catch { /* ignore */ }
  }
  clearSession();
}
