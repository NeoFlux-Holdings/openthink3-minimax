// ──────────────────────────────────────────────────────────────────────────
// OpenThink3 Worker — Cloudflare Worker entry point.
//
// Storage layout (all CF-native, no external services):
//   - MEMORIES (KV)     → thread chat history (via THREAD_DO)
//   - ARTIFACTS (KV)    → deploy bundles, manifests, sync state
//   - OPENTHINK3_DB (D1) → gbrain pages, edges, signals, threads, benchmarks
//   - GBRAIN_PAGES (Vectorize) → 384-dim BGE embeddings for semantic recall
//   - THREAD_DO (DO)    → per-thread stateful agent + chat streaming
//   - ORCHESTRATOR_DO   → MCP server for gstack tool calls
//
// Skill routes (gbrain + gstack) live at /api/skill/{search,think,capture,run,evals}
// and are invoked by the SkillsPanel + ThreadFeed on the frontend.
// ──────────────────────────────────────────────────────────────────────────
// TODO: when CF Cron Triggers ship (Phase 3), dispatch all 'cron-daily' hooks

import { Agent } from "agents";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  handleCapture,
  handleSearch,
  handleThink,
  handleRun,
  handleEvals,
  handleDream,
} from "./skills.js";
import {
  handleAuthLogin,
  handleAuthCallback,
  handleAuthStatus,
  handleAuthLogout,
  requireApiAuth,
} from "./auth.js";
import {
  handleGithubInstall,
  handleGithubCallback,
  handleGithubDeviceCode,
  handleGithubDeviceToken,
  handleGithubDeviceCancel,
  handleGithubOAuthToken,
  handleGithubOAuthStatus,
  handleGithubOAuthRevoke,
  handleGithubWebhook,
  handleGithubWebhookRecent,
  handleGithubRepos,
  handleGithubPR,
  handleGithubIssue,
  handleGithubStatus,
} from "./githubApp.js";
import { handleBridge } from "./tunnel.js";
import { handleBenchmarksRoute } from "./benchmarks.js";

export interface Env {
  AI: any;
  MEMORIES: any;
  ARTIFACTS: KVNamespace;
  THREAD_DO: DurableObjectNamespace<ThreadDO>;
  ORCHESTRATOR_DO: DurableObjectNamespace<OrchestratorDO>;
  OPENTHINK3_DB: D1Database;
  GBRAIN_PAGES: VectorizeIndex;
  AGENT_BUILDS: R2Bucket;
  // New intelligence stack secrets
  EXE_DEV_TOKEN?: string;
  GBRAIN_VM_URL?: string;
  // Cloudflare-side artifact sync (server-side secrets; never sent to the browser)
  CF_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  GH_TOKEN?: string;
  GH_REPO?: string;
  // OAuth / session
  OAUTH_CLIENT_ID?: string;
  SESSION_SECRET?: string;
  OAUTH_AUTHORIZE_URL?: string;
  OAUTH_TOKEN_URL?: string;
  OAUTH_USERINFO_URL?: string;
  OAUTH_REVOKE_URL?: string;
  WORKER_DEFAULT_HOST?: string;
  // GitHub App installation (preferred over GH_TOKEN PAT for per-user scoping).
  GITHUB_APP_ID?: string;
  GITHUB_APP_SLUG?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_INSTALL_TOKEN_KEY?: string;
  // GitHub OAuth App credentials (for "Sign in with GitHub" + Device Flow).
  // GITHUB_CLIENT_ID is public (set in [vars]); GITHUB_CLIENT_SECRET is a secret.
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_OAUTH_CALLBACK?: string;
  GITHUB_OAUTH_ERROR_URL?: string;
  // Webhook receiver.
  GITHUB_WEBHOOK_URL?: string;
  GITHUB_WEBHOOK_SECRET?: string;
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
        const [threadKeys, memoryKeys] = await Promise.all([
          this.env.MEMORIES.list({ prefix: "thread:" }),
          this.env.MEMORIES.list({ prefix: "memory:" }),
        ]);
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

            const runToolCallIteration = async (): Promise<any> => {
              return await this.env.AI.run(selectedModel, {
                messages: llmMessages,
                tools: tools.length > 0 ? tools : undefined
              }) as any;
            };

            const runToolExecution = async (aiResponse: any) => {
              const mcpToolByName = new Map(mcpTools.map(t => [t.name, t]));
              await Promise.all(aiResponse.tool_calls.map(async (tc: any) => {
                await writer.write(encoder.encode(`data: ${JSON.stringify({ status: `Calling tool ${tc.name}...` })}\n\n`));

                const mcpTool = mcpToolByName.get(tc.name);
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

              }));
            };

            const streamFinalResponse = async () => {
              await writer.write(encoder.encode(`data: ${JSON.stringify({ status: "Thinking..." })}\n\n`));

              const aiStream = await this.env.AI.run(selectedModel, {
                messages: llmMessages,
                stream: true
              }) as ReadableStream;

              const reader = aiStream.getReader();
              const decoder = new TextDecoder();
              let fullText = "";
              let buffer = "";

              const processStreamChunk = async (value: Uint8Array | undefined) => {
                if (!value) return;
                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;

                const parts = buffer.split("\n");
                buffer = parts.pop() ?? "";
                const writes: Promise<void>[] = [];
                for (const rawLine of parts) {
                  const line = rawLine.trim();
                  if (!line.startsWith("data: ")) continue;
                  if (line === "data: [DONE]") continue;
                  try {
                    const parsed = JSON.parse(line.slice(6));
                    if (parsed.response) {
                      fullText += parsed.response;
                      writes.push(writer.write(encoder.encode(`data: ${JSON.stringify({ response: parsed.response })}\n\n`)));
                    }
                  } catch (e) {
                    // Ignore parse errors on incomplete JSON lines
                  }
                }
                await Promise.all(writes);
              };

              const readStreamOnce = async (): Promise<boolean> => {
                const result = await reader.read();
                if (result.done) return false;
                await processStreamChunk(result.value);
                return true;
              };

              const drainStream = async () => {
                const hasMore = await readStreamOnce();
                if (hasMore) {
                  await drainStream();
                }
              };

              await drainStream();

              const assistantMsgId = crypto.randomUUID();
              this.sql`
                INSERT INTO messages (id, role, content, timestamp)
                VALUES (${assistantMsgId}, 'assistant', ${fullText}, ${Date.now()})
              `;
            };

