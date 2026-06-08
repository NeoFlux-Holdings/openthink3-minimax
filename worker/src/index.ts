// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// OpenThink3 Worker â€” Cloudflare Worker entry point.
//
// Storage layout (all CF-native, no external services):
//   - MEMORIES (KV)     â†’ thread chat history (via THREAD_DO)
//   - ARTIFACTS (KV)    â†’ deploy bundles, manifests, sync state
//   - OPENTHINK3_DB (D1) â†’ gbrain pages, edges, signals, threads, benchmarks
//   - GBRAIN_PAGES (Vectorize) â†’ 384-dim BGE embeddings for semantic recall
//   - THREAD_DO (DO)    â†’ per-thread stateful agent + chat streaming
//   - ORCHESTRATOR_DO   â†’ MCP server for gstack tool calls
//
// Skill routes (gbrain + gstack) live at /api/skill/{search,think,capture,run,evals}
// and are invoked by the SkillsPanel + ThreadFeed on the frontend.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ Intelligence Stack Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


// Build CORS headers that are valid for credentialed cross-origin requests.
// When the request is credentialed (SPA uses `credentials: "include"` to send
// the ot_session cookie + Authorization), the spec requires:
//   - a SPECIFIC origin (echoed from the request, never "*")
//   - Access-Control-Allow-Credentials: true
//   - Vary: Origin (to keep caches honest)
// Cloudflare surfaces a PreflightWildcardOriginNotAllowed error otherwise.
function corsHeadersFor(request: Request | null) {
  const origin = request?.headers.get("Origin") || request?.headers.get("origin") || "";
  const allowOrigin = origin || "*";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-CF-Token, X-CF-Account-Id, X-Requested-With",
    "Access-Control-Expose-Headers":
      "Content-Type, X-CF-Ray, X-CF-Account-Id",
  };
  if (origin) {
    // Only credentialed echo â€” required when the SPA uses `credentials: "include"`.
    headers["Access-Control-Allow-Credentials"] = "true";
    headers["Vary"] = "Origin";
  }
  return headers;
}

function jsonResp(data: any, status = 200, request: Request | null = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeadersFor(request), "Content-Type": "application/json" },
  });
}

async function proxyToBrain(env: Env, path: string, req: Request): Promise<Response> {
  const vmUrl = env.GBRAIN_VM_URL || "http://localhost:4000";
  const jsonRespC = (data: any, status = 200) => jsonResp(data, status, req);
  try {
    const upstream = new URL(path, vmUrl);
    const proxied = new Request(upstream.toString(), {
      method: req.method,
      headers: { "Content-Type": "application/json" },
      body: req.method !== "GET" ? req.body : undefined,
    });
    const r = await fetch(proxied);
    const body = await r.text();
    return new Response(body, { status: r.status, headers: { ...corsHeadersFor(req), "Content-Type": "application/json" } });
  } catch (err: any) {
    return jsonRespC({ error: "GBrain not reachable", detail: err.message }, 503);
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

// â”€â”€ Skill route dispatcher â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function handleSkillRoute(env: Env, request: Request, url: URL, ctx: ExecutionContext): Promise<Response> {
  const route = url.pathname.replace(/^\/api\/skill\//, "");
  const jsonRespC = (data: any, status = 200) => jsonResp(data, status, request);
  if (request.method !== "POST") {
    return jsonRespC({ error: `Method ${request.method} not allowed` }, 405);
  }

  switch (route) {
    case "capture": {
      const body = (await request.json().catch(() => ({}))) as Parameters<typeof handleCapture>[1];
      if (!body.threadId || !body.type || !body.content) {
        return jsonRespC({ error: "threadId, type, content are required" }, 400);
      }
      const r = await handleCapture(env, body);
      return jsonRespC(r);
    }
    case "search": {
      const body = (await request.json().catch(() => ({}))) as Parameters<typeof handleSearch>[1];
      if (!body.query) return jsonRespC({ error: "query is required" }, 400);
      const r = await handleSearch(env, body);
      return jsonRespC(r);
    }
    case "think": {
      const body = (await request.json().catch(() => ({}))) as Parameters<typeof handleThink>[1];
      if (!body.query) return jsonRespC({ error: "query is required" }, 400);
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
          ...corsHeadersFor(request),
        },
      });
    }
    case "run": {
      const body = (await request.json().catch(() => ({}))) as Parameters<typeof handleRun>[1];
      if (!body.command) return jsonRespC({ error: "command is required" }, 400);
      const r = await handleRun(env, body);
      return jsonRespC(r);
    }
    case "evals": {
      const body = ((await request.json().catch(() => ({}))) ?? {}) as Parameters<typeof handleEvals>[1];
      const r = await handleEvals(env, body);
      return jsonRespC(r);
    }
    default:
      return jsonRespC({ error: `Unknown skill route: ${route}` }, 404);
  }
}

