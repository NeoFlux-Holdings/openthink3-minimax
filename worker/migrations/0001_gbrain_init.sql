-- gbrain v0 schema (D1 / SQLite)
-- Tables: threads, pages, edges, benchmarks.
-- FTS5 virtual table: pages_fts (kept in sync via triggers).

CREATE TABLE IF NOT EXISTS threads (
  id          TEXT PRIMARY KEY,
  title       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  metadata    TEXT
);

CREATE TABLE IF NOT EXISTS pages (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL,
  type        TEXT NOT NULL,
  title       TEXT,
  content     TEXT NOT NULL,
  metadata    TEXT,
  signal      REAL NOT NULL DEFAULT 0.5,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  vector_id   TEXT
);
CREATE INDEX IF NOT EXISTS idx_pages_thread  ON pages(thread_id);
CREATE INDEX IF NOT EXISTS idx_pages_signal  ON pages(signal DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pages_type    ON pages(type);
CREATE INDEX IF NOT EXISTS idx_pages_created ON pages(created_at DESC);

CREATE TABLE IF NOT EXISTS edges (
  id          TEXT PRIMARY KEY,
  from_id     TEXT NOT NULL,
  to_id       TEXT NOT NULL,
  kind        TEXT NOT NULL,
  weight      REAL NOT NULL DEFAULT 1.0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id);
CREATE INDEX IF NOT EXISTS idx_edges_to   ON edges(to_id);
CREATE INDEX IF NOT EXISTS idx_edges_kind  ON edges(kind);

CREATE TABLE IF NOT EXISTS benchmarks (
  id          TEXT PRIMARY KEY,
  suite       TEXT NOT NULL,
  score       REAL NOT NULL,
  total       INTEGER NOT NULL,
  passed      INTEGER NOT NULL,
  details     TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bench_suite ON benchmarks(suite, created_at DESC);

-- FTS5 keyword search over title + content.
-- Uses external-content so we don't duplicate data; we drive the index
-- from the application layer in the `capture` route (insert/delete).
CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
  title,
  content,
  content='pages',
  content_rowid='rowid',
  tokenize='porter unicode61'
);