            const agentLoop = async () => {
              if (!loop || depth >= maxDepth) return;
              depth++;
              const aiResponse = await runToolCallIteration();

              if (aiResponse.tool_calls && aiResponse.tool_calls.length > 0) {
                await runToolExecution(aiResponse);
                await agentLoop();
              } else {
                loop = false;
                await streamFinalResponse();
              }
            };
            await agentLoop();

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
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-CF-Token, X-CF-Account-Id",
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

// ── Skill route dispatcher ─────────────────────────────────────────────
async function handleSkillRoute(env: Env, request: Request, url: URL, ctx: ExecutionContext): Promise<Response> {
  const route = url.pathname.replace(/^\/api\/skill\//, "");
  if (request.method !== "POST") {
    return jsonResp({ error: `Method ${request.method} not allowed` }, 405);
  }

  switch (route) {
    case "capture": {
      const body = (await request.json().catch(() => ({}))) as Parameters<typeof handleCapture>[1];
      if (!body.threadId || !body.type || !body.content) {
        return jsonResp({ error: "threadId, type, content are required" }, 400);
      }
      const r = await handleCapture(env, body);
      return jsonResp(r);
    }
    case "search": {
      const body = (await request.json().catch(() => ({}))) as Parameters<typeof handleSearch>[1];
      if (!body.query) return jsonResp({ error: "query is required" }, 400);
      const r = await handleSearch(env, body);
      return jsonResp(r);
    }
    case "think": {
      const body = (await request.json().catch(() => ({}))) as Parameters<typeof handleThink>[1];
      if (!body.query) return jsonResp({ error: "query is required" }, 400);
      // Return SSE stream.
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();
      // Fire and forget; the writer is closed by handleThink.
      ctx.waitUntil(handleThink(env, body, writer, encoder));
      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          ...corsHeaders(),
        },
      });
    }
    case "run": {
      const body = (await request.json().catch(() => ({}))) as Parameters<typeof handleRun>[1];
      if (!body.command) return jsonResp({ error: "command is required" }, 400);
      const r = await handleRun(env, body);
      return jsonResp(r);
    }
    case "evals": {
      const body = ((await request.json().catch(() => ({}))) ?? {}) as Parameters<typeof handleEvals>[1];
      const r = await handleEvals(env, body);
      return jsonResp(r);
    }
    default:
      return jsonResp({ error: `Unknown skill route: ${route}` }, 404);
  }
}

// Main Worker routing
export default {
  // ── Cron trigger handler ─────────────────────────────────────────────
  // Two crons configured in wrangler.toml:
  //   "0 5 * * *"  → gbrain-dream (nightly memory consolidation)
  //   "0 6 * * *"  → gbrain-evals (eval suite scorecard)
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const cron = controller.cron;
    console.log(`[cron] firing: ${cron}`);
    if (cron === "0 5 * * *") {
      ctx.waitUntil(
        handleDream(env).then((r) => console.log("[cron] gbrain-dream", JSON.stringify(r))),
      );
    } else if (cron === "0 6 * * *") {
      ctx.waitUntil(
        handleEvals(env, { suite: "cron-daily" }).then((r) =>
          console.log(`[cron] gbrain-evals score=${r.score} (${r.passed}/${r.total})`),
        ),
      );
    } else {
      console.log(`[cron] unhandled cron: ${cron}`);
    }
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    // ── OAuth (worker-side) — gates the deployed agent on custom domains ──
    if (url.pathname === "/auth/login" && request.method === "GET") {
      return handleAuthLogin(request, env);
    }
    if (url.pathname === "/auth/callback" && request.method === "GET") {
      return handleAuthCallback(request, env);
    }
    if (url.pathname === "/auth/logout" && (request.method === "POST" || request.method === "GET")) {
      return handleAuthLogout(request, env);
    }
    if (url.pathname === "/api/auth/status" && request.method === "GET") {
      // Always allow status to be probed; returns 401 if no session.
      return handleAuthStatus(request, env);
    }

    // ── Auth gate: block /api/* when host is a custom domain ──────────────
    // Skip the /api/cf/proxy/* paths — they authenticate the user via their
    // own Bearer token (the OAuth access token from the SPA's localStorage),
    // not the worker's session cookie.
    if (url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/cf/proxy/")) {
      const denied = await requireApiAuth(request, env);
      if (denied) return denied;
    }

    // ── GitHub App installation flow (/api/github/*) ──────────────
    if (url.pathname.startsWith("/api/github/")) {
      if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders() });
      }
      try {
        const sub = url.pathname.replace(/^\/api\/github\//, "");
        switch (sub) {
          case "install":
            if (request.method !== "GET") return jsonResp({ error: "Method not allowed" }, 405);
            return handleGithubInstall(request, env);
          case "callback":
            return handleGithubCallback(request, env);
          case "repos":
            if (request.method !== "GET") return jsonResp({ error: "Method not allowed" }, 405);
            return handleGithubRepos(request, env);
          case "status":
            if (request.method !== "GET") return jsonResp({ error: "Method not allowed" }, 405);
            return handleGithubStatus(request, env);
          case "prs":
            if (request.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);
            return handleGithubPR(request, env);
          case "issues":
            if (request.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);
            return handleGithubIssue(request, env);
          case "device/code":
            if (request.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);
            return handleGithubDeviceCode(request, env);
          case "device/token":
            if (request.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);
            return handleGithubDeviceToken(request, env);
          case "device/cancel":
            if (request.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);
            return handleGithubDeviceCancel(request, env);
          case "oauth/token":
            if (request.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);
            return handleGithubOAuthToken(request, env);
          case "oauth/status":
            if (request.method !== "GET") return jsonResp({ error: "Method not allowed" }, 405);
            return handleGithubOAuthStatus(request, env);
          case "oauth/revoke":
            if (request.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);
            return handleGithubOAuthRevoke(request, env);
          case "webhook":
            return handleGithubWebhook(request, env);
          case "webhook/recent":
            if (request.method !== "GET") return jsonResp({ error: "Method not allowed" }, 405);
            return handleGithubWebhookRecent(request, env);
          default:
            return jsonResp({ error: `Unknown GitHub endpoint: ${sub}` }, 404);
        }
      } catch (err: any) {
        return jsonResp({ error: err?.message ?? String(err) }, 500);
      }
    }

    // ── Local Agent Bridge (/api/bridge/*) ──────────────────────
    if (url.pathname.startsWith("/api/bridge")) {
      try {
        return await handleBridge(env, request, url, ctx);
      } catch (err: any) {
        return jsonResp({ error: err?.message ?? String(err) }, 500);
      }
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
              const trimmedLines: string[] = [];
              for (const l of lines) if (l.trim()) trimmedLines.push(l);
              await Promise.all(trimmedLines.map(line => sendEvent({ log: line })));
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
        // CfHttpError carries an explicit status (4xx); anything else is 500.
        const status = err?.name === "CfHttpError" ? (err.status as number) : 500;
        return jsonResp({ error: err?.message ?? String(err) }, status);
      }
    }

    // ── Skill routes (gbrain + gstack) (/api/skill/*) ───────────
    if (url.pathname.startsWith("/api/skill/")) {
      if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders() });
      }
      try {
        return await handleSkillRoute(env, request, url, ctx);
      } catch (err: any) {
        return jsonResp({ error: err?.message ?? String(err) }, 500);
      }
    }

    // ── Benchmarks store (/api/benchmarks, /api/benchmarks/run) ──
    const benchRes = await handleBenchmarksRoute(env, request, url, ctx);
    if (benchRes) return benchRes;

    // ── Thread routing (existing) ───────────────────────────────
    // gbrain history (capture) is at /api/skill/capture and stores to
    // D1+Vectorize. The legacy /api/thread/:id/history endpoint is still
    // served by THREAD_DO (MEMORIES KV) for the chat streaming UI.
    // bootstrap PGlite inside `THREAD_DO` so the data dir is per-isolate
    // and persistent.
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

