// ──────────────────────────────────────────────────────────────────────────
// Worker-side OAuth flow for gating the deployed agent's /api/* surface.
//
// Flow (PKCE, public client, no client_secret):
//   1. GET  /auth/login?next=...   → 302 to CF authorize URL with PKCE challenge
//   2. CF   /oauth2/auth           → user consents
//   3. GET  /auth/callback?code=&state=&next=... → exchange code, set signed cookie
//   4. GET  /api/auth/status       → returns { authenticated, user, expiresAt } or 401
//   5. POST /auth/logout           → revoke token, clear cookie
//
// Session cookie format: base64url(JSON({sub, email, accountId, exp, scope})) + "." + base64url(HMAC-SHA256(secret, payload))
//
// The cookie is set on the worker's own host (openthink3-worker.workers.dev)
// and is sent by the browser whenever the SPA calls /api/* — same as the
// existing dev / cf-creds cross-origin pattern.
// ──────────────────────────────────────────────────────────────────────────

export interface Session {
  sub: string;
  email?: string;
  accountId?: string;
  accountName?: string;
  scope: string;
  exp: number;
  iat: number;
}

const COOKIE_NAME = 'ot_session';
const PENDING_TTL_SECONDS = 600; // 10 min
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

const AGENT_SCOPES = ['user:read', 'account:read', 'offline_access'];

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(bytes: ArrayBuffer | Uint8Array | string): string {
  let bin: string;
  if (typeof bytes === 'string') {
    bin = bytes;
  } else {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = '';
    for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    bin = s;
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return new Uint8Array(sig);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function generateRandom(byteLen: number): string {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return b64urlEncode(bytes);
}

export function isOAuthConfigured(env: Env): boolean {
  return !!(env.OAUTH_CLIENT_ID && env.SESSION_SECRET);
}

export function isCustomDomainRequest(request: Request, env: Env): boolean {
  const host = (request.headers.get('Host') || new URL(request.url).host).toLowerCase();
  const def = (env.WORKER_DEFAULT_HOST || '').toLowerCase();
  if (!def) return false;
  if (host === def) return false;
  if (host.endsWith('.' + def)) return false;
  // Local dev (Vite 5173, wrangler dev 8787) bypasses the gate.
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) return false;
  return true;
}

export function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get('Cookie') || '';
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function buildSessionCookie(value: string, maxAgeSeconds: number, requestUrl: string): string {
  const host = new URL(requestUrl).hostname;
  // Set cookie without Domain= so the browser scopes it to the worker's host.
  // SameSite=None + Secure is required for cross-origin (deployed agent) calls.
  const secure = !host.includes('localhost') && !host.startsWith('127.');
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${maxAgeSeconds}`,
    `SameSite=${secure ? 'None' : 'Lax'}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearCookie(requestUrl: string): string {
  const host = new URL(requestUrl).hostname;
  const secure = !host.includes('localhost') && !host.startsWith('127.');
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
    `SameSite=${secure ? 'None' : 'Lax'}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export async function signSession(secret: string, session: Session): Promise<string> {
  const payload = b64urlEncode(JSON.stringify(session));
  const sig = await hmacSha256(secret, payload);
  return `${payload}.${b64urlEncode(sig)}`;
}

export async function verifySession(secret: string, token: string | null | undefined): Promise<Session | null> {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  const expected = await hmacSha256(secret, payload);
  let provided: Uint8Array;
  try { provided = b64urlDecode(sigB64); } catch { return null; }
  if (!timingSafeEqual(expected, provided)) return null;
  let session: Session;
  try { session = JSON.parse(dec.decode(b64urlDecode(payload))); } catch { return null; }
  if (!session || typeof session.exp !== 'number' || session.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return session;
}

function corsHeadersForAuth(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function jsonAuth(body: any, status: number, request: Request, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeadersForAuth(request), ...extraHeaders },
  });
}

function redirect(location: string, request: Request, extraHeaders: Record<string, string> = {}): Response {
  return new Response(null, {
    status: 302,
    headers: { 'Location': location, ...corsHeadersForAuth(request), ...extraHeaders },
  });
}

// ── GET /auth/login?next=... ──────────────────────────────────────────────
export async function handleAuthLogin(request: Request, env: Env): Promise<Response> {
  if (!isOAuthConfigured(env)) {
    return jsonAuth({ error: 'oauth_not_configured', description: 'Set OAUTH_CLIENT_ID and SESSION_SECRET via `wrangler secret put`.' }, 503, request);
  }
  const url = new URL(request.url);
  const next = (url.searchParams.get('next') || '/app');

  const verifier = generateRandom(48);
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(verifier));
  const codeChallenge = b64urlEncode(digest);

  const state = generateRandom(24);
  await env.ARTIFACTS.put(
    `oauth:pending:${state}`,
    JSON.stringify({ verifier, next, createdAt: Date.now() }),
    { expirationTtl: PENDING_TTL_SECONDS }
  );

  const authorize = new URL(env.OAUTH_AUTHORIZE_URL || 'https://dash.cloudflare.com/oauth2/auth');
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', env.OAUTH_CLIENT_ID!);
  authorize.searchParams.set('redirect_uri', `${url.origin}/auth/callback`);
  authorize.searchParams.set('scope', AGENT_SCOPES.join(' '));
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('code_challenge', codeChallenge);
  authorize.searchParams.set('code_challenge_method', 'S256');
  return redirect(authorize.toString(), request);
}

// ── GET /auth/callback?code=...&state=...&next=... ────────────────────────
export async function handleAuthCallback(request: Request, env: Env): Promise<Response> {
  if (!isOAuthConfigured(env)) {
    return jsonAuth({ error: 'oauth_not_configured' }, 503, request);
  }
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const nextParam = url.searchParams.get('next');
  if (!code || !state) {
    return jsonAuth({ error: 'invalid_callback', description: 'Missing code or state' }, 400, request);
  }
  const pendingRaw = await env.ARTIFACTS.get(`oauth:pending:${state}`);
  if (!pendingRaw) {
    return jsonAuth({ error: 'state_expired', description: 'Login flow expired. Please try again.' }, 400, request);
  }
  let pending: { verifier: string; next: string; createdAt: number };
  try { pending = JSON.parse(pendingRaw); } catch { pending = { verifier: '', next: '/app', createdAt: 0 }; }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: env.OAUTH_CLIENT_ID!,
    redirect_uri: `${url.origin}/auth/callback`,
    code_verifier: pending.verifier,
  });
  const tokenRes = await fetch(env.OAUTH_TOKEN_URL || 'https://dash.cloudflare.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const tokenData = await tokenRes.json() as any;
  if (!tokenRes.ok || tokenData.error) {
    return jsonAuth({ error: tokenData.error ?? 'token_exchange_failed', description: tokenData.error_description ?? `HTTP ${tokenRes.status}` }, 400, request);
  }
  await env.ARTIFACTS.delete(`oauth:pending:${state}`);

  // Pull user info + first account.
  let email: string | undefined;
  let accountId: string | undefined;
  let accountName: string | undefined;
  try {
    const ui = await fetch(env.OAUTH_USERINFO_URL || 'https://dash.cloudflare.com/oauth2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (ui.ok) {
      const j = await ui.json() as any;
      email = j.email;
      accountId = j.account_id ?? j.sub;
    }
  } catch { /* ignore */ }
  try {
    const ar = await fetch('https://api.cloudflare.com/client/v4/accounts', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (ar.ok) {
      const j = await ar.json() as any;
      const a = (j.result ?? [])[0];
      if (a) {
        accountId = accountId ?? a.id;
        accountName = a.name;
      }
    }
  } catch { /* ignore */ }

  const nowSec = Math.floor(Date.now() / 1000);
  const session: Session = {
    sub: accountId ?? email ?? state,
    email,
    accountId,
    accountName,
    scope: tokenData.scope ?? AGENT_SCOPES.join(' '),
    iat: nowSec,
    exp: nowSec + SESSION_TTL_SECONDS,
  };

  // Persist refresh token server-side, keyed by session sub, so we can rotate
  // the access token without re-prompting the user.
  if (tokenData.refresh_token) {
    await env.ARTIFACTS.put(
      `oauth:refresh:${session.sub}`,
      JSON.stringify({ refresh_token: tokenData.refresh_token, scope: session.scope, accountId, accountName, email }),
      { expirationTtl: 60 * 60 * 24 * 30 }
    );
  }

  const cookieValue = await signSession(env.SESSION_SECRET!, session);
  const cookie = buildSessionCookie(cookieValue, SESSION_TTL_SECONDS, request.url);
  const target = sanitizeNext(nextParam || pending.next || '/app');
  return redirect(target, request, { 'Set-Cookie': cookie });
}

function sanitizeNext(n: string): string {
  if (!n.startsWith('/') || n.startsWith('//')) return '/app';
  return n;
}

// ── GET /api/auth/status ──────────────────────────────────────────────────
export async function handleAuthStatus(request: Request, env: Env): Promise<Response> {
  const cookies = parseCookies(request);
  const session = await verifySession(env.SESSION_SECRET || '', cookies[COOKIE_NAME]);
  if (!session) return jsonAuth({ authenticated: false }, 401, request);
  return jsonAuth({
    authenticated: true,
    user: { email: session.email, accountId: session.accountId, accountName: session.accountName },
    scope: session.scope,
    expiresAt: session.exp * 1000,
  }, 200, request);
}

// ── POST /auth/logout ─────────────────────────────────────────────────────
export async function handleAuthLogout(request: Request, env: Env): Promise<Response> {
  const cookies = parseCookies(request);
  const session = await verifySession(env.SESSION_SECRET || '', cookies[COOKIE_NAME]);
  // Best-effort revoke (needs the access token; not stored, so we can only clear the cookie)
  // Refresh token we DO have on the server side. Use it to revoke.
  if (session?.sub) {
    const stored = await env.ARTIFACTS.get(`oauth:refresh:${session.sub}`);
    if (stored) {
      try {
        const { refresh_token } = JSON.parse(stored) as { refresh_token?: string };
        if (refresh_token && env.OAUTH_CLIENT_ID) {
          await fetch(env.OAUTH_REVOKE_URL || 'https://dash.cloudflare.com/oauth2/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: refresh_token, client_id: env.OAUTH_CLIENT_ID }).toString(),
          }).catch(() => null);
        }
      } catch { /* ignore */ }
      await env.ARTIFACTS.delete(`oauth:refresh:${session.sub}`);
    }
  }
  return jsonAuth({ ok: true }, 200, request, { 'Set-Cookie': buildClearCookie(request.url) });
}

// ── Middleware: gate /api/* when request comes from a custom domain ───────
// Returns null if the request should proceed; returns a 401/503 Response if it should be blocked.
export async function requireApiAuth(request: Request, env: Env): Promise<Response | null> {
  if (!isCustomDomainRequest(request, env)) return null; // bypass on worker default host / local dev
  if (!isOAuthConfigured(env)) {
    return jsonAuth({ error: 'oauth_not_configured', description: 'Deploy host requires OAuth. Configure OAUTH_CLIENT_ID + SESSION_SECRET.' }, 503, request);
  }
  const cookies = parseCookies(request);
  const session = await verifySession(env.SESSION_SECRET || '', cookies[COOKIE_NAME]);
  if (!session) {
    const url = new URL(request.url);
    return jsonAuth({
      error: 'unauthorized',
      loginUrl: `${url.origin}/auth/login?next=${encodeURIComponent(url.pathname + url.search)}`,
    }, 401, request);
  }
  return null;
}

// ── Helper for downstream handlers that want the session ─────────────────
export async function getSessionFromRequest(request: Request, env: Env): Promise<Session | null> {
  const cookies = parseCookies(request);
  return verifySession(env.SESSION_SECRET || '', cookies[COOKIE_NAME]);
}
