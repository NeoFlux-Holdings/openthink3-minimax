// worker/src/db.ts
// ────────────────────────────────────────────────────────────────────────────
// PGlite (Postgres-in-WASM) bootstrap for the OpenThink3 Worker.
//
// LIMITATION (v0): this is an in-memory PGlite instance. The database is
// created when the module is first evaluated inside a Worker isolate and is
// dropped when the isolate is recycled. State therefore does NOT persist
// across requests served by different isolates, and may be lost on any
// deploy. This is intentional for the v0 baseline — it lets us exercise
// the full gbrain-shaped relational schema (pages / edges / signals) and
// the recall endpoint before wiring a persistent backing store.
//
// Production plan: mount PGlite inside a Durable Object (with R2-backed
// block storage via `dataDir`) so state survives across isolates and
// deploys, or move to D1 if the access patterns are simple enough.
// ────────────────────────────────────────────────────────────────────────────

import { PGlite } from "@electric-sql/pglite";

let _ready: Promise<PGlite> | null = null;

export function getDb(): Promise<PGlite> {
  if (!_ready) {
    _ready = (async () => {
      // In-memory PGlite. With nodejs_compat on Cloudflare Workers this
      // provides a per-isolate Postgres 17 instance backed by WASM.
      const db = new PGlite();
      await db.waitReady;
      await migrate(db);
      return db;
    })();
  }
  return _ready;
}

