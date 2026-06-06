// GitHub App installation flow (server-side).
//   GET  /api/github/install   â†’ 302 to https://github.com/apps/<slug>/installations/new?state=<csrf>
//   GET  /api/github/callback  â†’ mints installation token, encrypts (AES-GCM), stores in ARTIFACTS
//   POST /api/github/callback  â†’ returns {ok, user, repos} for the SPA after a redirect-back
//   GET  /api/github/repos     â†’ lists repos for the current installation
//   GET  /api/github/status    â†’ {installed, account, repos}
//   POST /api/github/prs       â†’ creates a branch + commits files + opens a PR
//   POST /api/github/issues    â†’ posts a comment on an issue/PR
//
// All endpoints share the CF OAuth session for account_id. The GitHub App
// installation token is stored at `gh:install:token:<cf_account_id>` and
// encrypted with GITHUB_INSTALL_TOKEN_KEY (AES-GCM, 12-byte IV).

import type { Env } from "./index.js";

const INSTALL_STATE_TTL = 60 * 10;
const REPO_CACHE_TTL_MS = 60_000;

function b64urlEncode(bytes: ArrayBuffer | Uint8Array | string): string {
  let bin: string;
  if (typeof bytes === "string") {
    bin = bytes;
  } else {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = "";
    for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    bin = s;
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64Decode(s: string): Uint8Array {
  const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64Encode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0) throw new Error("GITHUB_INSTALL_TOKEN_KEY must be hex (even length)");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function pemToDerBytes(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  return b64Decode(b64);
}

function randomState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return b64urlEncode(bytes);
}

function isAppConfigured(env: Env): boolean {
  return !!(env.GITHUB_APP_ID && env.GITHUB_APP_SLUG && env.GITHUB_APP_PRIVATE_KEY);
}

function appNotConfiguredError(): Response {
  return jsonResp(
    {
      error: "github_app_not_configured",
      description:
        "Set GITHUB_APP_ID, GITHUB_APP_SLUG (in [vars]) and GITHUB_APP_PRIVATE_KEY + GITHUB_INSTALL_TOKEN_KEY (via `wrangler secret put`) on this worker.",
    },
    503,
  );
}

function jsonResp(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function redirectTo(location: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: location, ...extraHeaders },
  });
}

async function signAppJwt(appId: string, privateKeyPem: string): Promise<string> {
  const der = pemToDerBytes(privateKeyPem);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64urlEncode(JSON.stringify({ iat: now - 60, exp: now + 60 * 10, iss: appId }));
  const signingInput = `${header}.${payload}`;
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64urlEncode(sig)}`;
}

async function encryptToken(plaintext: string, keyHex: string): Promise<string> {
  const keyBytes = hexToBytes(keyHex);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, [
    "encrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${b64Encode(iv)}:${b64Encode(ciphertext)}`;
}

