import { getValidAccessToken, getSession } from './cfOAuth';

export type CfCreds = { token: string; accountId: string; accountName?: string; email?: string };
const STORAGE_KEY = 'openthink_cf_creds_v1';

export function getCfCreds(): CfCreds | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function setCfCreds(creds: CfCreds): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
}

export function clearCfCreds(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function cfAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const oauth = getSession();
  if (oauth?.accessToken) {
    const headers: Record<string, string> = { Authorization: `Bearer ${oauth.accessToken}` };
    if (oauth.accountId) headers['X-CF-Account-Id'] = oauth.accountId;
    return headers;
  }
  const c = getCfCreds();
  if (!c) return {};
  return {
    'X-CF-Token': c.token,
    'X-CF-Account-Id': c.accountId,
  };
}

export function isCfSignedIn(): boolean {
  return !!(getSession() || getCfCreds());
}

export function activeCfEmail(): string | undefined {
  return getSession()?.email ?? getCfCreds()?.email;
}

export function activeCfAccountId(): string | undefined {
  return getSession()?.accountId ?? getCfCreds()?.accountId;
}

export async function resolveAccount(token: string): Promise<CfCreds> {
  const API_BASE = localStorage.getItem('openthink_api_url') || window.location.origin;
  const r = await fetch(`${API_BASE}/api/cf/resolve-account`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const data = await r.json();
  if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return { token, accountId: data.accountId, accountName: data.accountName, email: data.email };
}

// Re-export for callers that want async token refresh.
export { getValidAccessToken as getCfBearerToken };
