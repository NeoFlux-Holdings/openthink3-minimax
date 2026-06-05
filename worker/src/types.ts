// worker/src/types.ts
// Shared types used by route handlers in this worker.

export interface BenchmarkRow {
  id: string;
  suite: string;
  score: number;
  total: number;
  passed: number;
  details: string | null;
  created_at: number;
}