async function decryptToken(blob: string, keyHex: string): Promise<string> {
  const sep = blob.indexOf(":");
  if (sep < 0) throw new Error("Malformed encrypted token (missing iv:ct separator)");
  const iv = b64Decode(blob.slice(0, sep));
  const ct = b64Decode(blob.slice(sep + 1));
  const keyBytes = hexToBytes(keyHex);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, [
    "decrypt",
  ]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

type InstallationInfo = {
  id: number;
  account: { id: number; login: string; type?: string; avatar_url?: string } | null;
  tokenCiphertext: string;
  tokenExpiresAt: string;
  cachedAt: number;
};

type SessionLite = {
  sub: string;
  accountId?: string;
  email?: string;
  accountName?: string;
};

async function readSession(request: Request, env: Env): Promise<SessionLite | null> {
  if (!env.SESSION_SECRET) return null;
  const cookieHeader = request.headers.get("Cookie") || "";
  const out: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  const token = out["ot_session"];
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const k = await crypto.subtle.importKey(
    "raw",
    enc.encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(payload)));
  let provided: Uint8Array;
  try {
    provided = b64Decode(sigB64.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return null;
  }
  if (expected.length !== provided.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ provided[i];
  if (diff !== 0) return null;
  let session: any;
  try {
    session = JSON.parse(dec.decode(b64Decode(payload.replace(/-/g, "+").replace(/_/g, "/"))));
  } catch {
    return null;
  }
  if (typeof session?.exp !== "number" || session.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return {
    sub: session.sub,
    accountId: session.accountId,
    email: session.email,
    accountName: session.accountName,
  };
}

function accountKey(session: SessionLite | null): string | null {
  if (!session) return null;
  return session.accountId || session.sub;
}

async function mintInstallationToken(env: Env, installationId: string): Promise<{
  token: string;
  expiresAt: string;
  account: InstallationInfo["account"];
  installation: { id: number; account: InstallationInfo["account"] };
}> {
  const jwt = await signAppJwt(env.GITHUB_APP_ID!, env.GITHUB_APP_PRIVATE_KEY!);
  const r = await fetch(
    `https://api.github.com/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
    },
  );
  const data: any = await r.json();
  if (!r.ok) {
    throw new Error(`GitHub installation token exchange failed: ${r.status} ${JSON.stringify(data).slice(0, 200)}`);
  }
  const accountMeta: any = data.account ?? data.installation?.account ?? null;
  let account: InstallationInfo["account"] = null;
  if (accountMeta && typeof accountMeta.id === "number") {
    account = {
      id: accountMeta.id,
      login: accountMeta.login,
      type: accountMeta.type,
      avatar_url: accountMeta.avatar_url,
    };
  }
  return {
    token: data.token,
    expiresAt: data.expires_at,
    account,
    installation: { id: data.id, account },
  };
}

async function ghAppFetch(
  env: Env,
  session: SessionLite,
  path: string,
  init: RequestInit = {},
  attempt = 0,
): Promise<{ status: number; body: any; headers: Headers }> {
  const key = accountKey(session);
  if (!key) throw new Error("no_session");
  const stored = (await env.ARTIFACTS.get(`gh:install:token:${key}`, { type: "json" })) as
    | InstallationInfo
    | null;
  if (!stored) throw new Error("not_installed");
  const doFetch = async (token: string) => {
    const r = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
    });
    let body: any = null;
    const text = await r.text();
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    return { status: r.status, body, headers: r.headers };
  };
  const token = await decryptToken(stored.tokenCiphertext, env.GITHUB_INSTALL_TOKEN_KEY!);
  const result = await doFetch(token);
  if (result.status === 401 && attempt === 0 && stored) {
    const fresh = await mintInstallationToken(env, String(stored.id));
    const newCiphertext = await encryptToken(fresh.token, env.GITHUB_INSTALL_TOKEN_KEY!);
    const next: InstallationInfo = {
      ...stored,
      id: fresh.installation.id,
      account: fresh.account ?? stored.account,
      tokenCiphertext: newCiphertext,
      tokenExpiresAt: fresh.expiresAt,
      cachedAt: Date.now(),
    };
    await env.ARTIFACTS.put(`gh:install:token:${key}`, JSON.stringify(next));
    return ghAppFetch(env, session, path, init, attempt + 1);
  }
  return result;
}

export async function handleGithubInstall(request: Request, env: Env): Promise<Response> {
  if (!isAppConfigured(env)) return appNotConfiguredError();
  const url = new URL(request.url);
  const redirectBack = url.searchParams.get("next") || "/github";
  const state = randomState();
  await env.ARTIFACTS.put(
    `gh:install:${state}`,
    JSON.stringify({ redirectBack, createdAt: Date.now() }),
    { expirationTtl: INSTALL_STATE_TTL },
  );
  const target = `https://github.com/apps/${encodeURIComponent(env.GITHUB_APP_SLUG!)}/installations/new?state=${encodeURIComponent(state)}`;
  return redirectTo(target);
}

export async function handleGithubCallback(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method === "GET") {
    if (!isAppConfigured(env)) return appNotConfiguredError();
    if (!env.GITHUB_INSTALL_TOKEN_KEY) {
      return jsonResp(
        { error: "github_install_key_missing", description: "Set GITHUB_INSTALL_TOKEN_KEY via `wrangler secret put`." },
        503,
      );
    }
    const url = new URL(request.url);
    const installationId = url.searchParams.get("installation_id");
    const state = url.searchParams.get("state");
    if (!installationId || !state) {
      return jsonResp({ error: "invalid_callback", description: "Missing installation_id or state" }, 400);
    }
    const pendingRaw = await env.ARTIFACTS.get(`gh:install:${state}`);
    if (!pendingRaw) {
      return jsonResp({ error: "state_expired", description: "Installation flow expired. Please retry." }, 400);
    }
    let pending: { redirectBack: string; createdAt: number };
    try { pending = JSON.parse(pendingRaw); } catch { pending = { redirectBack: "/github", createdAt: 0 }; }
    const session = await readSession(request, env);
    const key = accountKey(session);
    if (!key) {
      return jsonResp(
        { error: "no_session", description: "Sign in to your OpenThink agent before installing the GitHub App." },
        401,
      );
    }
    let minted: Awaited<ReturnType<typeof mintInstallationToken>>;
    try {
      minted = await mintInstallationToken(env, installationId);
    } catch (err: any) {
      return jsonResp({ error: "token_exchange_failed", description: err?.message ?? String(err) }, 502);
    }
    const ciphertext = await encryptToken(minted.token, env.GITHUB_INSTALL_TOKEN_KEY);
    const info: InstallationInfo = {
      id: minted.installation.id,
      account: minted.account,
      tokenCiphertext: ciphertext,
      tokenExpiresAt: minted.expiresAt,
      cachedAt: Date.now(),
    };
    await env.ARTIFACTS.put(`gh:install:token:${key}`, JSON.stringify(info));
    await env.ARTIFACTS.delete(`gh:install:${state}`);
    const target = `${pending.redirectBack || "/github"}?installation_id=${encodeURIComponent(installationId)}&state=${encodeURIComponent(state)}`;
    return redirectTo(target);
  }

  if (request.method === "POST") {
    if (!env.GITHUB_INSTALL_TOKEN_KEY) {
      return jsonResp(
        { error: "github_install_key_missing", description: "Set GITHUB_INSTALL_TOKEN_KEY via `wrangler secret put`." },
        503,
      );
    }
    const session = await readSession(request, env);
    const key = accountKey(session);
    if (!key) return jsonResp({ error: "no_session" }, 401);
    const body = (await request.json().catch(() => ({}))) as {
      code?: string;
      installationId?: string;
    };
    const stored = (await env.ARTIFACTS.get(`gh:install:token:${key}`, { type: "json" })) as
      | InstallationInfo
      | null;
    if (!stored) return jsonResp({ ok: false, error: "not_installed" }, 404);
    let repos: Array<{ id: number; full_name: string; private: boolean; default_branch: string }> = [];
    try {
      const allRepos: typeof repos = [];
      for (let page = 1; page <= 5; page++) {
        const r = await ghAppFetch(
          env,
          session!,
          `/installation/repositories?per_page=100&page=${page}`,
        );
        if (r.status !== 200) break;
        const reposPage: any[] = r.body?.repositories ?? [];
        for (const repo of reposPage) {
          allRepos.push({
            id: repo.id,
            full_name: repo.full_name,
            private: !!repo.private,
            default_branch: repo.default_branch || "main",
          });
        }
        if (reposPage.length < 100) break;
      }
      repos = allRepos;
    } catch (err: any) {
      return jsonResp({ ok: true, user: stored.account, repos: [], error: err?.message ?? String(err) });
    }
    return jsonResp({
      ok: true,
      user: stored.account,
      repos,
      installationId: String(stored.id),
    });
  }

  return jsonResp({ error: `Method ${request.method} not allowed` }, 405);
}

export async function handleGithubStatus(request: Request, env: Env): Promise<Response> {
  if (!isAppConfigured(env)) {
    return jsonResp({
      installed: false,
      account: null,
      repos: [],
      configured: false,
      appSlug: env.GITHUB_APP_SLUG || null,
    });
  }
  const session = await readSession(request, env);
  const key = accountKey(session);
  if (!key) {
    return jsonResp({ installed: false, account: null, repos: [], configured: true });
  }
  const stored = (await env.ARTIFACTS.get(`gh:install:token:${key}`, { type: "json" })) as
    | InstallationInfo
    | null;
  if (!stored) {
    return jsonResp({ installed: false, account: null, repos: [], configured: true });
  }
  let repos: Array<{ id: number; full_name: string; private: boolean; default_branch: string }> = [];
  try {
    const allRepos: typeof repos = [];
    for (let page = 1; page <= 5; page++) {
      const r = await ghAppFetch(
        env,
        session!,
        `/installation/repositories?per_page=100&page=${page}`,
      );
      if (r.status !== 200) break;
      const reposPage: any[] = r.body?.repositories ?? [];
      for (const repo of reposPage) {
        allRepos.push({
          id: repo.id,
          full_name: repo.full_name,
          private: !!repo.private,
          default_branch: repo.default_branch || "main",
        });
      }
      if (reposPage.length < 100) break;
    }
    repos = allRepos;
  } catch {
    repos = [];
  }
  return jsonResp({
    installed: true,
    account: stored.account,
    repos,
    configured: true,
    appSlug: env.GITHUB_APP_SLUG,
  });
}

export async function handleGithubRepos(request: Request, env: Env): Promise<Response> {
  if (!isAppConfigured(env)) return appNotConfiguredError();
  const session = await readSession(request, env);
  const key = accountKey(session);
  if (!key) return jsonResp({ error: "no_session" }, 401);
  const stored = (await env.ARTIFACTS.get(`gh:install:token:${key}`, { type: "json" })) as
    | InstallationInfo
    | null;
  if (!stored) return jsonResp({ error: "not_installed", repos: [] }, 404);
  try {
    const allRepos: Array<{ id: number; full_name: string; private: boolean; default_branch: string }> = [];
    for (let page = 1; page <= 5; page++) {
      const r = await ghAppFetch(
        env,
        session!,
        `/installation/repositories?per_page=100&page=${page}`,
      );
      if (r.status !== 200) return jsonResp({ error: r.body?.message ?? `GitHub ${r.status}`, repos: allRepos }, r.status);
      const reposPage: any[] = r.body?.repositories ?? [];
      for (const repo of reposPage) {
        allRepos.push({
          id: repo.id,
          full_name: repo.full_name,
          private: !!repo.private,
          default_branch: repo.default_branch || "main",
        });
      }
      if (reposPage.length < 100) break;
    }
    return jsonResp({ repos: allRepos, account: stored.account });
  } catch (err: any) {
    return jsonResp({ error: err?.message ?? String(err), repos: [] }, 500);
  }
}

export async function handleGithubPR(request: Request, env: Env): Promise<Response> {
  if (!isAppConfigured(env)) return appNotConfiguredError();
  const session = await readSession(request, env);
  const key = accountKey(session);
  if (!key) return jsonResp({ error: "no_session" }, 401);
  const stored = (await env.ARTIFACTS.get(`gh:install:token:${key}`, { type: "json" })) as
    | InstallationInfo
    | null;
  if (!stored) return jsonResp({ error: "not_installed" }, 404);

  const body = (await request.json().catch(() => ({}))) as {
    owner?: string;
    repo?: string;
    head?: string;
    base?: string;
    title?: string;
    body?: string;
    files?: Array<{ path?: string; content?: string }>;
  };
  if (!body.owner || !body.repo || !body.head || !body.title || !Array.isArray(body.files) || body.files.length === 0) {
    return jsonResp({ error: "owner, repo, head, title, and non-empty files[] required" }, 400);
  }
  const base = body.base || "main";
  const repoPath = `/repos/${encodeURIComponent(body.owner)}/${encodeURIComponent(body.repo)}`;

  let refData: any;
  try {
    const r = await ghAppFetch(env, session!, `${repoPath}/git/ref/heads/${encodeURIComponent(base)}`);
    if (r.status !== 200) return jsonResp({ error: `Base branch ${base} not found`, detail: r.body }, 404);
    refData = r.body;
  } catch (err: any) {
    return jsonResp({ error: err?.message ?? String(err) }, 502);
  }
  const baseSha = refData?.object?.sha;
  if (!baseSha) return jsonResp({ error: `Base branch ${base} not found` }, 404);

  const existingFiles = await Promise.all(
    body.files.map(async (f) => {
      try {
        const r = await ghAppFetch(
          env,
          session!,
          `${repoPath}/contents/${encodeURIComponent(f.path || "")}?ref=${encodeURIComponent(body.head!)}`,
        );
        if (r.status === 200) return r.body as { sha: string };
        return null;
      } catch {
        return null;
      }
    }),
  );

  try {
    await ghAppFetch(env, session!, `${repoPath}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${body.head}`, sha: baseSha }),
    });
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (!msg.includes("Reference already exists") && !msg.includes("422")) {
      return jsonResp({ error: msg }, 502);
    }
  }

  const commitErrors: string[] = [];
  await Promise.all(
    body.files.map(async (f, i) => {
      if (!f.path || typeof f.content !== "string") {
        commitErrors.push(`file[${i}]: missing path or content`);
        return;
      }
      let bytes: Uint8Array;
      try {
        bytes = b64Decode(f.content);
      } catch {
        bytes = new TextEncoder().encode(f.content);
      }
      const sha = existingFiles[i] && (existingFiles[i] as any).sha ? (existingFiles[i] as any).sha : undefined;
      try {
        const r = await ghAppFetch(env, session!, `${repoPath}/contents/${encodeURIComponent(f.path)}`, {
          method: "PUT",
          body: JSON.stringify({
            message: body.title,
            content: b64Encode(bytes),
            branch: body.head,
            sha,
          }),
        });
        if (r.status >= 300) commitErrors.push(`${f.path}: ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
      } catch (err: any) {
        commitErrors.push(`${f.path}: ${err?.message ?? String(err)}`);
      }
    }),
  );
  if (commitErrors.length > 0) {
    return jsonResp({ error: "file_commit_failed", details: commitErrors }, 502);
  }

  let pr: any;
  try {
    const r = await ghAppFetch(env, session!, `${repoPath}/pulls`, {
      method: "POST",
      body: JSON.stringify({ title: body.title, body: body.body || "", head: body.head, base }),
    });
    if (r.status >= 300) return jsonResp({ error: r.body?.message ?? `GitHub ${r.status}`, detail: r.body }, r.status);
    pr = r.body;
  } catch (err: any) {
    return jsonResp({ error: err?.message ?? String(err) }, 502);
  }

  return jsonResp({
    ok: true,
    prNumber: pr.number,
    url: pr.html_url,
    head: body.head,
    base,
    files: body.files.length,
  });
}

export async function handleGithubIssue(request: Request, env: Env): Promise<Response> {
  if (!isAppConfigured(env)) return appNotConfiguredError();
  const session = await readSession(request, env);
  const key = accountKey(session);
  if (!key) return jsonResp({ error: "no_session" }, 401);
  const stored = (await env.ARTIFACTS.get(`gh:install:token:${key}`, { type: "json" })) as
    | InstallationInfo
    | null;
  if (!stored) return jsonResp({ error: "not_installed" }, 404);

  const body = (await request.json().catch(() => ({}))) as {
    owner?: string;
    repo?: string;
    number?: number;
    body?: string;
  };
  if (!body.owner || !body.repo || typeof body.number !== "number" || !body.body) {
    return jsonResp({ error: "owner, repo, number, body are required" }, 400);
  }
  const repoPath = `/repos/${encodeURIComponent(body.owner)}/${encodeURIComponent(body.repo)}`;
  try {
    const r = await ghAppFetch(env, session!, `${repoPath}/issues/${body.number}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: body.body }),
    });
    if (r.status >= 300) {
      return jsonResp({ error: r.body?.message ?? `GitHub ${r.status}`, detail: r.body }, r.status);
    }
    return jsonResp({ ok: true, url: r.body?.html_url, id: r.body?.id });
  } catch (err: any) {
    return jsonResp({ error: err?.message ?? String(err) }, 502);
  }
}

