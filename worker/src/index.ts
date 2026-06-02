import { Agent } from "agents";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface Env {
  AI: any;
  MEMORIES: any;
  ARTIFACTS: KVNamespace;
  THREAD_DO: DurableObjectNamespace<ThreadDO>;
  ORCHESTRATOR_DO: DurableObjectNamespace<OrchestratorDO>;
  // New intelligence stack secrets
  EXE_DEV_TOKEN?: string;
  GBRAIN_VM_URL?: string;
  // Cloudflare-side artifact sync (server-side secrets; never sent to the browser)
  CF_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  GH_TOKEN?: string;
  GH_REPO?: string;
}

// OrchestratorDO acts as the MCP Server (Agent B)
export class OrchestratorDO extends McpAgent<Env> {
  server = new McpServer({ name: "Orchestrator", version: "1.0.0" });

  async init() {
    this.server.tool(
      "check_context",
      "Check the current context and return relevant info across threads",
      { query: z.string() },
      async ({ query }) => {
        const threadKeys = await this.env.MEMORIES.list({ prefix: "thread:" });
        const memoryKeys = await this.env.MEMORIES.list({ prefix: "memory:" });
        const recentThreads = threadKeys.keys.slice(0, 5).map((k: any) => k.name);
        const recentMemories = memoryKeys.keys.slice(0, 5).map((k: any) => k.name);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              query,
              threadCount: threadKeys.keys.length,
              memoryCount: memoryKeys.keys.length,
              recentThreads,
              recentMemories,
              note: "Cross-thread context lookup. Full semantic search arrives when gbrain is migrated to CF Vectorize."
            }, null, 2),
          }],
        };
      }
    );
  }
}

// ThreadDO acts as the personal Agent for a specific task (Agent A)
export class ThreadDO extends Agent<Env> {
  async onStart() {
    // Connect to the Orchestrator via RPC using addMcpServer
    await this.addMcpServer("orchestrator", this.env.ORCHESTRATOR_DO);

    // Initialize SQLite database
    this.sql`CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      role TEXT,
      content TEXT,
      timestamp INTEGER
    )`;
  }

  async fetch(request: Request): Promise<Response> {
    return this.onRequest(request);
  }

