import { useEffect, useReducer, useCallback, useState } from 'react';
import { Cloud, RefreshCw } from 'lucide-react';
import {
  CfConnectionBanner, CfDiagnostics, CfLocalRemote,
  CfActionButtons, CfHistoryList, CfActivityLog,
} from './CloudflareSyncPanelParts';
import { getCfCreds, setCfCreds, clearCfCreds, cfAuthHeaders, resolveAccount, type CfCreds } from '../lib/cfCreds';
import { getSession, revokeAndSignOut, CF_OAUTH_CONFIG } from '../lib/cfOAuth';

/* ------------------------------------------------------------------ */
/* CloudflareSyncPanel                                                 */
/* ------------------------------------------------------------------ */
/*
 * Bidirectional sync between the local OpenThink build and the
 * Cloudflare account that owns the deployed agent. Backed by the
 * `/api/cf/*` endpoints on the worker (which proxy to the real
 * Cloudflare REST API + GitHub API using per-user X-CF-Token /
 * X-CF-Account-Id headers, with env-secret fallback).
 *
 *   Pull  → fetch the latest manifest from the worker KV
 *   Push  → bundle worker locally, upload to `worker:staged`, deploy via CF API
 *   PR    → open a GitHub PR against the configured repo (the agent's evolution hook)
 *
 * Local state for the bundle meta is kept in localStorage so we can show
 * a clear "local vs remote" diff after a refresh.
 */

function getApiBase(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('openthink_api_url') || `${window.location.origin}`;
}

interface Manifest {
  version: number;
  deployedAt: string | null;
  sha256: string | null;
  bytes?: number;
  scriptName?: string;
  source?: string;
  message?: string | null;
  deploymentId?: string | null;
}

interface Status {
  ok: boolean;
  configured: {
    CF_API_TOKEN: boolean;
    CF_ACCOUNT_ID: boolean;
    GH_TOKEN: boolean;
    GH_REPO: string | null;
    ARTIFACTS_KV: boolean;
  };
  manifest: Manifest;
}

interface HistoryEntry {
  id: string;
  ts: number;
  actor: string;
  type: 'deploy' | 'pr' | 'stage' | 'pages';
  ok: boolean;
  summary: string;
  details?: any;
}

interface BundleMeta {
  path: string;
  bytes: number;
  sha256: string;
  builtAt: string;
  workerDir: string;
}

interface CloudflareSyncPanelProps {
  apiBase?: string;
}

const LSK = {
  localBundleSha: 'openthink_local_bundle_sha',
  localBundleBytes: 'openthink_local_bundle_bytes',
  localBundleBuiltAt: 'openthink_local_bundle_built_at',
  lastPullTs: 'openthink_last_pull_ts',
  lastPushTs: 'openthink_last_push_ts',
  apiOverride: 'openthink_api_url',
};

async function api(path: string, init: RequestInit = {}, base: string = getApiBase()): Promise<any> {
  const isCf = path.startsWith('/api/cf/');
  const cfHeaders = isCf ? cfAuthHeaders() : {};
  const r = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...cfHeaders, ...(init.headers || {}) },
  });
  const text = await r.text();
  let data: any;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!r.ok) {
    const msg = data?.error || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return data;
}

async function apiFetchRaw(path: string, init: RequestInit = {}, base: string = getApiBase()): Promise<Response> {
  const isCf = path.startsWith('/api/cf/');
  const cfHeaders = isCf ? cfAuthHeaders() : {};
  return fetch(`${base}${path}`, {
    ...init,
    headers: { ...cfHeaders, ...(init.headers || {}) },
  });
}

function relTime(ts: number | null | undefined): string {
  if (!ts) return 'never';
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function fmtBytes(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function shortSha(s: string | null | undefined): string {
  if (!s) return '—';
  return s.length > 12 ? `${s.slice(0, 10)}…` : s;
}

type State = {
  status: Status | null;
  manifest: Manifest | null;
  staged: boolean;
  history: HistoryEntry[];
  localMeta: BundleMeta | null;
  busy: string | null;
  log: string[];
  error: string | null;
};

type Action =
  | { type: 'SET_STATUS'; value: Status | null }
  | { type: 'SET_MANIFEST'; value: Manifest | null }
  | { type: 'SET_STAGED'; value: boolean }
  | { type: 'SET_HISTORY'; value: HistoryEntry[] }
  | { type: 'SET_LOCAL_META'; value: BundleMeta | null }
  | { type: 'SET_BUSY'; value: string | null }
  | { type: 'SET_LOG'; value: string[] | ((prev: string[]) => string[]) }
  | { type: 'SET_ERROR'; value: string | null };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_STATUS':
      return { ...state, status: action.value };
    case 'SET_MANIFEST':
      return { ...state, manifest: action.value };
    case 'SET_STAGED':
      return { ...state, staged: action.value };
    case 'SET_HISTORY':
      return { ...state, history: action.value };
    case 'SET_LOCAL_META':
      return { ...state, localMeta: action.value };
    case 'SET_BUSY':
      return { ...state, busy: action.value };
    case 'SET_LOG':
      return {
        ...state,
        log: typeof action.value === 'function'
          ? action.value(state.log)
          : action.value,
      };
    case 'SET_ERROR':
      return { ...state, error: action.value };
  }
}