export function isGithubConfigured(env: Env): boolean {
  return isAppConfigured(env);
}

export { REPO_CACHE_TTL_MS };

// ---------------------------------------------------------------------------
// User OAuth (Device Flow + "Sign in with GitHub" code exchange + Webhooks)
// ---------------------------------------------------------------------------

function isUserOAuthConfigured(env: Env): boolean {
  return !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
}

function userOAuthNotConfiguredError(): Response {
  return jsonResp(
    {
      error: "github_user_oauth_not_configured",
      description: "Set GITHUB_CLIENT_ID (in [vars]) and GITHUB_CLIENT_SECRET (via `wrangler secret put`).",
    },
    503,
  );
}

function userTokenKey(session: SessionLite | null): string | null {
  return accountKey(session);
}

async function githubApiPostForm(url: string, body: Record<string, string>, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: new URLSearchParams(body).toString(),
  });
  let parsed: any = null;
  const text = await r.text();
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  return { status: r.status, body: parsed };
}

async function encryptUserToken(plaintext: string, keyHex: string): Promise<string> {
  return encryptToken(plaintext, keyHex);
}

async function decryptUserToken(blob: string, keyHex: string): Promise<string> {
  return decryptToken(blob, keyHex);
}

export async function handleGithubDeviceCode(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!isUserOAuthConfigured(env)) return userOAuthNotConfiguredError();
  if (!env.GITHUB_INSTALL_TOKEN_KEY) {
    return jsonResp(
      { error: "github_install_key_missing", description: "Set GITHUB_INSTALL_TOKEN_KEY via `wrangler secret put`." },
      503,
    );
  }
  const session = await readSession(request, env);
  const key = userTokenKey(session);
  if (!key) return jsonResp({ error: "no_session" }, 401);

  const body = (await request.json().catch(() => ({}))) as { scope?: string };
  const scope = (body.scope || "read:user user:email repo").trim();
  const r = await githubApiPostForm(
    "https://github.com/login/device/code",
    {
      client_id: env.GITHUB_CLIENT_ID!,
      scope,
    },
    { Accept: "application/json" },
  );
  if (r.status !== 200) {
    return jsonResp({ error: "device_code_failed", status: r.status, detail: r.body }, r.status);
  }
  const expiresIn = Number(r.body.expires_in) || 900;
  const interval = Math.max(5, Number(r.body.interval) || 5);
  const verificationUri = String(r.body.verification_uri || "https://github.com/login/device");

  const deviceCodeCiphertext = await encryptUserToken(String(r.body.device_code), env.GITHUB_INSTALL_TOKEN_KEY);
  const pending = {
    deviceCodeCiphertext,
    userCode: String(r.body.user_code),
    verificationUri,
    expiresAt: Date.now() + expiresIn * 1000,
    interval,
    scope,
    clientId: env.GITHUB_CLIENT_ID!,
    accountId: key,
    createdAt: Date.now(),
  };
  await env.ARTIFACTS.put(`gh:device:${key}`, JSON.stringify(pending), {
    expirationTtl: Math.ceil(expiresIn / 1000) + 60,
  });
  return jsonResp({
    ok: true,
    userCode: pending.userCode,
    verificationUri: pending.verificationUri,
    expiresIn,
    interval,
    scope,
  });
}

