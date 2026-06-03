// worker/src/skills.ts
// ────────────────────────────────────────────────────────────────────────────
// gbrain + gstack skill handlers. Five routes:
//   POST /api/skill/capture  → store a page (D1 + Vectorize + FTS5)
//   POST /api/skill/search   → semantic + keyword recall
//   POST /api/skill/think    → Workers AI Llama 3.3 with recalled context
//   POST /api/skill/run      → MCP tool call proxy to OrchestratorDO
//   POST /api/skill/evals    → run eval suite, write scorecard to D1
//
// All routes are CF-native: D1 for relational, Vectorize for embeddings,
// Workers AI for inference, FTS5 for keyword search. No external services.
// ────────────────────────────────────────────────────────────────────────────

import type { Env } from "./index.js";

// ── BGE-small embedding helper ──────────────────────────────────────────
const EMBED_MODEL = "@cf/baai/bge-small-en-v1.5";
const CHAT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const FAST_CHAT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";

export async function embed(env: Env, text: string): Promise<number[]> {
  const out = (await env.AI.run(EMBED_MODEL, { text: [text] })) as {
    data: number[][];
  };
  return out.data[0];
}

export async function embedBatch(env: Env, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out = (await env.AI.run(EMBED_MODEL, { text: texts })) as {
    data: number[][];
  };
  return out.data;
}

// ── id helper ───────────────────────────────────────────────────────────
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