// Main Worker routing
export default {
  // â”€â”€ Cron trigger handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Two crons configured in wrangler.toml:
  //   "0 5 * * *"  â†’ gbrain-dream (nightly memory consolidation)
  //   "0 6 * * *"  â†’ gbrain-evals (eval suite scorecard)
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
    // Local wrapper that always includes the request in CORS headers so
    // credentialed responses (SPA uses `credentials: "include"`) get a
    // specific echoed origin + Allow-Credentials: true, not `*`.
    const jsonRespC = (data: any, status = 200) => jsonResp(data, status, request);

    // CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeadersFor(request) });
    }

    // â”€â”€ OAuth (worker-side) â€” gates the deployed agent on custom domains â”€â”€
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

    // â”€â”€ Auth gate: block /api/* when host is a custom domain â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Skip the /api/cf/proxy/* paths â€” they authenticate the user via their
    // own Bearer token (the OAuth access token from the SPA's localStorage),
    // not the worker's session cookie.
    if (url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/cf/proxy/")) {
      const denied = await requireApiAuth(request, env);
      if (denied) return denied;
    }

    // â”€â”€ GitHub App installation flow (/api/github/*) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (url.pathname.startsWith("/api/github/")) {
      if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeadersFor(request) });
      }
      try {
        const sub = url.pathname.replace(/^\/api\/github\//, "");
        switch (sub) {
          case "install":
            if (request.method !== "GET") return jsonRespC({ error: "Method not allowed" }, 405);
            return handleGithubInstall(request, env);
          case "callback":
            return handleGithubCallback(request, env);
          case "repos":
            if (request.method !== "GET") return jsonRespC({ error: "Method not allowed" }, 405);
            return handleGithubRepos(request, env);
          case "status":
            if (request.method !== "GET") return jsonRespC({ error: "Method not allowed" }, 405);
            return handleGithubStatus(request, env);
          case "prs":
            if (request.method !== "POST") return jsonRespC({ error: "Method not allowed" }, 405);
            return handleGithubPR(request, env);
          case "issues":
            if (request.method !== "POST") return jsonRespC({ error: "Method not allowed" }, 405);
            return handleGithubIssue(request, env);
          case "device/code":
            if (request.method !== "POST") return jsonRespC({ error: "Method not allowed" }, 405);
            return handleGithubDeviceCode(request, env);
          case "device/token":
            if (request.method !== "POST") return jsonRespC({ error: "Method not allowed" }, 405);
            return handleGithubDeviceToken(request, env);
          case "device/cancel":
            if (request.method !== "POST") return jsonRespC({ error: "Method not allowed" }, 405);
            return handleGithubDeviceCancel(request, env);
          case "oauth/token":
            if (request.method !== "POST") return jsonRespC({ error: "Method not allowed" }, 405);
            return handleGithubOAuthToken(request, env);
          case "oauth/status":
            if (request.method !== "GET") return jsonRespC({ error: "Method not allowed" }, 405);
            return handleGithubOAuthStatus(request, env);
          case "oauth/revoke":
            if (request.method !== "POST") return jsonRespC({ error: "Method not allowed" }, 405);
            return handleGithubOAuthRevoke(request, env);
          case "webhook":
            return handleGithubWebhook(request, env);
          case "webhook/recent":
            if (request.method !== "GET") return jsonRespC({ error: "Method not allowed" }, 405);
            return handleGithubWebhookRecent(request, env);
          default:
            return jsonRespC({ error: `Unknown GitHub endpoint: ${sub}` }, 404);
        }
      } catch (err: any) {
        return jsonRespC({ error: err?.message ?? String(err) }, 500);
      }
    }

    // â”€â”€ Local Agent Bridge (/api/bridge/*) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (url.pathname.startsWith("/api/bridge")) {
      try {
        return await handleBridge(env, request, url, ctx);
      } catch (err: any) {
        return jsonRespC({ error: err?.message ?? String(err) }, 500);
      }
    }

    // â”€â”€ Brain API (/api/brain/*) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (url.pathname.startsWith("/api/brain/")) {
      const subpath = url.pathname.replace("/api/brain", "");

      // GET /api/brain/status â†’ probe gbrain HTTP server
      if (subpath === "/status" && request.method === "GET") {
        const r = await proxyToBrain(env, "/status", request);
        if (r.status === 503) {
          return jsonRespC({ connected: false, pageCount: 0, entityCount: 0, engine: "unknown", version: "" });
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

      return jsonRespC({ error: "Unknown brain endpoint" }, 404);
    }

    // â”€â”€ Eval API (/api/eval/*) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (url.pathname.startsWith("/api/eval/")) {
      const subpath = url.pathname.replace("/api/eval", "");

      // GET /api/eval/results â†’ fetch from KV
      if (subpath === "/results" && request.method === "GET") {
        const cached = await env.MEMORIES.get("eval:latest", { type: "json" });
        if (cached) return jsonRespC(cached);
        return jsonRespC({ error: "No eval results yet. Run an evaluation first." }, 404);
      }

      // GET /api/eval/history
      if (subpath === "/history" && request.method === "GET") {
        const history = await env.MEMORIES.get("eval:history", { type: "json" });
        return jsonRespC(history || []);
      }

      // POST /api/eval/run â†’ SSE stream of eval run via exe.dev
      if (subpath === "/run" && request.method === "POST") {
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        const sendEvent = async (data: object) => {
          await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        ctx.waitUntil((async () => {
          try {
            await sendEvent({ log: "ðŸš€ Connecting to eval runner on exe.dev VM..." });

            const cmd = "cd ~/gbrain-evals && bun run eval:run --json 2>&1";
            const { ok, output } = await execOnVM(env, cmd);

            if (!ok) {
              await sendEvent({ log: `âš ï¸ VM exec failed: ${output}` });
              await sendEvent({ log: "ðŸ’¡ Tip: Set EXE_DEV_TOKEN secret and deploy gbrain-evals to your VM" });
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
                  await sendEvent({ log: "âœ… Scorecard saved to KV!", scorecard });
                } catch {}
              }
            }
            await sendEvent({ done: true });
          } catch (err: any) {
            await sendEvent({ log: `âŒ Error: ${err.message}`, done: true });
          } finally {
            await writer.close();
          }
        })());

        return new Response(readable, {
          headers: { ...corsHeadersFor(request), "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" },
        });
      }

      return jsonRespC({ error: "Unknown eval endpoint" }, 404);
    }

    // â”€â”€ exe.dev exec proxy (/api/exec) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (url.pathname === "/api/exec" && request.method === "POST") {
      const body = await request.text();
      const { ok, output } = await execOnVM(env, body);
      return jsonRespC({ ok, output });
    }

    if (url.pathname === "/api/exec/vms" && request.method === "GET") {
      const token = env.EXE_DEV_TOKEN;
      if (!token) return jsonRespC({ error: "EXE_DEV_TOKEN not configured" }, 503);
      try {
        const r = await fetch("https://exe.dev/exec", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
          body: "ls --json",
        });
        return new Response(await r.text(), { headers: { ...corsHeadersFor(request), "Content-Type": "application/json" } });
      } catch (err: any) {
        return jsonRespC({ error: err.message }, 503);
      }
    }

    // â”€â”€ Plugin registry (/api/plugins/*) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (url.pathname === "/api/plugins" && request.method === "GET") {
      const registry = await env.MEMORIES.get("plugins:registry", { type: "json" });
      return jsonRespC(registry || []);
    }

    if (url.pathname === "/api/plugins" && request.method === "POST") {
      const body = await request.json() as { url?: string; plugin?: any };
      if (body.url) {
        // Fetch community plugin manifest
        try {
          const r = await fetch(body.url);
          if (!r.ok) return jsonRespC({ error: "Failed to fetch plugin manifest" }, 400);
          const manifest = await r.json() as any;
          // Validate minimal schema
          if (!manifest.id || !manifest.name) return jsonRespC({ error: "Invalid plugin manifest" }, 400);
          const registry = (await env.MEMORIES.get("plugins:registry", { type: "json" })) as any[] || [];
          registry.push({ ...manifest, source: "community", installedAt: new Date().toISOString() });
          await env.MEMORIES.put("plugins:registry", JSON.stringify(registry));
          return jsonRespC(manifest);
        } catch (err: any) {
          return jsonRespC({ error: err.message }, 500);
        }
      }
      return jsonRespC({ error: "Provide url or plugin" }, 400);
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
      return jsonRespC({ ok: true });
    }

    // â”€â”€ Cloudflare artifact sync (/api/cf/*) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (url.pathname === "/api/cf/github/platform/setup" && request.method === "POST") {
      const operatorPat = request.headers.get("X-Operator-Pat");
      if (!operatorPat) return jsonRespC({ error: "X-Operator-Pat header required (admin:org:read PAT from org owner)" }, 401);
      const body = await request.json().catch(() => ({})) as { org?: string };
      const org = body.org || "NeoFlux-Holdings";
      if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY || !env.GITHUB_INSTALL_TOKEN_KEY) {
        return jsonRespC({ error: "GITHUB_APP_ID/PRIVATE_KEY/INSTALL_TOKEN_KEY not configured on this worker" }, 503);
      }
      const listResp = await fetch(`https://api.github.com/orgs/${encodeURIComponent(org)}/installations`, {
        headers: {
          Authorization: `Bearer ${operatorPat}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "openthink3-worker",
        },
      });
      if (!listResp.ok) {
        const t = await listResp.text();
        return jsonRespC({ error: `Failed to list installations: ${listResp.status} ${t.slice(0, 200)}` }, 502);
      }
      const list = (await listResp.json()) as any;
      const installation = (list.installations || []).find((i: any) => String(i.app_id) === String(env.GITHUB_APP_ID));
      if (!installation) {
        return jsonRespC({
          error: `No installation of app ${env.GITHUB_APP_ID} on ${org}. Install at https://github.com/apps/open-think-auth/installations/new first.`,
        }, 404);
      }
      try {
        const result = await mintAndStorePlatformToken(env, String(installation.id), org);
        return jsonRespC({ ok: true, installationId: result.id, account: result.account, expiresAt: result.expiresAt });
      } catch (err: any) {
        return jsonRespC({ error: `Token mint failed: ${err?.message ?? err}` }, 502);
      }
    }

    if (url.pathname === "/api/cf/github/platform/status" && request.method === "GET") {
      const stored = await env.ARTIFACTS.get(`gh:install:token:${GH_PLATFORM_KEY}`, { type: "json" }) as any | null;
      if (!stored) return jsonRespC({ configured: false, hint: "Run scripts/setup-gh-platform.mjs to mint the platform token" });
      return jsonRespC({
        configured: true,
        account: stored.account,
        installationId: stored.id,
        cachedAt: stored.cachedAt,
        expiresAt: stored.expiresAt,
      });
    }



    if (url.pathname.startsWith("/api/cf")) {
      if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeadersFor(request) });
      }
      try {
        return await handleCf(env, request);
      } catch (err: any) {
        // CfHttpError carries an explicit status (4xx); anything else is 500.
        const status = err?.name === "CfHttpError" ? (err.status as number) : 500;
        return jsonRespC({ error: err?.message ?? String(err) }, status);
      }
    }

    // â”€â”€ Skill routes (gbrain + gstack) (/api/skill/*) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (url.pathname.startsWith("/api/skill/")) {
      if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeadersFor(request) });
      }
      try {
        return await handleSkillRoute(env, request, url, ctx);
      } catch (err: any) {
        return jsonRespC({ error: err?.message ?? String(err) }, 500);
      }
    }

    // â”€â”€ Benchmarks store (/api/benchmarks, /api/benchmarks/run) â”€â”€
    const benchRes = await handleBenchmarksRoute(env, request, url, ctx);
    if (benchRes) return benchRes;

    // â”€â”€ Thread routing (existing) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Cloudflare artifact sync â€” store worker bundles, manifests, deploy history
