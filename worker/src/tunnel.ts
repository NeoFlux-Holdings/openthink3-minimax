import { getSessionFromRequest } from "./auth.js";
import type { Env } from "./index.js";
import { discoverToolsFromUrl } from "./tools/discover.js";

const BRIDGE_TTL_SECONDS = 60 * 60 * 24;
const KV_PREFIX = "bridge:tunnel:";

type BridgeRecord = {
  tunnelUrl: string;
  accountId: string;
  registeredAt: number;
  lastPinged: number | null;
};

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

function bridgeKey(accountId: string): string {
  return `${KV_PREFIX}${accountId || "anonymous"}`;
}

function isTrycloudflareUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return host.endsWith(".trycloudflare.com") || host === "trycloudflare.com";
}

async function resolveAccountId(request: Request, env: Env): Promise<string> {
  const session = await getSessionFromRequest(request, env);
  if (session?.accountId) return session.accountId;
  if (session?.sub) return session.sub;
  return "anonymous";
}

async function loadRecord(env: Env, accountId: string): Promise<BridgeRecord | null> {
  const raw = await env.ARTIFACTS.get(bridgeKey(accountId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BridgeRecord;
    if (!parsed || typeof parsed.tunnelUrl !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function metadataWithExpiry(record: BridgeRecord): { metadata: BridgeRecord; expirationTtl: number } {
  return {
    metadata: {
      tunnelUrl: record.tunnelUrl,
      accountId: record.accountId,
      registeredAt: record.registeredAt,
      lastPinged: record.lastPinged,
    },
    expirationTtl: BRIDGE_TTL_SECONDS,
  };
}

function defaultMcpPath(): string {
  return "/mcp";
}

export async function handleBridge(
  env: Env,
  request: Request,
  url: URL,
  _ctx: ExecutionContext,
): Promise<Response> {
  const subpath = url.pathname.replace(/^\/api\/bridge/, "") || "/";

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  const accountId = await resolveAccountId(request, env);

  if (subpath === "/register") {
    if (request.method !== "POST") return jsonResp({ error: "POST required" }, 405);
    let body: { tunnelUrl?: unknown };
    try {
      body = (await request.json()) as { tunnelUrl?: unknown };
    } catch {
      return jsonResp({ error: "Body must be JSON" }, 400);
    }
    const tunnelUrl = typeof body.tunnelUrl === "string" ? body.tunnelUrl.trim() : "";
    if (!tunnelUrl) return jsonResp({ error: "tunnelUrl is required" }, 400);
    if (!isTrycloudflareUrl(tunnelUrl)) {
      return jsonResp({ error: "tunnelUrl must be an https://*.trycloudflare.com URL" }, 400);
    }
    const record: BridgeRecord = {
      tunnelUrl: tunnelUrl.replace(/\/+$/, ""),
      accountId,
      registeredAt: Date.now(),
      lastPinged: null,
    };
    const { metadata, expirationTtl } = metadataWithExpiry(record);
    await env.ARTIFACTS.put(bridgeKey(accountId), JSON.stringify(record), { metadata, expirationTtl });
    return jsonResp({ ok: true, ttlSeconds: expirationTtl, tunnelUrl: record.tunnelUrl });
  }

  if (subpath === "/status") {
    if (request.method !== "GET") return jsonResp({ error: "GET required" }, 405);
    const record = await loadRecord(env, accountId);
    if (!record) {
      return jsonResp({ registered: false, tunnelUrl: null, ttlSeconds: 0, lastPinged: null });
    }
    return jsonResp({
      registered: true,
      tunnelUrl: record.tunnelUrl,
      ttlSeconds: BRIDGE_TTL_SECONDS,
      lastPinged: record.lastPinged,
    });
  }

  if (subpath === "/delete" || (subpath === "/" && request.method === "DELETE")) {
    if (request.method !== "DELETE") return jsonResp({ error: "DELETE required" }, 405);
    await env.ARTIFACTS.delete(bridgeKey(accountId));
    return jsonResp({ ok: true });
  }

  if (subpath === "/ping") {
    if (request.method !== "POST") return jsonResp({ error: "POST required" }, 405);
    const record = await loadRecord(env, accountId);
    if (!record) return jsonResp({ error: "No tunnel registered" }, 404);
    const started = Date.now();
    const probeUrl = `${record.tunnelUrl}/`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const r = await fetch(probeUrl, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "ping" }),
      });
      const latencyMs = Date.now() - started;
      const updated: BridgeRecord = { ...record, lastPinged: Date.now() };
      await env.ARTIFACTS.put(bridgeKey(accountId), JSON.stringify(updated), { expirationTtl: BRIDGE_TTL_SECONDS });
      return jsonResp({ ok: r.status < 500, latencyMs, status: r.status });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return jsonResp({ ok: false, latencyMs: Date.now() - started, error: message }, 502);
    } finally {
      clearTimeout(timeout);
    }
  }

  if (subpath === "/proxy") {
    if (request.method !== "POST") return jsonResp({ error: "POST required" }, 405);
    const record = await loadRecord(env, accountId);
    if (!record) return jsonResp({ error: "No tunnel registered" }, 404);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResp({ error: "Body must be JSON" }, 400);
    }

    const target = `${record.tunnelUrl}${defaultMcpPath()}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const upstream = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const contentType = upstream.headers.get("Content-Type") || "";
      if (contentType.includes("text/event-stream")) {
        return new Response(upstream.body, {
          status: upstream.status,
          headers: {
            ...corsHeaders(),
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });
      }
      const text = await upstream.text();
      return new Response(text, {
        status: upstream.status,
        headers: { ...corsHeaders(), "Content-Type": contentType || "application/json" },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return jsonResp({ error: `Bridge proxy failed: ${message}` }, 502);
    } finally {
      clearTimeout(timeout);
    }
  }

  if (subpath === "/tools") {
    if (request.method !== "GET") return jsonResp({ error: "GET required" }, 405);
    const record = await loadRecord(env, accountId);
    if (!record) return jsonResp({ error: "No tunnel registered" }, 404);
    const result = await discoverToolsFromUrl(record.tunnelUrl);
    return jsonResp(result);
  }

  return jsonResp({ error: `Unknown bridge endpoint: ${request.method} ${subpath}` }, 404);
}
