// GitHub App installation flow (server-side).
//   GET  /api/github/install   → 302 to https://github.com/apps/<slug>/installations/new?state=<csrf>
//   GET  /api/github/callback  → mints installation token, encrypts (AES-GCM), stores in ARTIFACTS
//   POST /api/github/callback  → returns {ok, user, repos} for the SPA after a redirect-back
//   GET  /api/github/repos     → lists repos for the current installation
//   GET  /api/github/status    → {installed, account, repos}
//   POST /api/github/prs       → creates a branch + commits files + opens a PR
//   POST /api/github/issues    → posts a comment on an issue/PR
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