// in the ARTIFACTS KV namespace and proxy deploy/PR calls to the real
// Cloudflare REST API + GitHub API using server-side secrets.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// KV key conventions (all in env.ARTIFACTS):
//   manifest              â€” current deployed manifest JSON
//   worker:current       â€” current worker bundle (string, up to 25 MB)
//   worker:staged        â€” staged worker bundle waiting for deploy
//   pages:current        â€” { url, deployedAt } for the latest Pages deploy
//   history:list         â€” JSON array of { id, ts, actor, type, ok, summary }
//   history:{id}         â€” full deploy record JSON

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
  shortId: string;
  branch: string;
  pagesProjectName: string;
  pagesProjectId?: string;
  customDomain: string;
  ownerCfAccountId: string;
  cfAccountId: string;
  githubOwner: string;
  githubRepo: string;
  mode: "platform" | "user";
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

// â”€â”€ App-based GH client (uses the GitHub App installation token, not a PAT) â”€
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
  if (!session) throw new Error("not_signed_in: please sign in with the open-think-auth GitHub App (visit /github and install it)");
  const accountKey = session.accountId || session.sub;
  const stored = (await env.ARTIFACTS.get(`gh:install:token:${accountKey}`, { type: "json" })) as
    | { tokenCiphertext: string; id: number }
    | null;
  if (!stored) {
    throw new Error("github_app_not_installed: visit /github and install the open-think-auth GitHub App on your account");
  }
  return ghApiWithToken(env, stored.tokenCiphertext, path, init);
}

// Platform mode: uses the org-level GitHub App installation token (one-time
// setup via the GitHub App installed on NeoFlux-Holdings). No user session
// is required — the worker creates branches and commits on behalf of the
// platform. The operator installs the App on the org once and the
// installation.created webhook stores the encrypted token at
// `gh:install:token:platform`. The default mode for new agents.
const GH_PLATFORM_KEY = "platform";
async function ghServiceApi(env: Env, path: string, init: RequestInit = {}): Promise<any> {
  if (!env.GITHUB_INSTALL_TOKEN_KEY) {
    throw new Error("GITHUB_INSTALL_TOKEN_KEY not configured on this worker");
  }
  const stored = (await env.ARTIFACTS.get(`gh:install:token:${GH_PLATFORM_KEY}`, { type: "json" })) as
    | { tokenCiphertext: string; id: number; account?: string; cachedAt?: number }
    | null;
  if (!stored) {
    throw new Error(
      "platform_branch_unavailable: install the open-think-auth GitHub App on NeoFlux-Holdings once and the webhook will store the platform token automatically. See scripts/setup-gh-platform.mjs.",
    );
  }
  return ghApiWithToken(env, stored.tokenCiphertext, path, init);
}

// Pick the right GH client based on an agent's stored mode. The
// sync + agent-data endpoints use this so the same code path works
// for both platform- and user-mode agents.
function ghApiForAgent(env: Env, request: Request, agent: AgentRecord) {
  return agent.mode === "user"
    ? (p: string, i: RequestInit = {}) => ghAppApi(env, request, p, i)
    : (p: string, i: RequestInit = {}) => ghServiceApi(env, p, i);
}