type AgentRecord = {
  name: string;
  branch: string;
  pagesProjectName: string;
  pagesProjectId?: string;
  customDomain: string;
  ownerCfAccountId: string;
  cfAccountId: string;
  githubOwner: string;
  githubRepo: string;
  createdAt: number;
  lastSyncedAt?: number;
  lastCommitSha?: string;
  status: "creating" | "active" | "error";
  history: Array<{
    id: string;
    ts: number;
    type: string;
    ok: boolean;
    summary: string;
    details?: any;
  }>;
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

function resolveCfCreds(env: Env, request: Request): {
  token: string | null;
  accountId: string | null;
  source: "header" | "env" | "none";
} {
  // 1. Explicit X-CF-Token header (legacy PAT path).
  let headerToken = request.headers.get("X-CF-Token");
  let headerAccount = request.headers.get("X-CF-Account-Id");
  // 2. OAuth session: Authorization: Bearer <access_token>. The SPA sends
  //    this (with X-CF-Account-Id) when the user signed in via the OAuth
  //    flow rather than by pasting a PAT. Without this fallback, every
  //    /api/cf/* call 500s for OAuth users.
  if (!headerToken) {
    const auth = request.headers.get("Authorization") || request.headers.get("authorization");
    if (auth?.toLowerCase().startsWith("bearer ")) {
      headerToken = auth.slice(7).trim();
    }
  }
  const token = headerToken || env.CF_API_TOKEN || null;
  const accountId = headerAccount || env.CF_ACCOUNT_ID || null;
  let source: "header" | "env" | "none" = "none";
  if (headerToken || headerAccount) source = "header";
  else if (token || accountId) source = "env";
  return { token, accountId, source };
}

class CfHttpError extends Error {
  constructor(public status: number, message: string, public detail?: unknown) {
    super(message);
    this.name = "CfHttpError";
  }
}

async function cfFetch(
  env: Env,
  request: Request,
  path: string,
  init: RequestInit = {}
): Promise<any> {
  const { token, accountId } = resolveCfCreds(env, request);
  if (!token) throw new CfHttpError(401, "CF credentials missing: sign in (OAuth) or pass X-CF-Token header");
  if (!accountId) throw new CfHttpError(401, "CF account ID missing: pass X-CF-Account-Id header or set CF_ACCOUNT_ID env var");
  const url = `https://api.cloudflare.com/client/v4${path}`;
  const initHeaders = (init.headers as Record<string, string>) || {};
  const contentType = initHeaders["Content-Type"] || initHeaders["content-type"] || "application/json";
  const r = await fetch(url, {
    ...init,
    headers: {
      ...initHeaders,
      "Authorization": `Bearer ${token}`,
      "Content-Type": contentType,
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
  if (!env.GH_TOKEN) throw new Error("GH_TOKEN secret is not configured on this worker (migrating to GitHub App)");
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

// ── App-based GH client (uses the GitHub App installation token, not a PAT) ─
// The user installs open-think-auth on NeoFlux-Holdings once. The installation
// token (encrypted with GITHUB_INSTALL_TOKEN_KEY) is stored at
// `gh:install:token:<cfAccountId>` in ARTIFACTS. This helper reads the
// session cookie, decrypts the token, and makes API calls.
function agentHexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0) throw new Error("GITHUB_INSTALL_TOKEN_KEY must be hex (even length)");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function agentB64Decode(s: string): Uint8Array {
  const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function agentDecryptToken(blob: string, keyHex: string): Promise<string> {
  const sep = blob.indexOf(":");
  if (sep < 0) throw new Error("Malformed encrypted token");
  const iv = agentB64Decode(blob.slice(0, sep));
  const ct = agentB64Decode(blob.slice(sep + 1));
  const dek = await crypto.subtle.importKey("raw", agentHexToBytes(keyHex), { name: "AES-GCM" }, false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, dek, ct);
  return new TextDecoder().decode(pt);
}

async function readSessionLite(request: Request, env: Env): Promise<{ sub: string; accountId?: string; email?: string } | null> {
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
    provided = agentB64Decode(sigB64.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return null;
  }
  if (expected.length !== provided.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ provided[i];
  if (diff !== 0) return null;
  let session: any;
  try {
    session = JSON.parse(new TextDecoder().decode(agentB64Decode(payload.replace(/-/g, "+").replace(/_/g, "/"))));
  } catch {
    return null;
  }
  if (typeof session?.exp !== "number" || session.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return { sub: session.sub, accountId: session.accountId, email: session.email };
}

async function ghAppApi(env: Env, request: Request, path: string, init: RequestInit = {}): Promise<any> {
  if (!env.GITHUB_INSTALL_TOKEN_KEY) {
    throw new Error("GITHUB_INSTALL_TOKEN_KEY not configured on this worker");
  }
  const session = await readSessionLite(request, env);
  if (!session) throw new Error("not_signed_in: please sign in with Cloudflare OAuth first");
  const accountKey = session.accountId || session.sub;
  const stored = (await env.ARTIFACTS.get(`gh:install:token:${accountKey}`, { type: "json" })) as
    | { tokenCiphertext: string; id: number }
    | null;
  if (!stored) {
    throw new Error("github_app_not_installed: visit /github and install the open-think-auth GitHub App on your account");
  }
  const token = await agentDecryptToken(stored.tokenCiphertext, env.GITHUB_INSTALL_TOKEN_KEY);
  const url = `https://api.github.com${path}`;
  const r = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> || {}),
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
  });
  const text = await r.text();
  let body: any;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (r.status >= 400) {
    const msg = body?.message || `GitHub API ${r.status}`;
    throw new Error(`${msg} (${r.status})`);
  }
  return body;
}

// ── Direct Upload helper: push a set of files to a Pages project ──────
async function directUploadToPages(
  env: Env,
  request: Request,
  accountId: string,
  projectName: string,
  files: Array<{ path: string; content: ArrayBuffer | Uint8Array | string }>,
): Promise<{ deploymentId: string; fileCount: number; totalBytes: number }> {
  const enc = new TextEncoder();
  const manifest: Record<string, { sha256: string; size: number }> = {};
  const normalized: Array<{ path: string; bytes: Uint8Array }> = [];
  for (const f of files) {
    const bytes = typeof f.content === "string" ? enc.encode(f.content) : f.content instanceof Uint8Array ? f.content : new Uint8Array(f.content);
    const hashBuf = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const path = f.path.startsWith("/") ? f.path.slice(1) : f.path;
    manifest[path] = { sha256, size: bytes.byteLength };
    normalized.push({ path, bytes });
  }
  const create = await cfFetch(env, request, `/accounts/${accountId}/pages/projects/${projectName}/deployments`, {
    method: "POST",
    body: JSON.stringify({ manifest }),
  });
  const deploymentId = create?.result?.id as string;
  let uploadUrl: string = create?.result?.upload_url as string;
  if (!deploymentId || !uploadUrl) {
    throw new Error(`Pages Direct Upload: missing deploymentId or upload_url in response: ${JSON.stringify(create).slice(0, 200)}`);
  }
  if (uploadUrl.endsWith("/")) uploadUrl = uploadUrl.slice(0, -1);
  for (const f of normalized) {
    const fileUrl = `${uploadUrl}/${f.path}`;
    const r = await fetch(fileUrl, {
      method: "PUT",
      body: f.bytes,
      headers: { "Content-Type": "application/octet-stream" },
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`Pages Direct Upload: PUT ${f.path} failed ${r.status} ${txt.slice(0, 200)}`);
    }
  }
  return { deploymentId, fileCount: normalized.length, totalBytes: normalized.reduce((s, f) => s + f.bytes.byteLength, 0) };
}

// ── Helper: stream the latest build out of R2 as a list of {path, content} ──
async function readLatestBuildFromR2(env: Env): Promise<Array<{ path: string; content: ArrayBuffer }>> {
  if (!env.AGENT_BUILDS) throw new Error("AGENT_BUILDS R2 bucket not configured");
  const list = await env.AGENT_BUILDS.list({ prefix: "builds/latest/" });
  const out: Array<{ path: string; content: ArrayBuffer }> = [];
  for (const obj of list.objects) {
    if (obj.key.endsWith("/_manifest.json")) continue;
    const obj2 = await env.AGENT_BUILDS.get(obj.key);
    if (!obj2) continue;
    out.push({
      path: obj.key.replace(/^builds\/latest\//, ""),
      content: await obj2.arrayBuffer(),
    });
  }
  if (out.length === 0) {
    throw new Error("No build found in R2 at builds/latest/. POST a build to /api/cf/agent/publish-build first.");
  }
  return out;
}

async function handleCf(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const subpath = url.pathname.replace(/^\/api\/cf/, "");
  const method = request.method;

  // ── /api/cf/agent/publish-build — upload a build (multipart) to R2
  // Form fields: "files" (one or more file blobs). The relative file name
  // is preserved (e.g. dist/index.html -> builds/latest/index.html).
  // Overwrites builds/latest/* atomically.
  if (subpath === "/agent/publish-build" && method === "POST") {
    if (!env.AGENT_BUILDS) return jsonResp({ error: "AGENT_BUILDS R2 bucket not configured" }, 503);
    let formData: FormData;
    try { formData = await request.formData(); } catch {
      return jsonResp({ error: "Expected multipart/form-data with 'files' field" }, 400);
    }
    const files = formData.getAll("files") as unknown as File[];
    if (!files || files.length === 0) {
      return jsonResp({ error: "No files uploaded. Send multipart/form-data with 'files' field." }, 400);
    }
    const uploaded: Array<{ path: string; size: number }> = [];
    for (const file of files) {
      if (!file || typeof file === "string") continue;
      const path = (file as any).name || "unknown";
      const buf = await (file as any).arrayBuffer();
      const ct = (file as any).type || "application/octet-stream";
      await env.AGENT_BUILDS.put(`builds/latest/${path}`, buf, {
        httpMetadata: { contentType: ct },
      });
      uploaded.push({ path, size: buf.byteLength });
    }
    const manifest = {
      uploadedAt: new Date().toISOString(),
      fileCount: uploaded.length,
      totalBytes: uploaded.reduce((s, f) => s + f.size, 0),
      files: uploaded,
    };
    await env.AGENT_BUILDS.put("builds/latest/_manifest.json", JSON.stringify(manifest, null, 2), {
      httpMetadata: { contentType: "application/json" },
    });
    return jsonResp({ ok: true, ...manifest });
  }

  // ── /api/cf/agent/build/list — list files in builds/latest/
  if (subpath === "/agent/build/list" && method === "GET") {
    if (!env.AGENT_BUILDS) return jsonResp({ error: "AGENT_BUILDS R2 bucket not configured" }, 503);
    const list = await env.AGENT_BUILDS.list({ prefix: "builds/latest/" });
    const files = list.objects
      .filter((o) => !o.key.endsWith("/_manifest.json"))
      .map((o) => ({ path: o.key.replace(/^builds\/latest\//, ""), size: o.size, uploaded: o.uploaded }));
    let manifest: any = null;
    const m = await env.AGENT_BUILDS.get("builds/latest/_manifest.json");
    if (m) {
      try { manifest = JSON.parse(await m.text()); } catch { /* ignore */ }
    }
    return jsonResp({ files, manifest });
  }

  // ── /api/cf/status — diagnostic (what's configured, what's not)
  if (subpath === "/status" && method === "GET") {
    const { source } = resolveCfCreds(env, request);
    return jsonResp({
      ok: true,
      configured: {
        CF_API_TOKEN: !!env.CF_API_TOKEN,
        CF_ACCOUNT_ID: !!env.CF_ACCOUNT_ID,
        GH_TOKEN: !!env.GH_TOKEN,
        GH_REPO: env.GH_REPO || null,
        ARTIFACTS_KV: !!env.ARTIFACTS,
      },
      credentialsSource: source,
      manifest: await loadManifest(env),
    });
  }

  // ── /api/cf/proxy/{userinfo,accounts} — CORS-free proxy for the SPA.
  // CF's userinfo + /accounts endpoints don't return Access-Control-Allow-Origin,
  // so a browser-based SPA can't read them directly. We proxy server-side and
  // re-emit CORS so the SPA can read the body. The SPA's Bearer token is the
  // OAuth access token from localStorage; the auth gate already skips /api/cf/proxy/*.
  if (subpath.startsWith("/proxy/")) {
    const tail = subpath.replace(/^\/proxy\//, "");
    const auth = request.headers.get("Authorization") || "";
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) return jsonResp({ error: "Missing Authorization: Bearer <token>" }, 401);
    const token = m[1];
    let upstreamUrl: string;
    switch (tail) {
      case "userinfo":
        upstreamUrl = "https://dash.cloudflare.com/oauth2/userinfo";
        break;
      case "accounts":
        upstreamUrl = "https://api.cloudflare.com/client/v4/accounts?per_page=1";
        break;
      default:
        return jsonResp({ error: `Unknown proxy path: ${tail}` }, 404);
    }
    try {
      const r = await fetch(upstreamUrl, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      const body = await r.text();
      return new Response(body, {
        status: r.status,
        headers: {
          ...corsHeaders(),
          "Content-Type": r.headers.get("Content-Type") || "application/json",
        },
      });
    } catch (err: any) {
      return jsonResp({ error: `proxy failed: ${err?.message ?? String(err)}` }, 502);
    }
  }

  // ── /api/cf/resolve-account — discover account/zones for a per-request token
  if (subpath === "/resolve-account" && method === "POST") {
    const body = await request.json().catch(() => ({})) as { token?: string };
    const token = body?.token;
    if (!token || typeof token !== "string") {
      return jsonResp({ error: "Body must include { token: string }" }, 400);
    }
    const cfHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    try {
      const accountsRes: any = await fetch("https://api.cloudflare.com/client/v4/accounts?per_page=50", { headers: cfHeaders }).then(r => r.json());
      if (!accountsRes.success) {
        const msg = (accountsRes.errors || []).map((e: any) => e.message).join("; ") || "Failed to list accounts";
        return jsonResp({ error: msg }, 502);
      }
      const account = (accountsRes.result || [])[0];
      if (!account) {
        return jsonResp({ error: "No accounts found for this token" }, 404);
      }
      const accountId: string = account.id;
      const probe = async (url: string): Promise<any> => {
        try {
          const r = await fetch(url, { headers: cfHeaders });
          return await r.json();
        } catch {
          return { success: false, result: [] };
        }
      };
      const [zonesRes, workersRes, pagesRes] = await Promise.all([
        probe("https://api.cloudflare.com/client/v4/zones?per_page=50"),
        probe(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts?per_page=1`),
        probe(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects?per_page=1`),
      ]);
      const zones = (zonesRes.result || []).map((z: any) => ({
        id: z.id, name: z.name, status: z.status,
      }));
      return jsonResp({
        ok: true,
        accountId,
        accountName: account.name,
        email: account.owner?.email ?? null,
        hasWorkers: Array.isArray(workersRes.result) && workersRes.result.length > 0,
        hasPages: Array.isArray(pagesRes.result) && pagesRes.result.length > 0,
        zones,
      });
    } catch (err: any) {
      return jsonResp({ error: err?.message ?? String(err) }, 500);
    }
  }

  // ── /api/cf/zones — list user's Cloudflare zones (live)
  if (subpath === "/zones" && method === "GET") {
    const data = await cfFetch(env, request, "/zones?per_page=50");
    const zones = (data.result || []).map((z: any) => ({
      id: z.id, name: z.name, status: z.status,
    }));
    return jsonResp({ zones, source: "live" });
  }

  // ── /api/cf/workers — list existing worker scripts
  if (subpath === "/workers" && method === "GET") {
    const { accountId } = resolveCfCreds(env, request);
    if (!accountId) return jsonResp({ error: "CF account ID required. Provide X-CF-Account-Id header or set CF_ACCOUNT_ID env var." }, 400);
    const data = await cfFetch(env, request, `/accounts/${accountId}/workers/scripts`);
    const workers = (data.result || []).map((w: any) => ({
      id: w.id, created_on: w.created_on, modified_on: w.modified_on,
    }));
    // Try to enrich each with details (best-effort; ignore errors).
    const enriched = await Promise.all(workers.map(async (w: any) => {
      try {
        const d = await cfFetch(env, request, `/accounts/${accountId}/workers/scripts/${w.id}`);
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
    const { accountId } = resolveCfCreds(env, request);
    if (!accountId) return jsonResp({ error: "CF account ID required. Provide X-CF-Account-Id header or set CF_ACCOUNT_ID env var." }, 400);
    const scriptName = body.scriptName || "openthink3-worker";
    const putData = await cfFetch(env, request, `/accounts/${accountId}/workers/scripts/${scriptName}`, {
      method: "PUT",
      headers: { "Content-Type": "application/javascript" },
      body: deployCode,
    });
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
    // Promote staged → current, delete staged, write manifest, append history — all independent writes
    await Promise.all([
      env.ARTIFACTS.put("worker:current", deployCode, { metadata: deployMeta }),
      env.ARTIFACTS.delete("worker:staged"),
      env.ARTIFACTS.put("manifest", JSON.stringify(manifest)),
      appendHistory(env, {
        id: `deploy-${Date.now()}`,
        ts: Date.now(),
        actor: "user",
        type: "deploy",
        ok: true,
        summary: `Deployed ${scriptName} (${(deployCode.length / 1024).toFixed(1)} KB)`,
        details: { scriptName, deploymentId: manifest.deploymentId, sha: manifest.sha256, message: body.message ?? null },
      }),
    ]);
    return jsonResp({ ok: true, manifest });
  }

  // ── /api/cf/deploy/pages — record a Pages deployment intent
  if (subpath === "/deploy/pages" && method === "POST") {
    const body = await request.json().catch(() => ({})) as { projectName?: string; branch?: string };
    if (!body.projectName) return jsonResp({ error: "projectName required" }, 400);
    const branch = body.branch || "main";
    const { accountId } = resolveCfCreds(env, request);
    if (!accountId) return jsonResp({ error: "CF account ID required. Provide X-CF-Account-Id header or set CF_ACCOUNT_ID env var." }, 400);
    const list = await cfFetch(env, request, `/accounts/${accountId}/pages/projects/${body.projectName}/deployments?per_page=1`);
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

  // ── /api/cf/pages/attach-domain — attach a custom domain to a Pages project
  // Body: { domain: "subdomain.example.com", projectName?: "openthink-harness" }
  // Returns: { ok, url, status, result, source }
  if (subpath === "/pages/attach-domain" && method === "POST") {
    const body = await request.json().catch(() => ({})) as { domain?: string; projectName?: string };
    if (!body.domain || typeof body.domain !== "string") {
      return jsonResp({ error: "domain (string) is required in body" }, 400);
    }
    const projectName = body.projectName || "openthink-harness";
    let cfData: any;
    try {
      const accountId = resolveCfCreds(env, request).accountId;
      if (!accountId) {
        return jsonResp({ error: "CF account ID required. Set CF_ACCOUNT_ID env var or pass X-CF-Account-Id header." }, 400);
      }
      cfData = await cfFetch(env, request, `/accounts/${accountId}/pages/projects/${projectName}/domains`, {
        method: "POST",
        body: JSON.stringify({ name: body.domain }),
      });
    } catch (err: any) {
      // cfFetch throws on !success; extract a useful message.
      const msg = String(err?.message ?? err);
      return jsonResp({ error: `Cloudflare rejected the domain attach: ${msg}` }, 502);
    }
    const result = cfData.result ?? {};
    return jsonResp({
      ok: true,
      url: `https://${body.domain}`,
      status: result.status ?? "pending",
      result: {
        id: result.id,
        name: result.name,
        status: result.status,
        verification_data: result.verification_data ?? null,
      },
      projectName,
    });
  }

  // ── /api/cf/deploy/agent — per-agent monorepo provisioning ─────────
  // Body: { agentName: string, customDomain: string }
  // For each new agent:
  //   1. Create a branch `agent/<name>` in the monorepo (env.GH_REPO)
  //   2. Commit agent-data/config.json to the branch
  //   3. Create a Pages project `agent-<name>` bound to the branch
  //   4. Attach the user's customDomain to the Pages project
  //   5. Store an agent record in KV
  // Pages auto-deploys on every push to the agent's branch.
  if (subpath === "/deploy/agent" && method === "POST") {
    const body = await request.json().catch(() => ({})) as { agentName?: string; customDomain?: string };
    if (!body.agentName || typeof body.agentName !== "string") {
      return jsonResp({ error: "agentName (string) is required" }, 400);
    }
    if (!body.customDomain || typeof body.customDomain !== "string") {
      return jsonResp({ error: "customDomain (string) is required" }, 400);
    }
    const { accountId } = resolveCfCreds(env, request);
    if (!accountId) {
      return jsonResp({ error: "CF account ID required. Set CF_ACCOUNT_ID env var or pass X-CF-Account-Id header." }, 400);
    }
    if (!env.GH_REPO) return jsonResp({ error: "GH_REPO var is not configured" }, 503);
    const sanitized = body.agentName.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    if (!sanitized) {
      return jsonResp({ error: "agentName produced an empty branch name (use letters, numbers, or hyphens)" }, 400);
    }
    const branch = `agent/${sanitized}`;
    const projectName = `agent-${sanitized}`;
    const existing = await env.ARTIFACTS.get(`agent:${sanitized}`, { type: "json" });
    if (existing) {
      return jsonResp({ error: `Agent '${sanitized}' already exists`, agent: existing }, 409);
    }
    const [ghOwner, ghRepo] = env.GH_REPO.split("/");
    const agent: AgentRecord = {
      name: sanitized,
      branch,
      pagesProjectName: projectName,
      customDomain: body.customDomain,
      ownerCfAccountId: accountId,
      cfAccountId: accountId,
      githubOwner: ghOwner,
      githubRepo: ghRepo,
      createdAt: Date.now(),
      status: "creating",
      history: [],
    };
    const pushHistory = (type: string, ok: boolean, summary: string, details?: any) => {
      agent.history.unshift({
        id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: Date.now(),
        type,
        ok,
        summary,
        details,
      });
    };

    // Step 1: create the branch from main (idempotent on "Reference already exists").
    try {
      const mainRef: any = await ghAppApi(env, request, `/repos/${env.GH_REPO}/git/ref/heads/main`);
      const mainSha = mainRef?.object?.sha;
      if (!mainSha) throw new Error("Could not resolve main branch SHA");
      try {
        await ghAppApi(env, request, `/repos/${env.GH_REPO}/git/refs`, {
          method: "POST",
          body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: mainSha }),
        });
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (!msg.includes("Reference already exists") && !msg.includes("422")) throw err;
      }
      pushHistory("branch-create", true, `Created branch ${branch} from main`);
    } catch (err: any) {
      pushHistory("branch-create", false, `Failed to create branch: ${err?.message ?? err}`);
      agent.status = "error";
      await env.ARTIFACTS.put(`agent:${sanitized}`, JSON.stringify(agent));
      return jsonResp({ error: `Failed to create branch: ${err?.message ?? err}` }, 502);
    }

    // Step 2: commit agent-data/config.json to the branch.
    try {
      const configJson = JSON.stringify({
        agentName: sanitized,
        customDomain: body.customDomain,
        ownerCfAccountId: accountId,
        createdAt: new Date().toISOString(),
      }, null, 2);
      const base64 = btoa(unescape(encodeURIComponent(configJson)));
      const r: any = await ghAppApi(env, request, `/repos/${env.GH_REPO}/contents/agent-data/config.json`, {
        method: "PUT",
        body: JSON.stringify({
          message: `agent: initialize ${sanitized}`,
          content: base64,
          branch,
        }),
      });
      pushHistory("config-commit", true, `Committed agent-data/config.json`, { sha: r?.content?.sha });
    } catch (err: any) {
      pushHistory("config-commit", false, `Failed to commit config: ${err?.message ?? err}`);
      agent.status = "error";
      await env.ARTIFACTS.put(`agent:${sanitized}`, JSON.stringify(agent));
      return jsonResp({ error: `Branch created, config commit failed: ${err?.message ?? err}` }, 502);
    }

    // Step 3: create the Pages project (Direct Upload only — no Git connection).
    // We upload the build from R2 in step 3b.
    try {
      const create: any = await cfFetch(env, request, `/accounts/${accountId}/pages/projects`, {
        method: "POST",
        body: JSON.stringify({
          name: projectName,
          production_branch: branch,
        }),
      });
      agent.pagesProjectId = create?.result?.id;
      pushHistory("pages-create", true, `Created Pages project ${projectName}`, {
        id: create?.result?.id,
        subdomain: create?.result?.subdomain,
      });
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      pushHistory("pages-create", false, `Pages project creation failed: ${msg}`);
      agent.status = "error";
      await env.ARTIFACTS.put(`agent:${sanitized}`, JSON.stringify(agent));
      return jsonResp({
        error: `Branch + config ready, but Pages project creation failed: ${msg}`,
        hint: "Direct Upload only — no Git connection required. Verify the CF token has account:pages:edit.",
        agent,
      }, 502);
    }

    // Step 3b: Direct Upload the latest R2 build to the new Pages project.
    // This is what actually makes the agent live at <project>.pages.dev.
    let initialDeployment: { deploymentId: string; fileCount: number; totalBytes: number } | null = null;
    if (env.AGENT_BUILDS) {
      try {
        const buildFiles = await readLatestBuildFromR2(env);
        initialDeployment = await directUploadToPages(env, request, accountId, projectName, buildFiles);
        pushHistory("pages-deploy", true,
          `Direct Uploaded ${initialDeployment.fileCount} files (${initialDeployment.totalBytes} bytes)`,
          { deploymentId: initialDeployment.deploymentId });
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        pushHistory("pages-deploy", false, `Initial Direct Upload failed: ${msg}`);
        // Don't bail — the project is created and the branch has config.
        // The user can re-publish via /api/cf/deploy/agent/:name/republish.
      }
    } else {
      pushHistory("pages-deploy", false, "AGENT_BUILDS R2 bucket not configured — skipped initial deploy");
    }

    // Step 4: attach custom domain to the Pages project.
    try {
      const attach: any = await cfFetch(env, request, `/accounts/${accountId}/pages/projects/${projectName}/domains`, {
        method: "POST",
        body: JSON.stringify({ name: body.customDomain }),
      });
      pushHistory("domain-attach", true, `Attached ${body.customDomain}`, { status: attach?.result?.status ?? "pending" });
    } catch (err: any) {
      pushHistory("domain-attach", false, `Domain attach failed: ${err?.message ?? err}`);
    }

    agent.status = "active";
    await env.ARTIFACTS.put(`agent:${sanitized}`, JSON.stringify(agent));
    await env.ARTIFACTS.put(`agent-domain:${body.customDomain}`, JSON.stringify({ name: sanitized }));
    await appendHistory(env, {
      id: `agent-create-${Date.now()}`,
      ts: Date.now(),
      actor: "user",
      type: "pages",
      ok: true,
      summary: `Provisioned agent ${sanitized} (branch ${branch}, project ${projectName}, domain ${body.customDomain})`,
      details: { agentName: sanitized, branch, projectName, customDomain: body.customDomain },
    });

    return jsonResp({
      ok: true,
      agent,
      url: `https://${body.customDomain}`,
      pagesUrl: `https://${projectName}.pages.dev`,
      initialDeployment: initialDeployment ?? null,
    });
  }

  // ── /api/cf/deploy/agent/list — list agents owned by the calling CF account
  if (subpath === "/deploy/agent/list" && method === "GET") {
    const { accountId } = resolveCfCreds(env, request);
    const list = await env.ARTIFACTS.list({ prefix: "agent:" });
    const agents: any[] = [];
    for await (const k of list.keys) {
      if (k.name.startsWith("agent-domain:")) continue;
      const raw = await env.ARTIFACTS.get(k.name);
      if (!raw) continue;
      try {
        const a = JSON.parse(raw);
        if (!accountId || a.ownerCfAccountId === accountId) agents.push(a);
      } catch { /* skip */ }
    }
    return jsonResp({ agents });
  }

  // ── /api/cf/deploy/agent/:name — get a single agent record
  const agentDetailMatch = subpath.match(/^\/deploy\/agent\/([^\/]+)$/);
  if (agentDetailMatch && method === "GET") {
    const name = agentDetailMatch[1];
    const agent = await env.ARTIFACTS.get(`agent:${name}`, { type: "json" });
    if (!agent) return jsonResp({ error: `Agent '${name}' not found` }, 404);
    return jsonResp({ agent });
  }

  // ── /api/cf/deploy/agent/:name/sync — commit files to the agent's branch
  // Pages auto-deploys on push. Body: { files: [{path, content}], message?: string }
  const agentSyncMatch = subpath.match(/^\/deploy\/agent\/([^\/]+)\/sync$/);
  if (agentSyncMatch && method === "POST") {
    const name = agentSyncMatch[1];
    const agent = (await env.ARTIFACTS.get(`agent:${name}`, { type: "json" })) as AgentRecord | null;
    if (!agent) return jsonResp({ error: `Agent '${name}' not found` }, 404);
    const body = await request.json().catch(() => ({})) as {
      files?: Array<{ path?: string; content?: string }>;
      message?: string;
    };
    if (!body.files || !Array.isArray(body.files) || body.files.length === 0) {
      return jsonResp({ error: "files[] is required and must be non-empty" }, 400);
    }
    const message = body.message || `agent: sync ${name}`;
    // Pre-fetch the existing SHAs for each file in parallel.
    const existingShas: Record<string, string> = {};
    await Promise.all(body.files.map(async (f) => {
      if (!f.path) return;
      try {
        const e: any = await ghAppApi(env, request, `/repos/${env.GH_REPO}/contents/${encodeURIComponent(f.path)}?ref=${encodeURIComponent(agent.branch)}`);
        if (e?.sha) existingShas[f.path] = e.sha;
      } catch { /* new file */ }
    }));
    const errors: string[] = [];
    let lastSha: string | undefined;
    for (const f of body.files) {
      if (!f.path || typeof f.content !== "string") {
        errors.push(`file missing path or content`);
        continue;
      }
      try {
        const base64 = btoa(unescape(encodeURIComponent(f.content)));
        const r: any = await ghAppApi(env, request, `/repos/${env.GH_REPO}/contents/${encodeURIComponent(f.path)}`, {
          method: "PUT",
          body: JSON.stringify({
            message,
            content: base64,
            branch: agent.branch,
            sha: existingShas[f.path],
          }),
        });
        if (r?.commit?.sha) lastSha = r.commit.sha;
        else if (r?.content?.sha) lastSha = r.content.sha;
      } catch (err: any) {
        errors.push(`${f.path}: ${err?.message ?? err}`);
      }
    }
    agent.lastSyncedAt = Date.now();
    if (lastSha) agent.lastCommitSha = lastSha;
    agent.history.unshift({
      id: `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: Date.now(),
      type: "sync",
      ok: errors.length === 0,
      summary: errors.length === 0
        ? `Synced ${body.files.length} file(s) to ${agent.branch} (Pages will redeploy)`
        : `Sync failed: ${errors.join("; ")}`,
    });
    await env.ARTIFACTS.put(`agent:${name}`, JSON.stringify(agent));
    if (errors.length > 0) {
      return jsonResp({ ok: false, error: "Some files failed to commit", errors, agent }, 502);
    }
    return jsonResp({ ok: true, commitSha: lastSha, branch: agent.branch, fileCount: body.files.length });
  }

  // ── /api/cf/deploy/agent/:name/republish — re-Direct-Upload the latest R2 build
  // Useful when the user publishes a new build but Pages hasn't picked it up
  // (Direct Upload doesn't auto-deploy — you have to push it again).
  const republishMatch = subpath.match(/^\/deploy\/agent\/([^\/]+)\/republish$/);
  if (republishMatch && method === "POST") {
    const name = republishMatch[1];
    const agent = (await env.ARTIFACTS.get(`agent:${name}`, { type: "json" })) as AgentRecord | null;
    if (!agent) return jsonResp({ error: `Agent '${name}' not found` }, 404);
    const { accountId } = resolveCfCreds(env, request);
    if (!accountId) {
      return jsonResp({ error: "CF account ID required" }, 400);
    }
    if (!env.AGENT_BUILDS) return jsonResp({ error: "AGENT_BUILDS R2 bucket not configured" }, 503);
    try {
      const buildFiles = await readLatestBuildFromR2(env);
      const deploy = await directUploadToPages(env, request, accountId, agent.pagesProjectName, buildFiles);
      agent.lastSyncedAt = Date.now();
      agent.history.unshift({
        id: `republish-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: Date.now(),
        type: "republish",
        ok: true,
        summary: `Republished ${deploy.fileCount} files to ${agent.pagesProjectName}`,
        details: { deploymentId: deploy.deploymentId, totalBytes: deploy.totalBytes },
      });
      await env.ARTIFACTS.put(`agent:${name}`, JSON.stringify(agent));
      return jsonResp({ ok: true, ...deploy, url: `https://${agent.customDomain}` });
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      agent.history.unshift({
        id: `republish-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: Date.now(),
        type: "republish",
        ok: false,
        summary: `Republish failed: ${msg}`,
      });
      await env.ARTIFACTS.put(`agent:${name}`, JSON.stringify(agent));
      return jsonResp({ error: `Republish failed: ${msg}` }, 502);
    }
  }

  // ── /api/agent/:name/data — read a file from the agent's branch
  const agentDataGetMatch = subpath.match(/^\/agent\/([^\/]+)\/data$/);
  if (agentDataGetMatch && method === "GET") {
    const name = agentDataGetMatch[1];
    const agent = (await env.ARTIFACTS.get(`agent:${name}`, { type: "json" })) as AgentRecord | null;
    if (!agent) return jsonResp({ error: `Agent '${name}' not found` }, 404);
    const url = new URL(request.url);
    const path = url.searchParams.get("path") || "";
    if (!path) return jsonResp({ error: "path query param required (e.g. ?path=agent-data/memories.json)" }, 400);
    try {
      const file: any = await ghAppApi(env, request, `/repos/${env.GH_REPO}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(agent.branch)}`);
      if (!file?.content) return jsonResp({ error: `File ${path} not found on ${agent.branch}` }, 404);
      const content = atob(file.content.replace(/\n/g, ""));
      return jsonResp({ path, content, sha: file.sha, branch: agent.branch });
    } catch (err: any) {
      return jsonResp({ error: `Failed to read ${path}: ${err?.message ?? err}` }, 502);
    }
  }

  // ── /api/agent/:name/data — write a single file to the agent's branch
  if (agentDataGetMatch && method === "PUT") {
    const name = agentDataGetMatch[1];
    const agent = (await env.ARTIFACTS.get(`agent:${name}`, { type: "json" })) as AgentRecord | null;
    if (!agent) return jsonResp({ error: `Agent '${name}' not found` }, 404);
    const body = await request.json().catch(() => ({})) as { path?: string; content?: string; message?: string };
    if (!body.path || typeof body.content !== "string") {
      return jsonResp({ error: "path (string) and content (string) are required" }, 400);
    }
    // Look up existing SHA
    let existingSha: string | undefined;
    try {
      const e: any = await ghAppApi(env, request, `/repos/${env.GH_REPO}/contents/${encodeURIComponent(body.path)}?ref=${encodeURIComponent(agent.branch)}`);
      if (e?.sha) existingSha = e.sha;
    } catch { /* new file */ }
    try {
      const base64 = btoa(unescape(encodeURIComponent(body.content)));
      const r: any = await ghAppApi(env, request, `/repos/${env.GH_REPO}/contents/${encodeURIComponent(body.path)}`, {
        method: "PUT",
        body: JSON.stringify({
          message: body.message || `agent(${name}): write ${body.path}`,
          content: base64,
          branch: agent.branch,
          sha: existingSha,
        }),
      });
      agent.lastSyncedAt = Date.now();
      if (r?.commit?.sha) agent.lastCommitSha = r.commit.sha;
      agent.history.unshift({
        id: `data-write-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: Date.now(),
        type: "data-write",
        ok: true,
        summary: `Wrote ${body.path} to ${agent.branch}`,
      });
      await env.ARTIFACTS.put(`agent:${name}`, JSON.stringify(agent));
      return jsonResp({ ok: true, path: body.path, sha: r?.content?.sha, commitSha: r?.commit?.sha, branch: agent.branch });
    } catch (err: any) {
      return jsonResp({ error: `Failed to write ${body.path}: ${err?.message ?? err}` }, 502);
    }
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
    // Run everything we can in parallel: base SHA, file SHAs (don't need branch), and branch creation (needs base SHA)
    const [refData, existingFiles] = await Promise.all([
      ghFetch(env, `/repos/${env.GH_REPO}/git/ref/heads/${base}`),
      Promise.all(body.files.map(f =>
        ghFetch(env, `/repos/${env.GH_REPO}/contents/${encodeURIComponent(f.path)}?ref=${body.head}`)
          .catch(() => null)
      )),
    ]);
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
    await Promise.all(body.files.map(async (f, i) => {
      const existing = existingFiles[i];
      const sha = existing && (existing as any).sha ? (existing as any).sha : undefined;
      return ghFetch(env, `/repos/${env.GH_REPO}/contents/${encodeURIComponent(f.path)}`, {
        method: "PUT",
        body: JSON.stringify({
          message: body.title,
          content: btoa(unescape(encodeURIComponent(f.content))),
          branch: body.head,
          sha,
        }),
      });
    }));
    // 4. Open the PR
    const pr = await ghFetch(env, `/repos/${env.GH_REPO}/pulls`, {
      method: "POST",
      body: JSON.stringify({ title: body.title, body: body.body || "", head: body.head, base }),
    });
    const prNumber = (pr as any).number;
    const prUrl = (pr as any).html_url;
    // History append doesn't depend on the PR response - fire and forget
    void appendHistory(env, {
      id: `pr-${Date.now()}`,
      ts: Date.now(),
      actor: "user",
      type: "pr",
      ok: true,
      summary: `Opened PR #${prNumber}: ${body.title}`,
      details: { prNumber, url: prUrl, head: body.head, base, files: body.files.length },
    });
    return jsonResp({ ok: true, prNumber, url: prUrl });
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