export async function handleGithubDeviceToken(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!isUserOAuthConfigured(env)) return userOAuthNotConfiguredError();
  if (!env.GITHUB_INSTALL_TOKEN_KEY) {
    return jsonResp(
      { error: "github_install_key_missing", description: "Set GITHUB_INSTALL_TOKEN_KEY via `wrangler secret put`." },
      503,
    );
  }
  const session = await readSession(request, env);
  const key = userTokenKey(session);
  if (!key) return jsonResp({ error: "no_session" }, 401);

  const raw = await env.ARTIFACTS.get(`gh:device:${key}`);
  if (!raw) {
    return jsonResp({ ok: false, status: "expired", error: "no_pending_device_flow" }, 404);
  }
  let pending: any;
  try { pending = JSON.parse(raw); } catch {
    await env.ARTIFACTS.delete(`gh:device:${key}`);
    return jsonResp({ ok: false, status: "expired", error: "device_state_corrupt" }, 500);
  }
  if (Date.now() > pending.expiresAt) {
    await env.ARTIFACTS.delete(`gh:device:${key}`);
    return jsonResp({ ok: false, status: "expired", error: "device_code_expired" }, 410);
  }

  const deviceCode = await decryptUserToken(pending.deviceCodeCiphertext, env.GITHUB_INSTALL_TOKEN_KEY);
  const r = await githubApiPostForm(
    "https://github.com/login/oauth/access_token",
    {
      client_id: env.GITHUB_CLIENT_ID!,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    },
    { Accept: "application/json" },
  );
  if (r.status !== 200) {
    return jsonResp({ ok: false, status: "error", error: `github_${r.status}`, detail: r.body }, r.status);
  }
  const err = r.body?.error as string | undefined;
  if (err === "authorization_pending") {
    return jsonResp({ ok: false, status: "pending" });
  }
  if (err === "slow_down") {
    return jsonResp({ ok: false, status: "slow_down", interval: Number(r.body.interval) || pending.interval + 5 });
  }
  if (err === "expired_token") {
    await env.ARTIFACTS.delete(`gh:device:${key}`);
    return jsonResp({ ok: false, status: "expired", error: "device_code_expired" }, 410);
  }
  if (err === "access_denied") {
    await env.ARTIFACTS.delete(`gh:device:${key}`);
    return jsonResp({ ok: false, status: "denied", error: "user_denied" }, 403);
  }
  if (err || !r.body?.access_token) {
    return jsonResp({ ok: false, status: "error", error: err ?? "no_token", detail: r.body }, 400);
  }

  let user: { id: number; login: string; avatar_url?: string } | null = null;
  try {
    const me = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${r.body.access_token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (me.ok) {
      const meBody: any = await me.json();
      user = { id: meBody.id, login: meBody.login, avatar_url: meBody.avatar_url };
    }
  } catch {
    user = null;
  }

  const ciphertext = await encryptUserToken(String(r.body.access_token), env.GITHUB_INSTALL_TOKEN_KEY);
  const userToken = {
    accessTokenCiphertext: ciphertext,
    scope: String(r.body.scope || pending.scope || ""),
    tokenType: String(r.body.token_type || "bearer"),
    obtainedAt: Date.now(),
    user,
  };
  await env.ARTIFACTS.put(`gh:user:token:${key}`, JSON.stringify(userToken));
  await env.ARTIFACTS.delete(`gh:device:${key}`);
  return jsonResp({ ok: true, status: "ok", user, scope: userToken.scope });
}