  async onRequest(request: Request): Promise<Response> {
    // Ensure SQLite database is initialized
    this.sql`CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      role TEXT,
      content TEXT,
      timestamp INTEGER
    )`;

    const url = new URL(request.url);
    
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname === "/history" && request.method === "GET") {
      try {
        const rows = this.sql<{ role: string, content: string }>`
          SELECT role, content FROM messages ORDER BY timestamp ASC
        `;
        return new Response(JSON.stringify({ messages: rows }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    if (url.pathname === "/chat" && request.method === "POST") {
      try {
        const { prompt, model } = await request.json() as { prompt: string, model?: string };
        const selectedModel = model || "@cf/meta/llama-3.1-8b-instruct";
        
        // 1. Save user message to SQLite
        const userMsgId = crypto.randomUUID();
        this.sql`
          INSERT INTO messages (id, role, content, timestamp)
          VALUES (${userMsgId}, 'user', ${prompt}, ${Date.now()})
        `;

        // Setup streaming response
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        // Run AI loop in background
        this.ctx.waitUntil((async () => {
          try {
            // Load full message history
            const rows = this.sql<{ role: string, content: string }>`
              SELECT role, content FROM messages ORDER BY timestamp ASC
            `;

            const systemPrompt = `You are a helpful and premium AI personal agent called OpenThink.
You have access to MCP tools to retrieve global context and memory.
If you need context or memory, call the check_context tool.`;

            const llmMessages: any[] = [
              { role: "system", content: systemPrompt },
              ...rows.map(r => ({ role: r.role, content: r.content }))
            ];

            const mcpTools = this.mcp.listTools();
            const tools = mcpTools.map(t => ({
              name: t.name,
              description: t.description || "",
              parameters: t.inputSchema
            }));

            let loop = true;
            let depth = 0;
            const maxDepth = 5;

            while (loop && depth < maxDepth) {
              depth++;
              // Check if model wants to call tools (non-streaming first)
              const aiResponse = await this.env.AI.run(selectedModel, {
                messages: llmMessages,
                tools: tools.length > 0 ? tools : undefined
              }) as any;

              if (aiResponse.tool_calls && aiResponse.tool_calls.length > 0) {
                for (const tc of aiResponse.tool_calls) {
                  // Inform frontend we are calling a tool
                  await writer.write(encoder.encode(`data: ${JSON.stringify({ status: `Calling tool ${tc.name}...` })}\n\n`));

                  const mcpTool = mcpTools.find(t => t.name === tc.name);
                  if (mcpTool) {
                    const toolResult = await this.mcp.callTool({
                      serverId: mcpTool.serverId,
                      name: tc.name,
                      arguments: tc.arguments
                    });

                    llmMessages.push({
                      role: "assistant",
                      content: "",
                      tool_calls: [tc]
                    });
                    llmMessages.push({
                      role: "tool",
                      name: tc.name,
                      content: JSON.stringify(toolResult)
                    });
                  }
                }
              } else {
                // No more tool calls, stream the final response text
                loop = false;
                
                await writer.write(encoder.encode(`data: ${JSON.stringify({ status: "Thinking..." })}\n\n`));

                const aiStream = await this.env.AI.run(selectedModel, {
                  messages: llmMessages,
                  stream: true
                }) as ReadableStream;

                const reader = aiStream.getReader();
                const decoder = new TextDecoder();
                let fullText = "";
                let buffer = "";

                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;

                  const chunk = decoder.decode(value, { stream: true });
                  buffer += chunk;
                  
                  let boundary = buffer.indexOf("\n");
                  while (boundary !== -1) {
                    const line = buffer.slice(0, boundary).trim();
                    buffer = buffer.slice(boundary + 1);
                    
                    if (line.startsWith("data: ")) {
                      if (line.trim() === "data: [DONE]") {
                        // End of stream indicator
                      } else {
                        try {
                          const parsed = JSON.parse(line.slice(6));
                          if (parsed.response) {
                            fullText += parsed.response;
                            await writer.write(encoder.encode(`data: ${JSON.stringify({ response: parsed.response })}\n\n`));
                          }
                        } catch (e) {
                          // Ignore parse errors on incomplete JSON lines
                        }
                      }
                    }
                    boundary = buffer.indexOf("\n");
                  }
                }

                // Save assistant response to SQLite
                const assistantMsgId = crypto.randomUUID();
                this.sql`
                  INSERT INTO messages (id, role, content, timestamp)
                  VALUES (${assistantMsgId}, 'assistant', ${fullText}, ${Date.now()})
                `;
              }
            }

            await writer.write(encoder.encode("data: [DONE]\n\n"));
          } catch (err: any) {
            console.error("Error in AI loop:", err);
            await writer.write(encoder.encode(`data: ${JSON.stringify({ response: `\nError: ${err.message}` })}\n\n`));
            await writer.write(encoder.encode("data: [DONE]\n\n"));
          } finally {
            await writer.close();
          }
        })());

        return new Response(readable, {
          headers: {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
          }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    return new Response("Not found", { status: 404, headers: corsHeaders });
  }
}

// ── Intelligence Stack Helpers ─────────────────────────────────────────────

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function jsonResp(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

async function proxyToBrain(env: Env, path: string, req: Request): Promise<Response> {
  const vmUrl = env.GBRAIN_VM_URL || "http://localhost:4000";
  try {
    const upstream = new URL(path, vmUrl);
    const proxied = new Request(upstream.toString(), {
      method: req.method,
      headers: { "Content-Type": "application/json" },
      body: req.method !== "GET" ? req.body : undefined,
    });
    const r = await fetch(proxied);
    const body = await r.text();
    return new Response(body, { status: r.status, headers: { ...corsHeaders(), "Content-Type": "application/json" } });
  } catch (err: any) {
    return jsonResp({ error: "GBrain not reachable", detail: err.message }, 503);
  }
}

async function execOnVM(env: Env, command: string): Promise<{ ok: boolean; output: string }> {
  const token = env.EXE_DEV_TOKEN;
  if (!token) return { ok: false, output: "EXE_DEV_TOKEN not configured" };
  try {
    const r = await fetch("https://exe.dev/exec", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
      body: command,
    });
    const output = await r.text();
    return { ok: r.ok, output };
  } catch (err: any) {
    return { ok: false, output: err.message };
  }
}

// Main Worker routing
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    // ── Brain API (/api/brain/*) ────────────────────────────────
    if (url.pathname.startsWith("/api/brain/")) {
      const subpath = url.pathname.replace("/api/brain", "");

      // GET /api/brain/status → probe gbrain HTTP server
      if (subpath === "/status" && request.method === "GET") {
        const r = await proxyToBrain(env, "/status", request);
        if (r.status === 503) {
          return jsonResp({ connected: false, pageCount: 0, entityCount: 0, engine: "unknown", version: "" });
        }
        return r;
      }

      // POST /api/brain/search
      if (subpath === "/search" && request.method === "POST") {
        return proxyToBrain(env, "/search", request);
      }

      // POST /api/brain/ingest
      if (subpath === "/ingest" && request.method === "POST") {
        return proxyToBrain(env, "/ingest", request);
      }

      return jsonResp({ error: "Unknown brain endpoint" }, 404);
    }

    // ── Eval API (/api/eval/*) ──────────────────────────────────
    if (url.pathname.startsWith("/api/eval/")) {
      const subpath = url.pathname.replace("/api/eval", "");

      // GET /api/eval/results → fetch from KV
      if (subpath === "/results" && request.method === "GET") {
        const cached = await env.MEMORIES.get("eval:latest", { type: "json" });
        if (cached) return jsonResp(cached);
        return jsonResp({ error: "No eval results yet. Run an evaluation first." }, 404);
      }

      // GET /api/eval/history
      if (subpath === "/history" && request.method === "GET") {
        const history = await env.MEMORIES.get("eval:history", { type: "json" });
        return jsonResp(history || []);
      }

      // POST /api/eval/run → SSE stream of eval run via exe.dev
      if (subpath === "/run" && request.method === "POST") {
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        const sendEvent = async (data: object) => {
          await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        ctx.waitUntil((async () => {
          try {
            await sendEvent({ log: "🚀 Connecting to eval runner on exe.dev VM..." });

            const cmd = "cd ~/gbrain-evals && bun run eval:run --json 2>&1";
            const { ok, output } = await execOnVM(env, cmd);

            if (!ok) {
              await sendEvent({ log: `⚠️ VM exec failed: ${output}` });
              await sendEvent({ log: "💡 Tip: Set EXE_DEV_TOKEN secret and deploy gbrain-evals to your VM" });
            } else {
              // Parse scorecard from output
              const lines = output.split("\n");
              for (const line of lines) {
                if (line.trim()) await sendEvent({ log: line });
              }
              // Try to extract JSON scorecard
              const jsonLine = lines.find(l => l.trim().startsWith("{"));
              if (jsonLine) {
                try {
                  const scorecard = JSON.parse(jsonLine);
                  // Store in KV
                  await env.MEMORIES.put("eval:latest", JSON.stringify({ ...scorecard, timestamp: new Date().toISOString() }));
                  // Append to history
                  const history = (await env.MEMORIES.get("eval:history", { type: "json" })) as any[] || [];
                  history.unshift({ ...scorecard, timestamp: new Date().toISOString() });
                  if (history.length > 30) history.pop();
                  await env.MEMORIES.put("eval:history", JSON.stringify(history));
                  await sendEvent({ log: "✅ Scorecard saved to KV!", scorecard });
                } catch {}
              }
            }
            await sendEvent({ done: true });
          } catch (err: any) {
            await sendEvent({ log: `❌ Error: ${err.message}`, done: true });
          } finally {
            await writer.close();
          }
        })());

        return new Response(readable, {
          headers: { ...corsHeaders(), "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" },
        });
      }

      return jsonResp({ error: "Unknown eval endpoint" }, 404);
    }

    // ── exe.dev exec proxy (/api/exec) ──────────────────────────
    if (url.pathname === "/api/exec" && request.method === "POST") {
      const body = await request.text();
      const { ok, output } = await execOnVM(env, body);
      return jsonResp({ ok, output });
    }

    if (url.pathname === "/api/exec/vms" && request.method === "GET") {
      const token = env.EXE_DEV_TOKEN;
      if (!token) return jsonResp({ error: "EXE_DEV_TOKEN not configured" }, 503);
      try {
        const r = await fetch("https://exe.dev/exec", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
          body: "ls --json",
        });
        return new Response(await r.text(), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
      } catch (err: any) {
        return jsonResp({ error: err.message }, 503);
      }
    }

    // ── Plugin registry (/api/plugins/*) ───────────────────────
    if (url.pathname === "/api/plugins" && request.method === "GET") {
      const registry = await env.MEMORIES.get("plugins:registry", { type: "json" });
      return jsonResp(registry || []);
    }

    if (url.pathname === "/api/plugins" && request.method === "POST") {
      const body = await request.json() as { url?: string; plugin?: any };
      if (body.url) {
        // Fetch community plugin manifest
        try {
          const r = await fetch(body.url);
          if (!r.ok) return jsonResp({ error: "Failed to fetch plugin manifest" }, 400);
          const manifest = await r.json() as any;
          // Validate minimal schema
          if (!manifest.id || !manifest.name) return jsonResp({ error: "Invalid plugin manifest" }, 400);
          const registry = (await env.MEMORIES.get("plugins:registry", { type: "json" })) as any[] || [];
          registry.push({ ...manifest, source: "community", installedAt: new Date().toISOString() });
          await env.MEMORIES.put("plugins:registry", JSON.stringify(registry));
          return jsonResp(manifest);
        } catch (err: any) {
          return jsonResp({ error: err.message }, 500);
        }
      }
      return jsonResp({ error: "Provide url or plugin" }, 400);
    }

    if (url.pathname.startsWith("/api/plugins/") && request.method === "PUT") {
      const pluginId = url.pathname.split("/")[3];
      const body = await request.json() as any;
      const registry = (await env.MEMORIES.get("plugins:registry", { type: "json" })) as any[] || [];
      const idx = registry.findIndex((p: any) => p.id === pluginId);
      if (idx >= 0) {
        registry[idx] = { ...registry[idx], ...body };
      } else {
        registry.push({ ...body, id: pluginId });
      }
      await env.MEMORIES.put("plugins:registry", JSON.stringify(registry));
      return jsonResp({ ok: true });
    }

    // ── Cloudflare artifact sync (/api/cf/*) ────────────────────
    if (url.pathname.startsWith("/api/cf")) {
      if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders() });
      }
      try {
        return await handleCf(env, request);
      } catch (err: any) {
        return jsonResp({ error: err?.message ?? String(err) }, 500);
      }
    }

    // ── Thread routing (existing) ───────────────────────────────
    if (url.pathname.startsWith("/api/thread/")) {
      const threadId = url.pathname.split("/")[3] || "default";
      const id = env.THREAD_DO.idFromName(threadId);
      const stub = env.THREAD_DO.get(id);

      const newUrl = new URL(request.url);
      if (newUrl.pathname.endsWith("/chat")) {
        newUrl.pathname = "/chat";
      } else if (newUrl.pathname.endsWith("/history")) {
        newUrl.pathname = "/history";
      }
      const newReq = new Request(newUrl.toString(), request);

      const response = await stub.fetch(newReq);

      const newHeaders = new Headers(response.headers);
      newHeaders.set("Access-Control-Allow-Origin", "*");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }

    return new Response("OpenThink3 Worker is running.", {
      status: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  },
};

// ═══════════════════════════════════════════════════════════════════════
// Cloudflare artifact sync — store worker bundles, manifests, deploy history
// in the ARTIFACTS KV namespace and proxy deploy/PR calls to the real
// Cloudflare REST API + GitHub API using server-side secrets.
// ═══════════════════════════════════════════════════════════════════════

// KV key conventions (all in env.ARTIFACTS):
//   manifest              — current deployed manifest JSON
//   worker:current       — current worker bundle (string, up to 25 MB)
//   worker:staged        — staged worker bundle waiting for deploy
//   pages:current        — { url, deployedAt } for the latest Pages deploy
//   history:list         — JSON array of { id, ts, actor, type, ok, summary }
//   history:{id}         — full deploy record JSON

type HistoryEntry = {
  id: string;
  ts: number;
  actor: string;
  type: "deploy" | "pr" | "stage" | "pages";
  ok: boolean;
  summary: string;
  details?: any;
};

async function loadManifest(env: Env): Promise<any> {
  return (await env.ARTIFACTS.get("manifest", { type: "json" })) || {
    version: 0,
    deployedAt: null,
    sha256: null,
    source: null,
  };
}

async function appendHistory(env: Env, entry: HistoryEntry): Promise<void> {
  const list: HistoryEntry[] = (await env.ARTIFACTS.get("history:list", { type: "json" })) || [];
  list.unshift(entry);
  // keep last 100
  await env.ARTIFACTS.put("history:list", JSON.stringify(list.slice(0, 100)));
  await env.ARTIFACTS.put(`history:${entry.id}`, JSON.stringify(entry));
}

async function cfFetch(env: Env, path: string, init: RequestInit = {}): Promise<any> {
  if (!env.CF_API_TOKEN) throw new Error("CF_API_TOKEN secret is not configured on this worker");
  if (!env.CF_ACCOUNT_ID) throw new Error("CF_ACCOUNT_ID var is not configured on this worker");
  const url = `https://api.cloudflare.com/client/v4${path}`;
  const r = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      "Authorization": `Bearer ${env.CF_API_TOKEN}`,
      "Content-Type": "application/json",
    },
  });
  const data: any = await r.json();
  if (!data.success) {
    const msg = (data.errors || []).map((e: any) => e.message).join("; ") || `CF API ${r.status}`;
    throw new Error(msg);
  }
  return data;
}

async function ghFetch(env: Env, path: string, init: RequestInit = {}): Promise<any> {
  if (!env.GH_TOKEN) throw new Error("GH_TOKEN secret is not configured on this worker");
  const url = `https://api.github.com${path}`;
  const r = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      "Authorization": `Bearer ${env.GH_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`GitHub API ${r.status}: ${txt.slice(0, 200)}`);
  }
  return r.json();
}

async function handleCf(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const subpath = url.pathname.replace(/^\/api\/cf/, "");
  const method = request.method;

  // ── /api/cf/status — diagnostic (what's configured, what's not)
  if (subpath === "/status" && method === "GET") {
    return jsonResp({
      ok: true,
      configured: {
        CF_API_TOKEN: !!env.CF_API_TOKEN,
        CF_ACCOUNT_ID: !!env.CF_ACCOUNT_ID,
        GH_TOKEN: !!env.GH_TOKEN,
        GH_REPO: env.GH_REPO || null,
        ARTIFACTS_KV: !!env.ARTIFACTS,
      },
      manifest: await loadManifest(env),
    });
  }

  // ── /api/cf/zones — list user's Cloudflare zones (live)
  if (subpath === "/zones" && method === "GET") {
    const data = await cfFetch(env, "/zones?per_page=50");
    const zones = (data.result || []).map((z: any) => ({
      id: z.id, name: z.name, status: z.status,
    }));
    return jsonResp({ zones, source: "live" });
  }

  // ── /api/cf/workers — list existing worker scripts
  if (subpath === "/workers" && method === "GET") {
    const data = await cfFetch(env, `/accounts/${env.CF_ACCOUNT_ID}/workers/scripts`);
    const workers = (data.result || []).map((w: any) => ({
      id: w.id, created_on: w.created_on, modified_on: w.modified_on,
    }));
    // Try to enrich each with details (best-effort; ignore errors).
    const enriched = await Promise.all(workers.map(async (w: any) => {
      try {
        const d = await cfFetch(env, `/accounts/${env.CF_ACCOUNT_ID}/workers/scripts/${w.id}`);
        return { ...w, etag: d.result?.etag, handlers: d.result?.handlers?.length ?? 0, size: d.result?.size };
      } catch { return w; }
    }));
    return jsonResp({ workers: enriched, source: "live" });
  }

  // ── /api/cf/manifest — current deployed manifest
  if (subpath === "/manifest" && method === "GET") {
    const manifest = await loadManifest(env);
    const staged = !!(await env.ARTIFACTS.get("worker:staged"));
    return jsonResp({ manifest, staged });
  }

  // ── /api/cf/bundle/worker — GET current, POST/PUT to stage
  if (subpath === "/bundle/worker" && method === "GET") {
    const code = await env.ARTIFACTS.get("worker:current");
    if (!code) return jsonResp({ error: "No worker bundle stored yet" }, 404);
    return new Response(code, {
      headers: { ...corsHeaders(), "Content-Type": "application/javascript" },
    });
  }
  if (subpath === "/bundle/worker" && (method === "POST" || method === "PUT")) {
    const body = await request.json() as { code?: string; meta?: { sha256?: string; bytes?: number; source?: string } };
    if (!body.code || typeof body.code !== "string") {
      return jsonResp({ error: "Body must include { code: string }" }, 400);
    }
    if (body.code.length > 25 * 1024 * 1024) {
      return jsonResp({ error: "Bundle exceeds KV 25 MB value limit" }, 413);
    }
    const meta = body.meta || {};
    const stagedMeta = {
      bytes: meta.bytes ?? body.code.length,
      sha256: meta.sha256 ?? null,
      source: meta.source ?? "manual",
      stagedAt: Date.now(),
    };
    await env.ARTIFACTS.put("worker:staged", body.code, {
      metadata: { sha256: stagedMeta.sha256, bytes: stagedMeta.bytes, source: stagedMeta.source, stagedAt: stagedMeta.stagedAt },
    });
    await appendHistory(env, {
      id: `stage-${Date.now()}`,
      ts: Date.now(),
      actor: meta.source ?? "user",
      type: "stage",
      ok: true,
      summary: `Staged worker bundle (${(stagedMeta.bytes / 1024).toFixed(1)} KB${meta.sha256 ? `, sha ${meta.sha256.slice(0, 10)}…` : ""})`,
    });
    return jsonResp({ ok: true, staged: stagedMeta });
  }

  // ── /api/cf/deploy/worker — push staged bundle to Cloudflare via REST API
  if (subpath === "/deploy/worker" && method === "POST") {
    const body = await request.json().catch(() => ({})) as { scriptName?: string; message?: string };
    // Prefer staged; fall back to current.
    let deployCode: string | null = await env.ARTIFACTS.get("worker:staged");
    let deployMeta: any = (await env.ARTIFACTS.getWithMetadata("worker:staged", { type: "text" })).metadata || {};
    if (!deployCode) {
      const cur = await env.ARTIFACTS.get("worker:current");
      if (cur) {
        deployCode = cur;
        const meta = await env.ARTIFACTS.getWithMetadata("worker:current", { type: "text" });
        deployMeta = meta.metadata || {};
      }
    }
    if (!deployCode) {
      return jsonResp({ error: "No bundle to deploy. POST one to /api/cf/bundle/worker first." }, 400);
    }
    const scriptName = body.scriptName || "openthink3-worker";
    const putRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/scripts/${scriptName}`,
      {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${env.CF_API_TOKEN}`,
          "Content-Type": "application/javascript",
        },
        body: deployCode,
      }
    );
    const putData: any = await putRes.json();
    if (!putData.success) {
      const err = (putData.errors || []).map((e: any) => e.message).join("; ") || `CF API ${putRes.status}`;
      await appendHistory(env, {
        id: `deploy-err-${Date.now()}`,
        ts: Date.now(),
        actor: "user",
        type: "deploy",
        ok: false,
        summary: `Deploy failed: ${err}`,
        details: { scriptName, sha: deployMeta?.sha256 ?? null },
      });
      return jsonResp({ error: err, details: putData }, 502);
    }
    // Promote staged → current
    await env.ARTIFACTS.put("worker:current", deployCode, {
      metadata: deployMeta,
    });
    await env.ARTIFACTS.delete("worker:staged");
    const manifest = {
      version: Date.now(),
      deployedAt: new Date().toISOString(),
      sha256: deployMeta?.sha256 ?? null,
      bytes: deployCode.length,
      scriptName,
      source: deployMeta?.source ?? "user",
      message: body.message ?? null,
      deploymentId: putData.result?.id ?? null,
    };
    await env.ARTIFACTS.put("manifest", JSON.stringify(manifest));
    await appendHistory(env, {
      id: `deploy-${Date.now()}`,
      ts: Date.now(),
      actor: "user",
      type: "deploy",
      ok: true,
      summary: `Deployed ${scriptName} (${(deployCode.length / 1024).toFixed(1)} KB)`,
      details: { scriptName, deploymentId: manifest.deploymentId, sha: manifest.sha256, message: body.message ?? null },
    });
    return jsonResp({ ok: true, manifest });
  }

  // ── /api/cf/deploy/pages — record a Pages deployment intent
  if (subpath === "/deploy/pages" && method === "POST") {
    const body = await request.json().catch(() => ({})) as { projectName?: string; branch?: string };
    if (!body.projectName) return jsonResp({ error: "projectName required" }, 400);
    const branch = body.branch || "main";
    const list = await cfFetch(env, `/accounts/${env.CF_ACCOUNT_ID}/pages/projects/${body.projectName}/deployments?per_page=1`);
    await appendHistory(env, {
      id: `pages-${Date.now()}`,
      ts: Date.now(),
      actor: "user",
      type: "pages",
      ok: true,
      summary: `Tracked Pages deploy for ${body.projectName}@${branch}`,
      details: { projectName: body.projectName, branch, latestDeploymentId: list.result?.[0]?.id ?? null },
    });
    return jsonResp({
      ok: true,
      projectName: body.projectName,
      branch,
      note: "Direct-upload pipeline is a wrangler concern. This endpoint records intent and surfaces the current Pages project state.",
      latestDeployment: list.result?.[0] ?? null,
    });
  }

  // ── /api/cf/history — list of past deploys / stages / PRs
  if (subpath === "/history" && method === "GET") {
    const list: HistoryEntry[] = (await env.ARTIFACTS.get("history:list", { type: "json" })) || [];
    return jsonResp({ history: list });
  }

  // ── /api/cf/github/pr — create a PR with a list of file changes
  if (subpath === "/github/pr" && method === "POST") {
    if (!env.GH_REPO) return jsonResp({ error: "GH_REPO var is not configured" }, 503);
    const body = await request.json() as {
      title: string; body: string; head: string; base?: string; files: { path: string; content: string }[]
    };
    if (!body.title || !body.head || !Array.isArray(body.files) || body.files.length === 0) {
      return jsonResp({ error: "title, head, and non-empty files[] required" }, 400);
    }
    const base = body.base || "main";
    // 1. Get base SHA
    const refData = await ghFetch(env, `/repos/${env.GH_REPO}/git/ref/heads/${base}`);
    const baseSha = refData.object?.sha;
    if (!baseSha) return jsonResp({ error: `Base branch ${base} not found` }, 404);
    // 2. Create the new branch (idempotent: 422 with "Reference already exists" is fine)
    try {
      await ghFetch(env, `/repos/${env.GH_REPO}/git/refs`, {
        method: "POST",
        body: JSON.stringify({ ref: `refs/heads/${body.head}`, sha: baseSha }),
      });
    } catch (e: any) {
      if (!String(e.message).includes("Reference already exists") && !String(e.message).includes("422")) {
        throw e;
      }
    }
    // 3. Commit each file via the Contents API
    for (const f of body.files) {
      const existing = await ghFetch(env, `/repos/${env.GH_REPO}/contents/${encodeURIComponent(f.path)}?ref=${body.head}`).catch(() => null);
      const sha = existing && (existing as any).sha ? (existing as any).sha : undefined;
      await ghFetch(env, `/repos/${env.GH_REPO}/contents/${encodeURIComponent(f.path)}`, {
        method: "PUT",
        body: JSON.stringify({
          message: body.title,
          content: btoa(unescape(encodeURIComponent(f.content))),
          branch: body.head,
          sha,
        }),
      });
    }
    // 4. Open the PR
    const pr = await ghFetch(env, `/repos/${env.GH_REPO}/pulls`, {
      method: "POST",
      body: JSON.stringify({ title: body.title, body: body.body || "", head: body.head, base }),
    });
    await appendHistory(env, {
      id: `pr-${Date.now()}`,
      ts: Date.now(),
      actor: "user",
      type: "pr",
      ok: true,
      summary: `Opened PR #${(pr as any).number}: ${body.title}`,
      details: { prNumber: (pr as any).number, url: (pr as any).html_url, head: body.head, base, files: body.files.length },
    });
    return jsonResp({ ok: true, prNumber: (pr as any).number, url: (pr as any).html_url });
  }

  // ── /api/cf/agent/submit — agent evolution: submit a code change as a PR
  if (subpath === "/agent/submit" && method === "POST") {
    if (!env.GH_REPO) return jsonResp({ error: "GH_REPO var is not configured" }, 503);
    const body = await request.json() as {
      reason: string;
      file: string;
      before: string;
      after: string;
      head?: string;
    };
    if (!body.file || typeof body.before !== "string" || typeof body.after !== "string") {
      return jsonResp({ error: "file, before, after are required" }, 400);
    }
    const head = body.head || `agent-evolution-${Date.now()}`;
    // Delegate to the same PR-handler logic by faking an internal request.
    const fakeRequest = new Request("http://internal/api/cf/github/pr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `agent: ${body.reason || "self-improvement"}`,
        body: `Submitted by the agent's evolution loop.\n\n**Reason:** ${body.reason || "(none)"}\n\n**File:** \`${body.file}\`\n\nThis PR proposes a code change as part of the agent's self-evolution. A new branch (\`${head}\`) was created from \`main\`, the proposed \`after\` content was committed, and a PR has been opened for review.`,
        head,
        base: "main",
        files: [{ path: body.file, content: body.after }],
      }),
    });
    return handleCf(env, fakeRequest);
  }

  return jsonResp({ error: `Unknown CF endpoint: ${method} ${subpath}` }, 404);
}


