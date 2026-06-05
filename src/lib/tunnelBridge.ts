export type BridgeStatus = {
  registered: boolean;
  tunnelUrl: string | null;
  ttlSeconds: number;
  lastPinged: number | null;
};

export type ToolDescriptor = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type ToolCatalog = {
  ok: boolean;
  tools: ToolDescriptor[];
  source: string;
  error?: string;
};

export type PingResult = {
  ok: boolean;
  latencyMs: number;
  status?: number;
  error?: string;
};

function apiBase(): string {
  if (typeof window === 'undefined') return '';
  return (localStorage.getItem('openthink_api_url') || window.location.origin).replace(/\/$/, '');
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${apiBase()}/api/bridge${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  const r = await fetch(url, {
    ...init,
    headers,
    credentials: 'include',
  });
  const text = await r.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Non-JSON response (${r.status})`);
    }
  }
  if (!r.ok) {
    const err = (data as { error?: string } | null)?.error || `HTTP ${r.status}`;
    throw new Error(err);
  }
  return data as T;
}

export async function registerTunnel(tunnelUrl: string): Promise<{ ok: boolean; ttlSeconds: number; tunnelUrl: string }> {
  return request('/register', {
    method: 'POST',
    body: JSON.stringify({ tunnelUrl }),
  });
}

export async function unregister(): Promise<void> {
  await request<{ ok: boolean }>('/delete', { method: 'DELETE' });
}

export async function getBridgeStatus(): Promise<BridgeStatus> {
  return request<BridgeStatus>('/status', { method: 'GET' });
}

export async function pingBridge(): Promise<PingResult> {
  return request<PingResult>('/ping', { method: 'POST', body: '{}' });
}

export async function proxyToBridge<T = unknown>(method: string, params?: unknown, id: number | string = 1): Promise<T> {
  return request<T>('/proxy', {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }),
  });
}

export async function discoverBridgeTools(): Promise<ToolCatalog> {
  return request<ToolCatalog>('/tools', { method: 'GET' });
}