export async function handleGithubDeviceCancel(
  request: Request,
  env: Env,
): Promise<Response> {
  const session = await readSession(request, env);
  const key = userTokenKey(session);
  if (!key) return jsonResp({ error: "no_session" }, 401);
  await env.ARTIFACTS.delete(`gh:device:${key}`);
  return jsonResp({ ok: true });
}

export async function handleGithubOAuthToken(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!isUserOAuthConfigured(env)) return userOAuthNotConfiguredError();
  if (!env.GITHUB_INSTALL_TOKEN_KEY) {
    return jsonResp(
      { error: "github_install_key_missing", description: "Set GITHUB_INSTALL_TOKEN_KEY via `wrangler secret put`." },
      503,
    );
  }
  const session = await readSession(request, env);
  const key = userTokenKey(session);
  if (!key) return jsonResp({ error: "no_session" }, 401);

  const body = (await request.json().catch(() => ({}))) as {
    code?: string;
    state?: string;
    redirectUri?: string;
  };
  if (!body.code) return jsonResp({ error: "missing_code" }, 400);
  const redirectUri = body.redirectUri || env.GITHUB_OAUTH_CALLBACK || "";
  const r = await githubApiPostForm(
    "https://github.com/login/oauth/access_token",
    {
      client_id: env.GITHUB_CLIENT_ID!,
      client_secret: env.GITHUB_CLIENT_SECRET!,
      code: body.code,
      redirect_uri: redirectUri,
    },
    { Accept: "application/json" },
  );
  if (r.status !== 200 || r.body?.error) {
    return jsonResp(
      { error: "code_exchange_failed", status: r.status, detail: r.body },
      r.status === 200 ? 400 : r.status,
    );
  }
  let user: { id: number; login: string; avatar_url?: string } | null = null;
  try {
    const me = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${r.body.access_token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (me.ok) {
      const meBody: any = await me.json();
      user = { id: meBody.id, login: meBody.login, avatar_url: meBody.avatar_url };
    }
  } catch {
    user = null;
  }
  const ciphertext = await encryptUserToken(String(r.body.access_token), env.GITHUB_INSTALL_TOKEN_KEY);
  const userToken = {
    accessTokenCiphertext: ciphertext,
    scope: String(r.body.scope || ""),
    tokenType: String(r.body.token_type || "bearer"),
    obtainedAt: Date.now(),
    user,
  };
  await env.ARTIFACTS.put(`gh:user:token:${key}`, JSON.stringify(userToken));
  return jsonResp({ ok: true, user, scope: userToken.scope });
}