async function ghApiWithToken(env: Env, tokenCiphertext: string, path: string, init: RequestInit = {}): Promise<any> {
  const token = await agentDecryptToken(tokenCiphertext, env.GITHUB_INSTALL_TOKEN_KEY!);
  const url = `https://api.github.com${path}`;
  const r = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> || {}),
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "openthink3-worker",
      "Content-Type": "application/json",
    },
  });
  const text = await r.text();
  let body: any;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (r.status >= 400) {
    const msg = body?.message || `GitHub API ${r.status}`;
    const errBody = text ? text.slice(0, 600) : "(empty)";
    console.log("[ghAppApi] error", { path, method: init.method || "GET", status: r.status, msg, errBody });
    throw new Error(`${msg} (${r.status})`);
  }
  console.log("[ghAppApi] ok", { path, method: init.method || "GET", status: r.status });
  return body;
}

// ── One-shot setup helper: mint a platform installation token directly
//    (no user install flow). Used by the CLI script (scripts/setup-gh-platform.mjs)
//    and by the webhook when an installation event lands. The token is
//    encrypted with GITHUB_INSTALL_TOKEN_KEY and stored at
//    `gh:install:token:platform` so ghServiceApi() can use it later.
async function mintAndStorePlatformToken(env: Env, installationId: string, accountLogin?: string): Promise<{ id: number; account: string; expiresAt: string }> {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    throw new Error("GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY not configured");
  }
  if (!env.GITHUB_INSTALL_TOKEN_KEY) {
    throw new Error("GITHUB_INSTALL_TOKEN_KEY not configured");
  }
  // Sign a JWT as the App.
  const der = pemToDerBytes(env.GITHUB_APP_PRIVATE_KEY);
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64urlEncode(JSON.stringify({ iat: now - 60, exp: now + 60 * 9, iss: env.GITHUB_APP_ID }));
  const signingInput = `${header}.${payload}`;
  const sigBuf = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${b64urlEncode(sigBuf)}`;
  // Exchange JWT + installation_id for an installation access token.
  const r = await fetch(
    `https://api.github.com/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "openthink3-worker",
      },
    },
  );
  const text = await r.text();
  let data: any;
  try { data = JSON.parse(text); } catch {
    throw new Error(`mint installation token failed: ${r.status} ${text.slice(0, 200)}`);
  }
  if (!r.ok || !data?.token) {
    throw new Error(`mint installation token failed: ${r.status} ${JSON.stringify(data).slice(0, 300)}`);
  }
  // Encrypt + store.
  const keyBytes = agentHexToBytes(env.GITHUB_INSTALL_TOKEN_KEY);
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, new TextEncoder().encode(data.token));
  const ivB64 = btoa(String.fromCharCode(...iv));
  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ct)));
  const ciphertext = `${ivB64}:${ctB64}`;
  const account = accountLogin || data.account?.login || "unknown";
  await env.ARTIFACTS.put(
    `gh:install:token:${GH_PLATFORM_KEY}`,
    JSON.stringify({ id: data.id, account, tokenCiphertext: ciphertext, cachedAt: Date.now(), expiresAt: data.expires_at }),
  );
  return { id: data.id, account, expiresAt: data.expires_at };
}

