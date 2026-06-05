import type { Env } from "./index.js";
import { handleEvals } from "./skills.js";
import type { BenchmarkRow } from "./types.js";

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function newBenchId(): string {
  return `bench_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export async function handleListBenchmarks(env: Env, url: URL): Promise<Response> {
  try {
    const suite = url.searchParams.get("suite");
    const limitRaw = url.searchParams.get("limit");
    const limit = Math.min(Math.max(parseInt(limitRaw ?? "50", 10) || 50, 1), 200);
    const stmt = env.OPENTHINK3_DB.prepare(
      `SELECT id, suite, score, total, passed, details, created_at
       FROM benchmarks
       ${suite ? "WHERE suite = ?1" : ""}
       ORDER BY created_at DESC
       LIMIT ?${suite ? "2" : "1"}`,
    );
    const result = suite
      ? await stmt.bind(suite, limit).all<BenchmarkRow>()
      : await stmt.bind(limit).all<BenchmarkRow>();
    return jsonResp({ rows: result.results ?? [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResp({ error: message }, 500);
  }
}

export async function handleLatestBenchmark(env: Env, url: URL): Promise<Response> {
  try {
    const suite = url.searchParams.get("suite");
    const row = await env.OPENTHINK3_DB.prepare(
      `SELECT id, suite, score, total, passed, details, created_at
       FROM benchmarks
       ${suite ? "WHERE suite = ?1" : ""}
       ORDER BY created_at DESC
       LIMIT 1`,
    )
      .bind(...(suite ? [suite] : []))
      .first<BenchmarkRow>();
    if (!row) return jsonResp({ latest: null });
    return jsonResp({ latest: row });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResp({ error: message }, 500);
  }
}

export async function handleRunBenchmarks(
  env: Env,
  ctx: ExecutionContext,
  body: { suite?: string },
): Promise<Response> {
  const suite = body.suite ?? "gbrain";
  const id = newBenchId();
  ctx.waitUntil(
    handleEvals(env, { suite })
      .then(
        (r) => console.log(`[benchmarks:run] suite=${suite} id=${r.id} score=${r.score} (${r.passed}/${r.total})`),
        (err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[benchmarks:run] suite=${suite} failed: ${message}`);
        },
      ),
  );
  return jsonResp({ id, status: "started", suite });
}

export function handleBenchmarksRoute(
  env: Env,
  request: Request,
  url: URL,
  ctx: ExecutionContext,
): Promise<Response> | null {
  if (url.pathname !== "/api/benchmarks" && url.pathname !== "/api/benchmarks/run") {
    return null;
  }
  if (request.method === "OPTIONS") {
    return Promise.resolve(new Response(null, { status: 204 }));
  }
  if (url.pathname === "/api/benchmarks/run" && request.method === "POST") {
    return request
      .json()
      .catch(() => ({}))
      .then((raw) => {
        const body = (raw ?? {}) as { suite?: string };
        return handleRunBenchmarks(env, ctx, body);
      });
  }
  if (url.pathname === "/api/benchmarks" && request.method === "GET") {
    if (url.searchParams.get("latest") === "1") {
      return Promise.resolve(handleLatestBenchmark(env, url));
    }
    return Promise.resolve(handleListBenchmarks(env, url));
  }
  return Promise.resolve(jsonResp({ error: `Method ${request.method} not allowed` }, 405));
}