export async function handleGithubOAuthStatus(
  request: Request,
  env: Env,
): Promise<Response> {
  const session = await readSession(request, env);
  const key = userTokenKey(session);
  if (!key) {
    return jsonResp({ signedIn: false, configured: isUserOAuthConfigured(env) });
  }
  const stored = (await env.ARTIFACTS.get(`gh:user:token:${key}`, { type: "json" })) as
    | { accessTokenCiphertext: string; scope: string; obtainedAt: number; user: any }
    | null;
  if (!stored) {
    return jsonResp({ signedIn: false, configured: true, user: null, scope: null });
  }
  return jsonResp({ signedIn: true, configured: true, user: stored.user, scope: stored.scope });
}

export async function handleGithubOAuthRevoke(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!isUserOAuthConfigured(env)) return userOAuthNotConfiguredError();
  const session = await readSession(request, env);
  const key = userTokenKey(session);
  if (!key) return jsonResp({ error: "no_session" }, 401);
  const stored = (await env.ARTIFACTS.get(`gh:user:token:${key}`, { type: "json" })) as
    | { accessTokenCiphertext: string }
    | null;
  if (stored) {
    try {
      const token = await decryptUserToken(stored.accessTokenCiphertext, env.GITHUB_INSTALL_TOKEN_KEY!);
      await fetch(`https://api.github.com/applications/${env.GITHUB_CLIENT_ID!}/token`, {
        method: "DELETE",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Basic ${btoa(`${env.GITHUB_CLIENT_ID}:${env.GITHUB_CLIENT_SECRET}`)}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }).catch(() => null);
      await fetch(`https://api.github.com/applications/${env.GITHUB_CLIENT_ID!}/grant`, {
        method: "DELETE",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Basic ${btoa(`${env.GITHUB_CLIENT_ID}:${env.GITHUB_CLIENT_SECRET}`)}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ access_token: token }),
      }).catch(() => null);
    } catch {
      // ignore
    }
  }
  await env.ARTIFACTS.delete(`gh:user:token:${key}`);
  return jsonResp({ ok: true });
}