function b64urlEncode(bytes: ArrayBuffer | Uint8Array | string): string {
  let bin: string;
  if (typeof bytes === "string") {
    bin = bytes;
  } else {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    bin = "";
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Short alphanumeric ID (8 chars, base36) used to disambiguate
// globally-unique branch / Pages project names on GitHub + Cloudflare.
// Multiple CF accounts can pick the same friendly "agentName" without
// colliding on shared org-level resources because the shortId makes the
// underlying branch + project names unique.
function randomShortId(len = 8): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function pemToDerBytes(pem: string): Uint8Array {
  const clean = pem.replace(/-----BEGIN [^-]+-----/g, "").replace(/-----END [^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Process a GitHub App installation event payload and store the
// platform token. Idempotent — overwrites the previous token (which is
// fine; the old one is expired anyway).
async function handleInstallationEvent(env: Env, payload: any): Promise<{ action: string; stored: boolean; installationId?: number; account?: string }> {
  if (payload?.action !== "created" && payload?.action !== "reinstalled") {
    return { action: payload?.action ?? "unknown", stored: false };
  }
  const installation = payload.installation;
  if (!installation?.id) {
    return { action: payload?.action, stored: false };
  }
  const accountLogin: string = installation.account?.login || "unknown";
  const result = await mintAndStorePlatformToken(env, String(installation.id), accountLogin);
  return { action: payload.action, stored: true, installationId: result.id, account: result.account };
}

// â”€â”€ Direct Upload helper: push a set of files to a Pages project â”€â”€â”€â”€â”€â”€
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

// â”€â”€ Helper: stream the latest build out of R2 as a list of {path, content} â”€â”€
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
  // Local wrapper that always includes the request in CORS headers so
  // credentialed responses (SPA uses `credentials: "include"`) get a
  // specific echoed origin + Allow-Credentials: true, not `*`.
  const jsonRespC = (data: any, status = 200) => jsonResp(data, status, request);

  // â”€â”€ /api/cf/agent/publish-build â€” upload a build (multipart) to R2
  // Form fields: "files" (one or more file blobs). The relative file name
  // is preserved (e.g. dist/index.html -> builds/latest/index.html).
  // Overwrites builds/latest/* atomically.
  if (subpath === "/agent/publish-build" && method === "POST") {
    if (!env.AGENT_BUILDS) return jsonRespC({ error: "AGENT_BUILDS R2 bucket not configured" }, 503);
    let formData: FormData;
    try { formData = await request.formData(); } catch {
      return jsonRespC({ error: "Expected multipart/form-data with 'files' field" }, 400);
    }
    const files = formData.getAll("files") as unknown as File[];
    if (!files || files.length === 0) {
      return jsonRespC({ error: "No files uploaded. Send multipart/form-data with 'files' field." }, 400);
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
    return jsonRespC({ ok: true, ...manifest });
  }

  // â”€â”€ /api/cf/agent/build/list â€” list files in builds/latest/
  if (subpath === "/agent/build/list" && method === "GET") {
    if (!env.AGENT_BUILDS) return jsonRespC({ error: "AGENT_BUILDS R2 bucket not configured" }, 503);
    const list = await env.AGENT_BUILDS.list({ prefix: "builds/latest/" });
    const files = list.objects
      .filter((o) => !o.key.endsWith("/_manifest.json"))
      .map((o) => ({ path: o.key.replace(/^builds\/latest\//, ""), size: o.size, uploaded: o.uploaded }));
    let manifest: any = null;
    const m = await env.AGENT_BUILDS.get("builds/latest/_manifest.json");
    if (m) {
      try { manifest = JSON.parse(await m.text()); } catch { /* ignore */ }
    }
    return jsonRespC({ files, manifest });
  }

  // â”€â”€ /api/cf/status â€” diagnostic (what's configured, what's not)
  if (subpath === "/status" && method === "GET") {
    const { source } = resolveCfCreds(env, request);
    return jsonRespC({
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

  // â”€â”€ /api/cf/proxy/{userinfo,accounts} â€” CORS-free proxy for the SPA.
  // CF's userinfo + /accounts endpoints don't return Access-Control-Allow-Origin,
  // so a browser-based SPA can't read them directly. We proxy server-side and
  // re-emit CORS so the SPA can read the body. The SPA's Bearer token is the
  // OAuth access token from localStorage; the auth gate already skips /api/cf/proxy/*.
  if (subpath.startsWith("/proxy/")) {
    const tail = subpath.replace(/^\/proxy\//, "");
    const auth = request.headers.get("Authorization") || "";
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) return jsonRespC({ error: "Missing Authorization: Bearer <token>" }, 401);
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
        return jsonRespC({ error: `Unknown proxy path: ${tail}` }, 404);
    }
    try {
      const r = await fetch(upstreamUrl, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      const body = await r.text();
      return new Response(body, {
        status: r.status,
        headers: {
          ...corsHeadersFor(request),
          "Content-Type": r.headers.get("Content-Type") || "application/json",
        },
      });
    } catch (err: any) {
      return jsonRespC({ error: `proxy failed: ${err?.message ?? String(err)}` }, 502);
    }
  }

  // â”€â”€ /api/cf/resolve-account â€” discover account/zones for a per-request token
  if (subpath === "/resolve-account" && method === "POST") {
    const body = await request.json().catch(() => ({})) as { token?: string };
    const token = body?.token;
    if (!token || typeof token !== "string") {
      return jsonRespC({ error: "Body must include { token: string }" }, 400);
    }
    const cfHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    try {
      const accountsRes: any = await fetch("https://api.cloudflare.com/client/v4/accounts?per_page=50", { headers: cfHeaders }).then(r => r.json());
      if (!accountsRes.success) {
        const msg = (accountsRes.errors || []).map((e: any) => e.message).join("; ") || "Failed to list accounts";
        return jsonRespC({ error: msg }, 502);
      }
      const account = (accountsRes.result || [])[0];
      if (!account) {
        return jsonRespC({ error: "No accounts found for this token" }, 404);
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
      return jsonRespC({
        ok: true,
        accountId,
        accountName: account.name,
        email: account.owner?.email ?? null,
        hasWorkers: Array.isArray(workersRes.result) && workersRes.result.length > 0,
        hasPages: Array.isArray(pagesRes.result) && pagesRes.result.length > 0,
        zones,
      });
    } catch (err: any) {
      return jsonRespC({ error: err?.message ?? String(err) }, 500);
    }
  }

  // â”€â”€ /api/cf/zones â€” list user's Cloudflare zones (live)
  if (subpath === "/zones" && method === "GET") {
    const data = await cfFetch(env, request, "/zones?per_page=50");
    const zones = (data.result || []).map((z: any) => ({
      id: z.id, name: z.name, status: z.status,
    }));
    return jsonRespC({ zones, source: "live" });
  }

  // â”€â”€ /api/cf/workers â€” list existing worker scripts
  if (subpath === "/workers" && method === "GET") {
    const { accountId } = resolveCfCreds(env, request);
    if (!accountId) return jsonRespC({ error: "CF account ID required. Provide X-CF-Account-Id header or set CF_ACCOUNT_ID env var." }, 400);
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
    return jsonRespC({ workers: enriched, source: "live" });
  }

  // â”€â”€ /api/cf/manifest â€” current deployed manifest
  if (subpath === "/manifest" && method === "GET") {
    const manifest = await loadManifest(env);
    const staged = !!(await env.ARTIFACTS.get("worker:staged"));
    return jsonRespC({ manifest, staged });
  }

  // â”€â”€ /api/cf/bundle/worker â€” GET current, POST/PUT to stage
  if (subpath === "/bundle/worker" && method === "GET") {
    const code = await env.ARTIFACTS.get("worker:current");
    if (!code) return jsonRespC({ error: "No worker bundle stored yet" }, 404);
    return new Response(code, {
      headers: { ...corsHeadersFor(request), "Content-Type": "application/javascript" },
    });
  }
  if (subpath === "/bundle/worker" && (method === "POST" || method === "PUT")) {
    const body = await request.json() as { code?: string; meta?: { sha256?: string; bytes?: number; source?: string } };
    if (!body.code || typeof body.code !== "string") {
      return jsonRespC({ error: "Body must include { code: string }" }, 400);
    }
    if (body.code.length > 25 * 1024 * 1024) {
      return jsonRespC({ error: "Bundle exceeds KV 25 MB value limit" }, 413);
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
      summary: `Staged worker bundle (${(stagedMeta.bytes / 1024).toFixed(1)} KB${meta.sha256 ? `, sha ${meta.sha256.slice(0, 10)}â€¦` : ""})`,
    });
    return jsonRespC({ ok: true, staged: stagedMeta });
  }

  // â”€â”€ /api/cf/deploy/worker â€” push staged bundle to Cloudflare via REST API
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
      return jsonRespC({ error: "No bundle to deploy. POST one to /api/cf/bundle/worker first." }, 400);
    }
    const { accountId } = resolveCfCreds(env, request);
    if (!accountId) return jsonRespC({ error: "CF account ID required. Provide X-CF-Account-Id header or set CF_ACCOUNT_ID env var." }, 400);
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
    // Promote staged â†’ current, delete staged, write manifest, append history â€” all independent writes
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
    return jsonRespC({ ok: true, manifest });
  }

  // â”€â”€ /api/cf/deploy/pages â€” record a Pages deployment intent
  if (subpath === "/deploy/pages" && method === "POST") {
    const body = await request.json().catch(() => ({})) as { projectName?: string; branch?: string };
    if (!body.projectName) return jsonRespC({ error: "projectName required" }, 400);
    const branch = body.branch || "main";
    const { accountId } = resolveCfCreds(env, request);
    if (!accountId) return jsonRespC({ error: "CF account ID required. Provide X-CF-Account-Id header or set CF_ACCOUNT_ID env var." }, 400);
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
    return jsonRespC({
      ok: true,
      projectName: body.projectName,
      branch,
      note: "Direct-upload pipeline is a wrangler concern. This endpoint records intent and surfaces the current Pages project state.",
      latestDeployment: list.result?.[0] ?? null,
    });
  }

  // â”€â”€ /api/cf/pages/attach-domain â€” attach a custom domain to a Pages project
  // Body: { domain: "subdomain.example.com", projectName?: "openthink-harness" }
  // Returns: { ok, url, status, result, source }
  if (subpath === "/pages/attach-domain" && method === "POST") {
    const body = await request.json().catch(() => ({})) as { domain?: string; projectName?: string };
    if (!body.domain || typeof body.domain !== "string") {
      return jsonRespC({ error: "domain (string) is required in body" }, 400);
    }
    const projectName = body.projectName || "openthink-harness";
    let cfData: any;
    try {
      const accountId = resolveCfCreds(env, request).accountId;
      if (!accountId) {
        return jsonRespC({ error: "CF account ID required. Set CF_ACCOUNT_ID env var or pass X-CF-Account-Id header." }, 400);
      }
      cfData = await cfFetch(env, request, `/accounts/${accountId}/pages/projects/${projectName}/domains`, {
        method: "POST",
        body: JSON.stringify({ name: body.domain }),
      });
    } catch (err: any) {
      // cfFetch throws on !success; extract a useful message.
      const msg = String(err?.message ?? err);
      return jsonRespC({ error: `Cloudflare rejected the domain attach: ${msg}` }, 502);
    }
    const result = cfData.result ?? {};
    return jsonRespC({
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

  // â”€â”€ /api/cf/deploy/agent â€” per-agent monorepo provisioning â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Body: { agentName: string, customDomain: string }
  // For each new agent:
  //   1. Create a branch `agent/<name>` in the monorepo (env.GH_REPO)
  //   2. Commit agent-data/config.json to the branch
  //   3. Create a Pages project `agent-<name>` bound to the branch
  //   4. Attach the user's customDomain to the Pages project
  //   5. Store an agent record in KV
  // Pages auto-deploys on every push to the agent's branch.
  if (subpath === "/deploy/agent" && method === "POST") {
    const body = await request.json().catch(() => ({})) as { agentName?: string; customDomain?: string; force?: boolean; mode?: "platform" | "user" };
    if (!body.agentName || typeof body.agentName !== "string") {
      return jsonRespC({ error: "agentName (string) is required" }, 400);
    }
    if (!body.customDomain || typeof body.customDomain !== "string") {
      return jsonRespC({ error: "customDomain (string) is required" }, 400);
    }
    // Default mode: "platform" — worker uses its own GitHub App installation
    // on NeoFlux-Holdings. The end user does NOT need to install the App.
    // "user" mode: advanced users with their own installation can submit
    // from their own branch.
    const ghMode: "platform" | "user" = body.mode === "user" ? "user" : "platform";
    const ghApi = ghMode === "user"
      ? (p: string, i: RequestInit = {}) => ghAppApi(env, request, p, i)
      : (p: string, i: RequestInit = {}) => ghServiceApi(env, p, i);
    const { accountId } = resolveCfCreds(env, request);
    if (!accountId) {
      return jsonRespC({ error: "CF account ID required. Set CF_ACCOUNT_ID env var or pass X-CF-Account-Id header." }, 400);
    }
    if (!env.GH_REPO) return jsonRespC({ error: "GH_REPO var is not configured" }, 503);
    const sanitized = body.agentName.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    if (!sanitized) {
      return jsonRespC({ error: "agentName produced an empty branch name (use letters, numbers, or hyphens)" }, 400);
    }
    // Per-CF-account check: the user-friendly agent name is scoped to
    // their CF account (so two different users can both pick
    // "agent-orange-0" without colliding on each other's records).
    // The branch + Pages project names get a shortId suffix so the
    // underlying GitHub + Cloudflare resources are globally unique.
    const existing = (await env.ARTIFACTS.get(`agent:${sanitized}`, { type: "json" })) as AgentRecord | null;
    if (existing) {
      // Allow retry when the previous attempt errored (e.g. user wasn't
      // signed in to the GitHub App yet, or the underlying branch +
      // Pages project were deleted out-of-band from the web UI). Only
      // block when the agent is active AND the underlying resources
      // are still present (checked best-effort via the Pages API).
      if (existing.status === "error" || body.force) {
        await env.ARTIFACTS.delete(`agent:${sanitized}`);
        await env.ARTIFACTS.delete(`agent-domain:${existing.customDomain}`);
      } else {
        // Try to confirm the Pages project still exists; if not, this
        // is a stale record (user deleted from the web) — auto-recover.
        let pagesGone = false;
        try {
          await cfFetch(env, request, `/accounts/${accountId}/pages/projects/${existing.pagesProjectName}`);
        } catch (err: any) {
          if (String(err?.message ?? err).includes("(404)")) {
            pagesGone = true;
          }
        }
        if (pagesGone || body.force) {
          await env.ARTIFACTS.delete(`agent:${sanitized}`);
          await env.ARTIFACTS.delete(`agent-domain:${existing.customDomain}`);
        } else {
          return jsonRespC({
            error: `Agent '${sanitized}' already exists and is active. Pass force: true to recreate it.`,
            agent: existing,
            hint: `Or use a different name — branches are scoped per CF account, but the underlying GitHub branch + Pages project get a unique shortId suffix.`,
          }, 409);
        }
      }
    }
    // Generate a short random ID for global uniqueness on GH + CF.
    // Re-roll if we somehow collide (extremely unlikely with 36^8).
    let shortId = randomShortId(8);
    const [ghOwner, ghRepo] = env.GH_REPO.split("/");
    // Probe the branch ref to make sure it doesn't exist yet.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await ghApi(`/repos/${env.GH_REPO}/git/ref/heads/agent/${sanitized}-${shortId}`);
        // If no throw, the branch already exists — re-roll.
        shortId = randomShortId(8);
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (msg.includes("404")) break; // branch doesn't exist — good
        // Anything else: re-roll and try again.
        shortId = randomShortId(8);
      }
    }
    const branch = `agent/${sanitized}-${shortId}`;
    const projectName = `agent-${sanitized}-${shortId}`;
    const agent: AgentRecord = {
      name: sanitized,
      shortId,
      branch,
      pagesProjectName: projectName,
      customDomain: body.customDomain,
      ownerCfAccountId: accountId,
      cfAccountId: accountId,
      githubOwner: ghOwner,
      githubRepo: ghRepo,
      mode: ghMode,
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

    // Step 1: create the branch from the repo's default branch
    // (idempotent on "Reference already exists"). Resolve the default
    // branch dynamically — many repos still use "master" instead of
    // "main" and hardcoding one would 404 the other.
    try {
      // First try the repo's declared default branch.
      const repoInfo: any = await ghApi(`/repos/${env.GH_REPO}`);
      const defaultBranch: string = repoInfo?.default_branch || "main";
      let baseSha: string | undefined;
      try {
        const ref: any = await ghApi(`/repos/${env.GH_REPO}/git/ref/heads/${defaultBranch}`);
        baseSha = ref?.object?.sha;
      } catch (e: any) {
        // Fall back to "main" then "master" if the default is weird.
        for (const candidate of ["main", "master"]) {
          if (candidate === defaultBranch) continue;
          try {
            const ref: any = await ghApi(`/repos/${env.GH_REPO}/git/ref/heads/${candidate}`);
            baseSha = ref?.object?.sha;
            if (baseSha) break;
          } catch { /* try next */ }
        }
      }
      if (!baseSha) throw new Error("Could not resolve default branch SHA");
      try {
        await ghApi(`/repos/${env.GH_REPO}/git/refs`, {
          method: "POST",
          body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
        });
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (!msg.includes("Reference already exists") && !msg.includes("422")) throw err;
      }
      pushHistory("branch-create", true, `Created branch ${branch} from ${defaultBranch}`);
    } catch (err: any) {
      pushHistory("branch-create", false, `Failed to create branch: ${err?.message ?? err}`);
      agent.status = "error";
      await env.ARTIFACTS.put(`agent:${sanitized}`, JSON.stringify(agent));
      return jsonRespC({ error: `Failed to create branch: ${err?.message ?? err}` }, 502);
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
      // If the file already exists on this branch (e.g. from a previous
      // errored attempt that left a config), GitHub requires the
      // existing file's sha to update it. Look it up first.
      let existingSha: string | undefined;
      try {
        const existing: any = await ghApi(`/repos/${env.GH_REPO}/contents/agent-data/config.json?ref=${encodeURIComponent(branch)}`);
        if (existing?.sha) existingSha = existing.sha;
      } catch { /* file doesn't exist yet — first write */ }
      const r: any = await ghApi(`/repos/${env.GH_REPO}/contents/agent-data/config.json`, {
        method: "PUT",
        body: JSON.stringify({
          message: `agent: initialize ${sanitized}`,
          content: base64,
          branch,
          ...(existingSha ? { sha: existingSha } : {}),
        }),
      });
      pushHistory("config-commit", true, `Committed agent-data/config.json`, { sha: r?.content?.sha });
    } catch (err: any) {
      pushHistory("config-commit", false, `Failed to commit config: ${err?.message ?? err}`);
      agent.status = "error";
      await env.ARTIFACTS.put(`agent:${sanitized}`, JSON.stringify(agent));
      return jsonRespC({ error: `Branch created, config commit failed: ${err?.message ?? err}` }, 502);
    }

    // Step 3: create the Pages project (Direct Upload only â€” no Git connection).
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
      return jsonRespC({
        error: `Branch + config ready, but Pages project creation failed: ${msg}`,
        hint: "Direct Upload only â€” no Git connection required. Verify the CF token has account:pages:edit.",
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
        // Don't bail â€” the project is created and the branch has config.
        // The user can re-publish via /api/cf/deploy/agent/:name/republish.
      }
    } else {
      pushHistory("pages-deploy", false, "AGENT_BUILDS R2 bucket not configured â€” skipped initial deploy");
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

    return jsonRespC({
      ok: true,
      agent,
      url: `https://${body.customDomain}`,
      pagesUrl: `https://${projectName}.pages.dev`,
      initialDeployment: initialDeployment ?? null,
    });
  }

  // â”€â”€ /api/cf/deploy/agent/list â€” list agents owned by the calling CF account
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
    return jsonRespC({ agents });
  }

  // â”€â”€ /api/cf/deploy/agent/:name â€” get a single agent record
  const agentDetailMatch = subpath.match(/^\/deploy\/agent\/([^\/]+)$/);
  if (agentDetailMatch && method === "GET") {
    const name = agentDetailMatch[1];
    const agent = await env.ARTIFACTS.get(`agent:${name}`, { type: "json" });
    if (!agent) return jsonRespC({ error: `Agent '${name}' not found` }, 404);
    return jsonRespC({ agent });
  }

  // â”€â”€ /api/cf/deploy/agent/:name/sync â€” commit files to the agent's branch
  // Pages auto-deploys on push. Body: { files: [{path, content}], message?: string }
  const agentSyncMatch = subpath.match(/^\/deploy\/agent\/([^\/]+)\/sync$/);
  if (agentSyncMatch && method === "POST") {
    const name = agentSyncMatch[1];
    const agent = (await env.ARTIFACTS.get(`agent:${name}`, { type: "json" })) as AgentRecord | null;
    if (!agent) return jsonRespC({ error: `Agent '${name}' not found` }, 404);
    const ghApi = ghApiForAgent(env, request, agent);
    const body = await request.json().catch(() => ({})) as {
      files?: Array<{ path?: string; content?: string }>;
      message?: string;
    };
    if (!body.files || !Array.isArray(body.files) || body.files.length === 0) {
      return jsonRespC({ error: "files[] is required and must be non-empty" }, 400);
    }
    const message = body.message || `agent: sync ${name}`;
    // Pre-fetch the existing SHAs for each file in parallel.
    const existingShas: Record<string, string> = {};
    await Promise.all(body.files.map(async (f) => {
      if (!f.path) return;
      try {
        const e: any = await ghApi(`/repos/${env.GH_REPO}/contents/${encodeURIComponent(f.path)}?ref=${encodeURIComponent(agent.branch)}`);
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
      return jsonRespC({ ok: false, error: "Some files failed to commit", errors, agent }, 502);
    }
    return jsonRespC({ ok: true, commitSha: lastSha, branch: agent.branch, fileCount: body.files.length });
  }

  // â”€â”€ /api/cf/deploy/agent/:name/republish â€” re-Direct-Upload the latest R2 build
  // Useful when the user publishes a new build but Pages hasn't picked it up
  // (Direct Upload doesn't auto-deploy â€” you have to push it again).
  const republishMatch = subpath.match(/^\/deploy\/agent\/([^\/]+)\/republish$/);
  if (republishMatch && method === "POST") {
    const name = republishMatch[1];
    const agent = (await env.ARTIFACTS.get(`agent:${name}`, { type: "json" })) as AgentRecord | null;
    if (!agent) return jsonRespC({ error: `Agent '${name}' not found` }, 404);
    const { accountId } = resolveCfCreds(env, request);
    if (!accountId) {
      return jsonRespC({ error: "CF account ID required" }, 400);
    }
    if (!env.AGENT_BUILDS) return jsonRespC({ error: "AGENT_BUILDS R2 bucket not configured" }, 503);
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
      return jsonRespC({ ok: true, ...deploy, url: `https://${agent.customDomain}` });
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
      return jsonRespC({ error: `Republish failed: ${msg}` }, 502);
    }
  }

  // ── /api/cf/deploy/agent/:name — DELETE: clean up an agent's KV record
  //     and (best-effort) the underlying branch + Pages project. Used
  //     when the user nukes from the web and wants to start fresh, or
  //     when an errored record needs purging.
  const agentDeleteMatch = subpath.match(/^\/deploy\/agent\/([^\/]+)$/);
  if (agentDeleteMatch && method === "DELETE") {
    const name = agentDeleteMatch[1];
    const agent = (await env.ARTIFACTS.get(`agent:${name}`, { type: "json" })) as AgentRecord | null;
    if (!agent) return jsonRespC({ error: `Agent '${name}' not found` }, 404);
    const { accountId } = resolveCfCreds(env, request);
    if (!accountId) {
      return jsonRespC({ error: "CF account ID required" }, 400);
    }
    const results: any = { kv: true, github: null, pages: null };
    // Best-effort: delete the branch on GH.
    try {
      await ghApiForAgent(env, request, agent)(`/repos/${env.GH_REPO}/git/refs/heads/${agent.branch}`, { method: "DELETE" });
      results.github = "deleted";
    } catch (err: any) {
      results.github = `failed: ${err?.message ?? err}`;
    }
    // Best-effort: delete the Pages project.
    try {
      await cfFetch(env, request, `/accounts/${accountId}/pages/projects/${agent.pagesProjectName}`, { method: "DELETE" });
      results.pages = "deleted";
    } catch (err: any) {
      results.pages = `failed: ${err?.message ?? err}`;
    }
    // Always remove the KV record (the user's intent).
    await env.ARTIFACTS.delete(`agent:${name}`);
    if (agent.customDomain) {
      await env.ARTIFACTS.delete(`agent-domain:${agent.customDomain}`);
    }
    return jsonRespC({ ok: true, name, results });
  }

  // ── /api/agent/:name/data — read a file from the agent's branch
  const agentDataGetMatch = subpath.match(/^\/agent\/([^\/]+)\/data$/);
  if (agentDataGetMatch && method === "GET") {
    const name = agentDataGetMatch[1];
    const agent = (await env.ARTIFACTS.get(`agent:${name}`, { type: "json" })) as AgentRecord | null;
    if (!agent) return jsonRespC({ error: `Agent '${name}' not found` }, 404);
    const ghApi = ghApiForAgent(env, request, agent);
    const url = new URL(request.url);
    const path = url.searchParams.get("path") || "";
    if (!path) return jsonRespC({ error: "path query param required (e.g. ?path=agent-data/memories.json)" }, 400);
    try {
      const file: any = await ghApi(`/repos/${env.GH_REPO}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(agent.branch)}`);
      if (!file?.content) return jsonRespC({ error: `File ${path} not found on ${agent.branch}` }, 404);
      const content = atob(file.content.replace(/\n/g, ""));
      return jsonRespC({ path, content, sha: file.sha, branch: agent.branch });
    } catch (err: any) {
      return jsonRespC({ error: `Failed to read ${path}: ${err?.message ?? err}` }, 502);
    }
  }

  // ── /api/agent/:name/data — write a single file to the agent's branch
  if (agentDataGetMatch && method === "PUT") {
    const name = agentDataGetMatch[1];
    const agent = (await env.ARTIFACTS.get(`agent:${name}`, { type: "json" })) as AgentRecord | null;
    if (!agent) return jsonRespC({ error: `Agent '${name}' not found` }, 404);
    const ghApi = ghApiForAgent(env, request, agent);
    const body = await request.json().catch(() => ({})) as { path?: string; content?: string; message?: string };
    if (!body.path || typeof body.content !== "string") {
      return jsonRespC({ error: "path (string) and content (string) are required" }, 400);
    }
    // Look up existing SHA
    let existingSha: string | undefined;
    try {
      const e: any = await ghApi(`/repos/${env.GH_REPO}/contents/${encodeURIComponent(body.path)}?ref=${encodeURIComponent(agent.branch)}`);
      if (e?.sha) existingSha = e.sha;
    } catch { /* new file */ }
    try {
      const base64 = btoa(unescape(encodeURIComponent(body.content)));
      const r: any = await ghApi(`/repos/${env.GH_REPO}/contents/${encodeURIComponent(body.path)}`, {
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
      return jsonRespC({ ok: true, path: body.path, sha: r?.content?.sha, commitSha: r?.commit?.sha, branch: agent.branch });
    } catch (err: any) {
      return jsonRespC({ error: `Failed to write ${body.path}: ${err?.message ?? err}` }, 502);
    }
  }

  // â”€â”€ /api/cf/history â€” list of past deploys / stages / PRs
  if (subpath === "/history" && method === "GET") {
    const list: HistoryEntry[] = (await env.ARTIFACTS.get("history:list", { type: "json" })) || [];
    return jsonRespC({ history: list });
  }

  // â”€â”€ /api/cf/github/pr â€” create a PR with a list of file changes
  if (subpath === "/github/pr" && method === "POST") {
    if (!env.GH_REPO) return jsonRespC({ error: "GH_REPO var is not configured" }, 503);
    const body = await request.json() as {
      title: string; body: string; head: string; base?: string; files: { path: string; content: string }[]
    };
    if (!body.title || !body.head || !Array.isArray(body.files) || body.files.length === 0) {
      return jsonRespC({ error: "title, head, and non-empty files[] required" }, 400);
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
    if (!baseSha) return jsonRespC({ error: `Base branch ${base} not found` }, 404);
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
    return jsonRespC({ ok: true, prNumber, url: prUrl });
  }

  // â”€â”€ /api/cf/agent/submit â€” agent evolution: submit a code change as a PR
  if (subpath === "/agent/submit" && method === "POST") {
    if (!env.GH_REPO) return jsonRespC({ error: "GH_REPO var is not configured" }, 503);
    const body = await request.json() as {
      reason: string;
      file: string;
      before: string;
      after: string;
      head?: string;
    };
    if (!body.file || typeof body.before !== "string" || typeof body.after !== "string") {
      return jsonRespC({ error: "file, before, after are required" }, 400);
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

  return jsonRespC({ error: `Unknown CF endpoint: ${method} ${subpath}` }, 404);
}