// ── /api/skill/capture ──────────────────────────────────────────────────
// POST { threadId, type, title?, content, metadata?, signal? }
//   -> { id, vectorId }
export async function handleCapture(
  env: Env,
  body: {
    threadId: string;
    type: string;
    title?: string;
    content: string;
    metadata?: Record<string, unknown>;
    signal?: number;
  },
): Promise<{ id: string; vectorId: string }> {
  const id = newId("page");
  const ts = now();
  const signal = typeof body.signal === "number" ? body.signal : 0.5;
  const metadata = body.metadata ? JSON.stringify(body.metadata) : null;
  const title = body.title ?? null;

  // 1. Insert into D1 pages table.
  await env.OPENTHINK3_DB.prepare(
    `INSERT INTO pages (id, thread_id, type, title, content, metadata, signal, created_at, updated_at, vector_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL)`,
  )
    .bind(id, body.threadId, body.type, title, body.content, metadata, signal, ts, ts)
    .run();

  // 2. Embed and store in Vectorize.
  const vector = await embed(env, `${title ?? ""}\n${body.content}`.trim());
  const vectorId = id; // reuse id for simplicity
  await env.GBRAIN_PAGES.upsert([
    {
      id: vectorId,
      values: vector,
      metadata: {
        thread_id: body.threadId,
        type: body.type,
        page_id: id,
      },
    },
  ]);

  // 3. Update pages.vector_id for hydration.
  await env.OPENTHINK3_DB.prepare(`UPDATE pages SET vector_id = ?1 WHERE id = ?2`)
    .bind(vectorId, id)
    .run();

  // 4. Mirror into FTS5 virtual table.
  await env.OPENTHINK3_DB.prepare(
    `INSERT INTO pages_fts (rowid, title, content)
     SELECT rowid, COALESCE(title, ''), content FROM pages WHERE id = ?1`,
  )
    .bind(id)
    .run();

  // 5. Ensure thread exists in threads table.
  await env.OPENTHINK3_DB.prepare(
    `INSERT INTO threads (id, title, created_at, updated_at) VALUES (?1, NULL, ?2, ?2)
     ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
  )
    .bind(body.threadId, ts)
    .run();

  return { id, vectorId };
}

// ── /api/skill/search ───────────────────────────────────────────────────
// POST { query, threadId?, limit?, types? }
//   -> { results: [{ id, threadId, type, title, content, signal, score, source }], query, count }
export async function handleSearch(
  env: Env,
  body: {
    query: string;
    threadId?: string;
    limit?: number;
    types?: string[];
  },
): Promise<{
  results: Array<{
    id: string;
    threadId: string;
    type: string;
    title: string | null;
    content: string;
    signal: number;
    score: number;
    source: "semantic" | "keyword" | "both";
  }>;
  query: string;
  count: number;
}> {
  const limit = Math.min(Math.max(body.limit ?? 10, 1), 50);

  // 1. Semantic search via Vectorize.
  const queryVec = await embed(env, body.query);
  const vectorFilter: Record<string, string> = {};
  if (body.threadId) vectorFilter.thread_id = body.threadId;
  if (body.types && body.types.length === 1) vectorFilter.type = body.types[0];

  const vectorRes = await env.GBRAIN_PAGES.query(queryVec, {
    topK: limit * 2,
    returnMetadata: true,
    filter: Object.keys(vectorFilter).length > 0 ? vectorFilter : undefined,
  });

  const semanticHits = new Map<string, { score: number; meta: Record<string, string> }>();
  for (const m of vectorRes.matches) {
    semanticHits.set(m.id, {
      score: m.score,
      meta: (m.metadata ?? {}) as Record<string, string>,
    });
  }

  // 2. Keyword search via FTS5.
  // FTS5 needs the query to be sanitized: double-quote each word and OR them.
  const ftsQuery = body.query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .map((w) => `"${w}"`)
    .join(" OR ");

  const keywordHits = new Map<string, number>();
  if (ftsQuery) {
    const ftsSql = `SELECT p.id, p.thread_id, p.type, p.title, p.content, p.signal, rank
      FROM pages_fts f
      JOIN pages p ON p.rowid = f.rowid
      WHERE pages_fts MATCH ?1
      ${body.threadId ? "AND p.thread_id = ?2" : ""}
      ${body.types && body.types.length > 0 ? `AND p.type IN (${body.types.map(() => "?").join(",")})` : ""}
      ORDER BY rank LIMIT ?${body.threadId ? 3 : 2}`;
    const ftsStmt = env.OPENTHINK3_DB.prepare(ftsSql);
    if (body.threadId && body.types && body.types.length > 0) {
      const r = await ftsStmt.bind(ftsQuery, body.threadId, ...body.types, limit * 2).all();
      for (const row of r.results ?? []) keywordHits.set(row.id as string, row.rank as number);
    } else if (body.threadId) {
      const r = await ftsStmt.bind(ftsQuery, body.threadId, limit * 2).all();
      for (const row of r.results ?? []) keywordHits.set(row.id as string, row.rank as number);
    } else if (body.types && body.types.length > 0) {
      const r = await ftsStmt.bind(ftsQuery, ...body.types, limit * 2).all();
      for (const row of r.results ?? []) keywordHits.set(row.id as string, row.rank as number);
    } else {
      const r = await ftsStmt.bind(ftsQuery, limit * 2).all();
      for (const row of r.results ?? []) keywordHits.set(row.id as string, row.rank as number);
    }
  }

  // 3. Merge: hydrate from D1, deduplicate by id.
  const allIds = new Set<string>([...semanticHits.keys(), ...keywordHits.keys()]);
  if (allIds.size === 0) {
    return { results: [], query: body.query, count: 0 };
  }
  const placeholders = Array.from(allIds).map(() => "?").join(",");
  const hydrated = await env.OPENTHINK3_DB.prepare(
    `SELECT id, thread_id, type, title, content, signal FROM pages WHERE id IN (${placeholders})`,
  )
    .bind(...allIds)
    .all();

  const results = (hydrated.results ?? []).map((row) => {
    const id = row.id as string;
    const semScore = semanticHits.get(id)?.score ?? 0;
    const kwScore = keywordHits.has(id) ? 1 : 0; // binary; FTS5 rank is negative-better so we just count presence
    // Combined score: weighted blend, boosted if both sources agree.
    const combined = 0.7 * semScore + 0.3 * kwScore;
    const source: "semantic" | "keyword" | "both" =
      semScore > 0 && kwScore > 0 ? "both" : semScore > 0 ? "semantic" : "keyword";
    return {
      id,
      threadId: row.thread_id as string,
      type: row.type as string,
      title: (row.title as string) ?? null,
      content: row.content as string,
      signal: row.signal as number,
      score: Math.round(combined * 1000) / 1000,
      source,
    };
  });
  results.sort((a, b) => b.score - a.score);

  return { results: results.slice(0, limit), query: body.query, count: results.length };
}

// ── /api/skill/think ────────────────────────────────────────────────────
// POST { query, threadId?, history?, system? }  (SSE stream)
//   -> streams "data: {chunk}\n\n" until "data: [DONE]\n\n"
export async function handleThink(
  env: Env,
  body: {
    query: string;
    threadId?: string;
    history?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    system?: string;
  },
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
): Promise<void> {
  // 1. Recall relevant context.
  const recall = await handleSearch(env, {
    query: body.query,
    threadId: body.threadId,
    limit: 8,
  });

  // 2. Build messages array.
  const systemPrompt =
    body.system ??
    `You are gbrain, the memory-and-reasoning layer of OpenThink3. Use the recalled context below to answer the user's question. If the context is empty, say so honestly and answer from general knowledge. Cite recalled pages as [page_id].`;
  const contextBlock =
    recall.results.length === 0
      ? "(no recalled context)"
      : recall.results
          .map(
            (r, i) =>
              `[${i + 1}] (${r.source}, score=${r.score}, signal=${r.signal}, type=${r.type}) ${r.title ? `# ${r.title}\n` : ""}${r.content}`,
          )
          .join("\n\n---\n\n");

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: `${systemPrompt}\n\nRecalled context:\n${contextBlock}` },
    ...(body.history ?? []).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: body.query },
  ];

  // 3. Try streaming first; if the model returns an empty stream
  //    (some Workers AI builds emit a non-streamable response when
  //    `stream: true` is set with tools), fall back to non-streaming
  //    and emit a single chunk.
  try {
    const stream = (await env.AI.run(CHAT_MODEL, {
      messages,
      stream: true,
      max_tokens: 1024,
    })) as ReadableStream<Uint8Array> | { response: string };

    if (stream instanceof ReadableStream) {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let gotAny = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Workers AI emits either raw JSON per line OR SSE-formatted
        // "data: {...}\n\n". Handle both.
        const normalized = buffer
          .split("\n")
          .map((l) => l.trim().replace(/^data:\s*/, ""))
          .filter((l) => l && l !== "[DONE]");
        buffer = "";
        for (const line of normalized) {
          try {
            const j = JSON.parse(line);
            const piece = j.response ?? j.token;
            if (piece) {
              gotAny = true;
              await writer.write(
                encoder.encode(`data: ${JSON.stringify({ chunk: piece })}\n\n`),
              );
            }
          } catch {
            // not JSON; might be raw text
            if (line.length > 0) {
              gotAny = true;
              await writer.write(
                encoder.encode(`data: ${JSON.stringify({ chunk: line })}\n\n`),
              );
            }
          }
        }
      }
      if (!gotAny) throw new Error("empty stream");
    } else if (stream && typeof stream === "object" && "response" in stream) {
      const piece = stream.response;
      if (piece) {
        await writer.write(
          encoder.encode(`data: ${JSON.stringify({ chunk: piece })}\n\n`),
        );
      }
    }
  } catch {
    // Non-streaming fallback.
    const res = (await env.AI.run(CHAT_MODEL, {
      messages,
      max_tokens: 1024,
    })) as { response: string };
    const piece = res.response ?? "";
    if (piece) {
      await writer.write(encoder.encode(`data: ${JSON.stringify({ chunk: piece })}\n\n`));
    }
  }

  await writer.write(encoder.encode(`data: [DONE]\n\n`));
  await writer.close().catch(() => {});
}

