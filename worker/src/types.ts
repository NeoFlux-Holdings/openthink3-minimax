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

export type GithubUserToken = {
  accessTokenCiphertext: string;
  scope: string;
  tokenType: string;
  // OAuth user tokens don't expire (until revoked), so we don't track expires_at
  // in a useful way — we just track when we got it.
  obtainedAt: number;
  user?: { id: number; login: string; avatar_url?: string } | null;
};

export type GithubDeviceFlowPending = {
  deviceCodeCiphertext: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  interval: number;
  scope: string;
  clientId: string;
  // Keyed by CF OAuth account_id so multiple users on the same browser can each have their own.
  accountId: string;
  createdAt: number;
};