async function verifyGithubWebhookSignature(
  request: Request,
  env: Env,
): Promise<{ ok: boolean; event?: string; deliveryId?: string; payload?: any; error?: string }> {
  if (!env.GITHUB_WEBHOOK_SECRET) {
    return { ok: false, error: "GITHUB_WEBHOOK_SECRET not configured" };
  }
  const sigHeader = request.headers.get("X-Hub-Signature-256") || "";
  if (!sigHeader.startsWith("sha256=")) {
    return { ok: false, error: "missing or malformed X-Hub-Signature-256" };
  }
  const provided = sigHeader.slice(7).trim();
  const raw = await request.text();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.GITHUB_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const expected = sig.reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
  if (provided.length !== expected.length) {
    return { ok: false, error: "signature length mismatch" };
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  if (diff !== 0) return { ok: false, error: "signature mismatch" };
  let payload: any = null;
  try { payload = JSON.parse(raw); } catch { return { ok: false, error: "invalid JSON" }; }
  return {
    ok: true,
    event: request.headers.get("X-GitHub-Event") || undefined,
    deliveryId: request.headers.get("X-GitHub-Delivery") || undefined,
    payload,
  };
}

export async function handleGithubWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return jsonResp({ error: "method_not_allowed" }, 405);
  const v = await verifyGithubWebhookSignature(request, env);
  if (!v.ok) {
    return jsonResp({ error: "invalid_signature", description: v.error }, 401);
  }
  const key = `gh:webhook:${v.event}:${v.deliveryId}`;
  await env.ARTIFACTS.put(
    key,
    JSON.stringify({ event: v.event, deliveryId: v.deliveryId, payload: v.payload, receivedAt: Date.now() }),
    { expirationTtl: 60 * 60 * 24 * 30 },
  );
  // Process installation events for the platform identity. The
  // operator installs open-think-auth on NeoFlux-Holdings ONCE; this
  // webhook mints an installation access token, encrypts it with
  // GITHUB_INSTALL_TOKEN_KEY, and stores it at
  // `gh:install:token:platform` so ghServiceApi() can use it for
  // per-agent branch + config commits without requiring the end user
  // to install the App themselves.
  let installationResult: { action: string; stored: boolean; installationId?: number; account?: string } | null = null;
  if (v.event === "installation" && (v.payload as any)?.action && (v.payload as any).installation?.id) {
    try {
      const r = await mintAndStorePlatformTokenFromPayload(env, v.payload);
      installationResult = { action: (v.payload as any).action, stored: true, installationId: r.id, account: r.account };
    } catch (err: any) {
      installationResult = { action: (v.payload as any).action, stored: false };
      console.error("[webhook] platform token mint failed:", err?.message ?? err);
    }
  }
  return jsonResp({ ok: true, event: v.event, deliveryId: v.deliveryId, installation: installationResult });
}