async function migrate(db: PGlite): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS pages (
      id          TEXT PRIMARY KEY,
      thread_id   TEXT,
      slug        TEXT UNIQUE NOT NULL,
      type        TEXT NOT NULL,
      source      TEXT NOT NULL,
      title       TEXT,
      content     TEXT NOT NULL,
      metadata    TEXT,
      created_at  INTEGER NOT NULL DEFAULT (EXTRACT(EPOCH FROM now())::int),
      updated_at  INTEGER NOT NULL DEFAULT (EXTRACT(EPOCH FROM now())::int)
    );
    CREATE INDEX IF NOT EXISTS pages_thread ON pages(thread_id, created_at);
    CREATE INDEX IF NOT EXISTS pages_type   ON pages(type);

    CREATE TABLE IF NOT EXISTS edges (
      from_id     TEXT NOT NULL,
      to_id       TEXT NOT NULL,
      type        TEXT NOT NULL,
      weight      REAL DEFAULT 1.0,
      created_at  INTEGER NOT NULL DEFAULT (EXTRACT(EPOCH FROM now())::int),
      PRIMARY KEY (from_id, to_id, type)
    );
    CREATE INDEX IF NOT EXISTS edges_from ON edges(from_id);
    CREATE INDEX IF NOT EXISTS edges_to   ON edges(to_id);

    CREATE TABLE IF NOT EXISTS signals (
      id          TEXT PRIMARY KEY,
      page_id     TEXT,
      kind        TEXT NOT NULL,
      payload     TEXT NOT NULL,
      captured_at INTEGER NOT NULL DEFAULT (EXTRACT(EPOCH FROM now())::int)
    );
    CREATE INDEX IF NOT EXISTS signals_page ON signals(page_id);
  `);
}

// ── Types ──────────────────────────────────────────────────────────────────

export type PageRow = {
  id: string;
  thread_id: string | null;
  slug: string;
  type: string;
  source: string;
  title: string | null;
  content: string;
  metadata: string | null;
  created_at: number;
  updated_at: number;
};

export type RecallHit = {
  id: string;
  slug: string;
  type: string;
  title: string | null;
  snippet: string;
  score: number;
};

// ── Thread history (preserves the existing { role, content } shape) ────────

export async function insertMessage(opts: {
  threadId: string;
  role: string;
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<PageRow> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const slug = `${opts.threadId}:${id}`;
  // role -> source: user -> user, assistant -> agent, system -> system
  const source =
    opts.role === "user" ? "user" :
    opts.role === "assistant" ? "agent" :
    opts.role === "system" ? "system" : "chat";
  const meta = { ...(opts.metadata ?? {}), role: opts.role };
  const result = await db.query<PageRow>(
    `INSERT INTO pages (id, thread_id, slug, type, source, content, metadata)
     VALUES ($1, $2, $3, 'message', $4, $5, $6)
     RETURNING *`,
    [id, opts.threadId, slug, source, opts.content, JSON.stringify(meta)],
  );
  return result.rows[0];
}

export async function listThreadMessages(
  threadId: string,
): Promise<{ role: string; content: string }[]> {
  const db = await getDb();
  // Pull metadata + content; role is encoded inside metadata.role so the
  // existing frontend shape ({ role, content }[]) is preserved verbatim.
  const result = await db.query<{ metadata: string | null; content: string }>(
    `SELECT metadata, content
       FROM pages
      WHERE thread_id = $1 AND type = 'message'
      ORDER BY created_at ASC, id ASC`,
    [threadId],
  );
  return result.rows.map((r) => {
    let role = "assistant";
    if (r.metadata) {
      try {
        const meta = JSON.parse(r.metadata);
        if (typeof meta.role === "string") role = meta.role;
      } catch {
        // ignore parse errors; fall back to assistant
      }
    }
    return { role, content: r.content };
  });
}

// ── Recall (gbrain-flavored keyword search) ────────────────────────────────

const CONTRACTIONS: Record<string, string> = {
  "i'm": "i am", "you're": "you are", "we're": "we are", "they're": "they are",
  "it's": "it is", "isn't": "is not", "aren't": "are not", "wasn't": "was not",
  "weren't": "were not", "haven't": "have not", "hasn't": "has not",
  "hadn't": "had not", "won't": "will not", "wouldn't": "would not",
  "shouldn't": "should not", "couldn't": "could not", "don't": "do not",
  "doesn't": "does not", "didn't": "did not", "can't": "cannot",
  "i've": "i have", "you've": "you have", "we've": "we have",
  "they've": "they have", "i'll": "i will", "you'll": "you will",
  "we'll": "we will", "they'll": "they will", "i'd": "i would",
  "you'd": "you would", "we'd": "we would", "they'd": "they would",
};

const CONTRACTION_PATTERNS: { re: RegExp; v: string }[] = Object.entries(CONTRACTIONS).map(([k, v]) => ({
  re: new RegExp(`\\b${escapeRegex(k)}\\b`, "gi"),
  v,
}));

function expandContractions(s: string): string {
  let out = s;
  for (const { re, v } of CONTRACTION_PATTERNS) {
    out = out.replace(re, v);
  }
  return out;
}

function tokenize(s: string): string[] {
  return s.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
  "her", "was", "one", "our", "out", "day", "get", "has", "him", "his",
  "how", "its", "may", "new", "now", "old", "see", "two", "way", "who",
  "boy", "did", "let", "say", "she", "too", "use", "with", "from", "this",
  "that", "what", "when", "where", "which", "would", "there", "their",
  "about", "could", "these", "those", "into", "than", "them", "then",
]);

export function rewriteQuery(q: string): string[] {
  const expanded = expandContractions(q).toLowerCase();
  return Array.from(new Set(tokenize(expanded).filter((w) => !STOPWORDS.has(w))));
}

export async function recall(opts: {
  query: string;
  limit?: number;
  types?: string[];
}): Promise<RecallHit[]> {
  const words = rewriteQuery(opts.query);
  if (words.length === 0) return [];

  const db = await getDb();
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
  const types = opts.types && opts.types.length > 0 ? opts.types : null;

  // Baseline keyword search: pull pages that contain ANY of the query
  // words in title or content, optionally filtered by type, ranked by a
  // simple in-memory occurrence score. Future: swap in a Workers AI
  // embedding + Vectorize / pgvector cosine search.
  const pattern = `%${words[0]}%`;
  const typeFilter = types ? `AND type = ANY($${(types ? 3 : 0)}::text[])` : "";
  const params: unknown[] = [pattern, limit];
  if (types) params.push(types);

  const result = await db.query<{
    id: string;
    slug: string;
    type: string;
    title: string | null;
    content: string;
  }>(
    `SELECT id, slug, type, title, content
       FROM pages
      WHERE (content ILIKE $1 OR title ILIKE $1)
        ${typeFilter}
      ORDER BY created_at DESC
      LIMIT $2`,
    params,
  );

  const lcWords = words.map((w) => w.toLowerCase());
  const wordRegexes = lcWords.map((w) => new RegExp(escapeRegex(w), "g"));
  return result.rows
    .map((r): RecallHit => {
      const lc = r.content.toLowerCase();
      const titleLc = (r.title ?? "").toLowerCase();
      let score = 0;
      for (let i = 0; i < lcWords.length; i++) {
        const inContent = lc.match(wordRegexes[i]);
        if (inContent) score += inContent.length;
        if (titleLc.includes(lcWords[i])) score += 2; // title hits weighted higher
      }
      const snippet =
        r.content.length > 200 ? r.content.slice(0, 200) + "…" : r.content;
      return {
        id: r.id,
        slug: r.slug,
        type: r.type,
        title: r.title,
        snippet,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);
}