export default function CloudflareSyncPanel({ apiBase }: CloudflareSyncPanelProps) {
  const base = apiBase || getApiBase();
  const [creds, setCredsState] = useState<CfCreds | null>(() => getCfCreds());
  const [oauthSession, setOauthSession] = useState(() => getSession());
  const [connectToken, setConnectToken] = useState('');
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const handleConnect = async () => {
    if (!connectToken.trim()) return;
    setConnectBusy(true);
    setConnectError(null);
    try {
      const resolved = await resolveAccount(connectToken.trim());
      setCfCreds(resolved);
      setCredsState(resolved);
      setConnectToken('');
    } catch (e: any) {
      setConnectError(e.message || String(e));
    } finally {
      setConnectBusy(false);
    }
  };

  const handleDisconnect = () => {
    clearCfCreds();
    setCredsState(null);
  };

  const handleOAuthSignIn = async () => {
    setConnectError(null);
    try {
      const { beginAuthorize } = await import('../lib/cfOAuth');
      await beginAuthorize(window.location.pathname);
    } catch (e: any) {
      setConnectError(e.message || String(e));
    }
  };

  const handleOAuthDisconnect = async () => {
    setConnectBusy(true);
    try {
      await revokeAndSignOut();
      setOauthSession(null);
    } finally {
      setConnectBusy(false);
    }
  };

  const effectiveCreds: CfCreds | null = oauthSession
    ? { token: 'oauth', accountId: oauthSession.accountId ?? '', accountName: oauthSession.accountName, email: oauthSession.email }
    : creds;
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    status: null,
    manifest: null,
    staged: false,
    history: [] as HistoryEntry[],
    localMeta: null,
    busy: null,
    log: (() => {
      const stored = localStorage.getItem(LSK.lastPullTs);
      return stored ? [`Last pull: ${relTime(parseInt(stored, 10))}`] : [];
    })(),
    error: null,
  }));
  const { status, manifest, staged, history, localMeta, busy, log, error } = state;
  const setStatus     = (value: Status | null) => dispatch({ type: 'SET_STATUS', value });
  const setManifest   = (value: Manifest | null) => dispatch({ type: 'SET_MANIFEST', value });
  const setStaged     = (value: boolean) => dispatch({ type: 'SET_STAGED', value });
  const setHistory    = (value: HistoryEntry[]) => dispatch({ type: 'SET_HISTORY', value });
  const setLocalMeta  = (value: BundleMeta | null) => dispatch({ type: 'SET_LOCAL_META', value });
  const setBusy       = (value: string | null) => dispatch({ type: 'SET_BUSY', value });
  const setLog        = (value: string[] | ((prev: string[]) => string[])) => dispatch({ type: 'SET_LOG', value });
  const setError      = (value: string | null) => dispatch({ type: 'SET_ERROR', value });

  const append = (s: string) => setLog(l => [...l, s]);

  const refreshAll = useCallback(async () => {
    setError(null);
    try {
      const [s, m, h, b] = await Promise.all([
        api('/api/cf/status', {}, base),
        api('/api/cf/manifest', {}, base),
        api('/api/cf/history', {}, base),
        fetch('/worker-bundle.meta.json').then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      setStatus(s);
      setManifest(m.manifest);
      setStaged(!!m.staged);
      setHistory(h.history || []);
      setLocalMeta(b);
    } catch (e: any) {
      setError(e.message || String(e));
    }
  }, [base]);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  /* ── Pull: download the remote worker bundle + refresh manifest ── */
  const handlePull = async () => {
    setBusy('pull');
    setError(null);
    try {
      const r = await apiFetchRaw('/api/cf/bundle/worker');
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
      }
      const code = await r.text();
      const m = await api('/api/cf/manifest', {}, base);
      // Cache the pulled bundle meta in localStorage so a refresh shows the same SHA locally
      const meta = m.manifest;
      if (meta.sha256) localStorage.setItem(LSK.localBundleSha, meta.sha256);
      if (meta.bytes) localStorage.setItem(LSK.localBundleBytes, String(meta.bytes));
      localStorage.setItem(LSK.localBundleBuiltAt, meta.deployedAt || new Date().toISOString());
      localStorage.setItem(LSK.lastPullTs, String(Date.now()));
      append(`Pulled remote bundle (${fmtBytes(code.length)}, sha ${shortSha(meta.sha256)})`);
      await refreshAll();
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  /* ── Push: fetch local bundle, stage, then deploy ── */
  const handlePush = async () => {
    setBusy('push');
    setError(null);
    try {
      append('Reading local worker-bundle.js…');
      const r = await fetch('/worker-bundle.js');
      if (!r.ok) throw new Error('Local bundle not found. Run `npm run bundle:worker` to build it.');
      const code = await r.text();
      const meta = await fetch('/worker-bundle.meta.json').then(x => x.ok ? x.json() : null).catch(() => null);

      append(`Staging ${fmtBytes(code.length)} on worker KV…`);
      const stageRes = await api('/api/cf/bundle/worker', {
        method: 'POST',
        body: JSON.stringify({ code, meta: meta || { source: 'cloud-sync-panel' } }),
      }, base);
      append(`Staged ✓ (${fmtBytes(stageRes.staged.bytes)}, sha ${shortSha(stageRes.staged.sha256)})`);

      if (!status?.configured.CF_API_TOKEN) {
        append('CF_API_TOKEN not configured. Skipping live deploy — bundle is staged only.');
        await refreshAll();
        return;
      }
      append('Deploying to Cloudflare via REST API…');
      const deployRes = await api('/api/cf/deploy/worker', {
        method: 'POST',
        body: JSON.stringify({ message: `Cloud-sync push at ${new Date().toISOString()}` }),
      }, base);
      append(`Deployed ✓ (deploymentId: ${shortSha(deployRes.manifest.deploymentId)})`);
      localStorage.setItem(LSK.lastPushTs, String(Date.now()));
      await refreshAll();
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  /* ── Agent PR: open a GitHub PR for self-evolution ── */
  const handleAgentPR = async () => {
    setBusy('pr');
    setError(null);
    try {
      if (!status?.configured.GH_TOKEN) throw new Error('GH_TOKEN not configured on worker');
      if (!status?.configured.GH_REPO) throw new Error('GH_REPO not configured on worker');
      const reason = window.prompt('Describe the change you want the agent to propose (e.g. "switch default model to llama-3.3-70b"):');
      if (!reason) return;
      const file = window.prompt('Target file path (e.g. worker/src/index.ts):', 'worker/src/index.ts');
      if (!file) return;
      append(`Submitting agent evolution PR for ${file}…`);
      const r = await api('/api/cf/agent/submit', {
        method: 'POST',
        body: JSON.stringify({
          reason,
          file,
          before: '/* see remote */',
          after: '/* proposed change — see PR body */',
        }),
      }, base);
      append(`PR opened ✓ (#${r.prNumber}: ${r.url})`);
      await refreshAll();
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  const localSha = localStorage.getItem(LSK.localBundleSha) || localMeta?.sha256 || null;
  const remoteSha = manifest?.sha256 || null;
  const inSync = !!localSha && localSha === remoteSha;

  return (
    <div className="cf-sync-panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Cloud size={20} color="var(--accent-primary)" />
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Cloudflare Artifact Sync</h3>
        </div>
        <button type="button"
          className="btn btn-ghost"
          onClick={refreshAll}
          disabled={!!busy}
          aria-label="Refresh"
          style={{ padding: '6px', minWidth: 36, minHeight: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <RefreshCw size={14} className={busy ? 'spin' : ''} />
        </button>
      </div>

      <CfConnectionBanner
        creds={effectiveCreds}
        isOAuth={!!oauthSession}
        oauthConfigured={CF_OAUTH_CONFIG.isConfigured()}
        connectToken={connectToken}
        connectBusy={connectBusy}
        connectError={connectError}
        onTokenChange={setConnectToken}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        onOAuthSignIn={handleOAuthSignIn}
        onOAuthDisconnect={handleOAuthDisconnect}
      />

      <CfDiagnostics status={status} />

      <CfLocalRemote
        localSha={localSha}
        localMeta={localMeta}
        remoteSha={remoteSha}
        manifest={manifest}
        inSync={inSync}
        staged={staged}
        shortSha={shortSha}
        fmtBytes={fmtBytes}
        relTime={relTime}
      />

      <CfActionButtons
        busy={busy}
        ghTokenConfigured={!!status?.configured.GH_TOKEN}
        onPull={handlePull}
        onPush={handlePush}
        onAgentPR={handleAgentPR}
      />

      <CfHistoryList history={history} relTime={relTime} />

      <CfActivityLog log={log} error={error} />

      <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
        Pull fetches the remote worker bundle, sync-meta. Push bundles <code>worker/</code> via <code>wrangler --outfile</code>,
        stages it in <code>ARTIFACTS</code> KV, and deploys via the Cloudflare REST API. Agent PR opens a GitHub PR
        against <code>{status?.configured.GH_REPO || 'GH_REPO'}</code> using the worker-stored <code>GH_TOKEN</code>.
        Set secrets with <code>npx wrangler secret put CF_API_TOKEN</code> and <code>npx wrangler secret put GH_TOKEN</code>.
      </div>

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