// Local copies of the helpers from index.ts (the worker bundles them in
// the same module graph but they're not re-exported). Kept short to
// avoid pulling in the whole index.ts. The CLI script in
// scripts/setup-gh-platform.mjs implements the same flow in Node.
async function mintAndStorePlatformTokenFromPayload(env: Env, payload: any): Promise<{ id: number; account: string; expiresAt: string }> {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY || !env.GITHUB_INSTALL_TOKEN_KEY) {
    throw new Error("GITHUB_APP_ID/PRIVATE_KEY/INSTALL_TOKEN_KEY not configured");
  }
  const installationId = String(payload.installation.id);
  // Sign a JWT as the App.
  const der = pemToDerBytes(env.GITHUB_APP_PRIVATE_KEY);
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const jwtPayload = b64urlEncode(JSON.stringify({ iat: now - 60, exp: now + 60 * 9, iss: env.GITHUB_APP_ID }));
  const signingInput = `${header}.${jwtPayload}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${b64urlEncode(sig)}`;
  const r = await fetch(
    `https://api.github.com/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  const data: any = await r.json();
  if (!r.ok || !data?.token) {
    throw new Error(`mint installation token failed: ${r.status} ${JSON.stringify(data).slice(0, 300)}`);
  }
  const keyBytes = hexToBytes(env.GITHUB_INSTALL_TOKEN_KEY);
  const ck = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, ck, new TextEncoder().encode(data.token));
  const ivB64 = btoa(String.fromCharCode(...iv));
  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ct)));
  const ciphertext = `${ivB64}:${ctB64}`;
  const account = payload.installation?.account?.login || data.account?.login || "unknown";
  await env.ARTIFACTS.put(
    "gh:install:token:platform",
    JSON.stringify({ id: data.id, account, tokenCiphertext: ciphertext, cachedAt: Date.now(), expiresAt: data.expires_at }),
  );
  return { id: data.id, account, expiresAt: data.expires_at };
}

export async function handleGithubWebhookRecent(
  request: Request,
  env: Env,
): Promise<Response> {
  const session = await readSession(request, env);
  if (!session) return jsonResp({ error: "no_session" }, 401);
  const url = new URL(request.url);
  const event = url.searchParams.get("event");
  const list = await env.ARTIFACTS.list({ prefix: "gh:webhook:" });
  const out: any[] = [];
  for await (const k of list.keys) {
    if (event && !k.name.startsWith(`gh:webhook:${event}:`)) continue;
    const raw = await env.ARTIFACTS.get(k.name);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      out.push({
        key: k.name,
        event: parsed.event,
        deliveryId: parsed.deliveryId,
        receivedAt: parsed.receivedAt,
        action: parsed.payload?.action,
        sender: parsed.payload?.sender?.login,
        repository: parsed.payload?.repository?.full_name,
        pull_request: parsed.payload?.pull_request ? {
          number: parsed.payload.pull_request.number,
          title: parsed.payload.pull_request.title,
          state: parsed.payload.pull_request.state,
          html_url: parsed.payload.pull_request.html_url,
        } : undefined,
        issue: parsed.payload?.issue ? {
          number: parsed.payload.issue.number,
          title: parsed.payload.issue.title,
          state: parsed.payload.issue.state,
          html_url: parsed.payload.issue.html_url,
        } : undefined,
      });
    } catch {
      // skip
    }
  }
  out.sort((a, b) => b.receivedAt - a.receivedAt);
  return jsonResp({ events: out.slice(0, 50) });
}