// ── /api/skill/run ──────────────────────────────────────────────────────
// POST { command, context? } → proxy to OrchestratorDO (MCP tool call)
export async function handleRun(
  env: Env,
  body: { command: string; context?: Record<string, unknown> },
): Promise<{ result: unknown; tool: string }> {
  // Route to OrchestratorDO. The MCP server there exposes tool endpoints
  // like /tool/<name>. For the v0 we just call it as a generic dispatch.
  const id = env.ORCHESTRATOR_DO.idFromName("default");
  const stub = env.ORCHESTRATOR_DO.get(id);
  const res = await stub.fetch(
    new Request("https://orchestrator/tool/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  const result = await res.json().catch(() => ({}));
  return { result, tool: "dispatch" };
}

// ── /api/skill/evals ────────────────────────────────────────────────────
// POST { suite? } → run a small eval suite, write scorecard to D1.
export async function handleEvals(
  env: Env,
  body: { suite?: string },
): Promise<{ id: string; suite: string; score: number; passed: number; total: number; details: unknown }> {
  const suite = body.suite ?? "smoke";
  const ts = now();
  const id = newId("bench");

  // Tiny in-line eval suite. The questions are deterministic so we can
  // run this on a cron and track score over time.
  const cases: Array<{ id: string; prompt: string; mustContain: string[] }> = [
    {
      id: "hello",
      prompt: "Say 'hello from gbrain' exactly.",
      mustContain: ["hello", "gbrain"],
    },
    {
      id: "json",
      prompt: 'Reply with a JSON object: {"ok": true}',
      mustContain: ["ok", "true"],
    },
    {
      id: "concise",
      prompt: "Explain Postgres in one sentence.",
      mustContain: ["database", "sql"],
    },
  ];

  let passed = 0;
  const details: Array<{ id: string; passed: boolean; response: string }> = [];
  for (const c of cases) {
    const res = (await env.AI.run(FAST_CHAT_MODEL, {
      messages: [{ role: "user", content: c.prompt }],
      max_tokens: 256,
    })) as { response: string };
    const text = (res.response ?? "").toLowerCase();
    const ok = c.mustContain.every((needle) => text.includes(needle.toLowerCase()));
    if (ok) passed++;
    details.push({ id: c.id, passed: ok, response: res.response });
  }
  const total = cases.length;
  const score = total === 0 ? 0 : passed / total;

  await env.OPENTHINK3_DB.prepare(
    `INSERT INTO benchmarks (id, suite, score, total, passed, details, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(id, suite, score, total, passed, JSON.stringify(details), ts)
    .run();

  return { id, suite, score, passed, total, details };
}

// ── /api/skill/dream (cron) ─────────────────────────────────────────────
// Nightly memory consolidation: boost signal of recently-accessed pages,
// decay signal of old untouched pages, prune low-signal old pages.
export async function handleDream(env: Env): Promise<{ decayed: number; boosted: number; pruned: number }> {
  const ts = now();
  const thirtyDaysAgo = ts - 60 * 60 * 24 * 30;

  // Decay: any page older than 30 days with signal < 0.3 and not updated recently → reduce by 10%.
  const decayed = await env.OPENTHINK3_DB.prepare(
    `UPDATE pages
     SET signal = MAX(0.0, signal * 0.9)
     WHERE created_at < ?1 AND signal < 0.3`,
  )
    .bind(thirtyDaysAgo)
    .run();

  // Boost: pages accessed in the last 24h → signal *1.05 capped at 1.0.
  const oneDayAgo = ts - 60 * 60 * 24;
  const boosted = await env.OPENTHINK3_DB.prepare(
    `UPDATE pages
     SET signal = MIN(1.0, signal * 1.05)
     WHERE updated_at > ?1`,
  )
    .bind(oneDayAgo)
    .run();

  // Prune: pages older than 90 days with signal == 0 → delete (and from FTS5).
  const ninetyDaysAgo = ts - 60 * 60 * 24 * 90;
  const toPrune = await env.OPENTHINK3_DB.prepare(
    `SELECT id, rowid FROM pages WHERE created_at < ?1 AND signal = 0`,
  )
    .bind(ninetyDaysAgo)
    .all();
  const prunedIds = (toPrune.results ?? []).map((r) => r.id as string);
  const prunedRowids = (toPrune.results ?? []).map((r) => r.rowid as number);
  let pruned = 0;
  if (prunedIds.length > 0) {
    const placeholders = prunedIds.map(() => "?").join(",");
    await env.OPENTHINK3_DB.prepare(`DELETE FROM pages WHERE id IN (${placeholders})`)
      .bind(...prunedIds)
      .run();
    for (const rid of prunedRowids) {
      await env.OPENTHINK3_DB.prepare(`DELETE FROM pages_fts WHERE rowid = ?1`).bind(rid).run();
    }
    // Best-effort vector delete; Vectorize doesn't enforce referential integrity.
    await env.GBRAIN_PAGES.deleteByIds(prunedIds).catch(() => {});
    pruned = prunedIds.length;
  }

  return {
    decayed: (decayed.meta as { changes?: number })?.changes ?? 0,
    boosted: (boosted.meta as { changes?: number })?.changes ?? 0,
    pruned,
  };
}
