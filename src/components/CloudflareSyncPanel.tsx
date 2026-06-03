import { useEffect, useState, useCallback } from 'react';
import {
  Cloud, Upload, Download, GitPullRequest, RefreshCw,
  Check, AlertCircle, History, Package, Terminal, Cpu
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* CloudflareSyncPanel                                                 */
/* ------------------------------------------------------------------ */
/*
 * Bidirectional sync between the local OpenThink build and the
 * Cloudflare account that owns the deployed agent. Backed by the
 * `/api/cf/*` endpoints on the worker (which proxy to the real
 * Cloudflare REST API + GitHub API using server-side secrets).
 *
 *   Pull  → fetch the latest manifest from the worker KV
 *   Push  → bundle worker locally, upload to `worker:staged`, deploy via CF API
 *   PR    → open a GitHub PR against the configured repo (the agent's evolution hook)
 *
 * Local state for the bundle meta is kept in localStorage so we can show
 * a clear "local vs remote" diff after a refresh.
 */

const API_BASE = (() => {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('openthink_api_url') || `${window.location.origin}`;
})();

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

async function api(path: string, init: RequestInit = {}, base = API_BASE): Promise<any> {
  const r = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
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

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: ok ? '#10B981' : 'var(--text-tertiary)' }}>
      <div style={{
        width: 7, height: 7, borderRadius: '50%',
        background: ok ? '#10B981' : 'var(--text-tertiary)',
        boxShadow: ok ? '0 0 6px #10B981' : 'none',
      }} />
      {label}
    </div>
  );
}

export default function CloudflareSyncPanel({ apiBase }: CloudflareSyncPanelProps) {
  const base = apiBase || API_BASE;
  const [status, setStatus] = useState<Status | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [staged, setStaged] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [localMeta, setLocalMeta] = useState<BundleMeta | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>(() => {
    const stored = localStorage.getItem(LSK.lastPullTs);
    return stored ? [`Last pull: ${relTime(parseInt(stored, 10))}`] : [];
  });
  const [error, setError] = useState<string | null>(null);
  const showError = (e: string | null) => setError(e);

  const append = (s: string) => setLog(l => [...l, s]);

  const refreshAll = useCallback(async () => {
    showError(null);
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
      showError(e.message || String(e));
    }
  }, [base]);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  /* ── Pull: download the remote worker bundle + refresh manifest ── */
  const handlePull = async () => {
    setBusy('pull');
    showError(null);
    try {
      const r = await fetch(`${base}/api/cf/bundle/worker`);
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
      showError(e.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  /* ── Push: fetch local bundle, stage, then deploy ── */
  const handlePush = async () => {
    setBusy('push');
    showError(null);
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
      showError(e.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  /* ── Agent PR: open a GitHub PR for self-evolution ── */
  const handleAgentPR = async () => {
    setBusy('pr');
    showError(null);
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
      showError(e.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  const localSha = localStorage.getItem(LSK.localBundleSha) || localMeta?.sha256 || null;
  const remoteSha = manifest?.sha256 || null;
  const inSync = !!localSha && localSha === remoteSha;

  return (
    <div className="glass-panel" style={{ padding: '20px', borderRadius: '12px', background: 'rgba(36,36,36,0.3)', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
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

      {/* Diagnostics: what is configured on the worker */}
      {status && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          <StatusDot ok={status.configured.CF_API_TOKEN} label={`CF API token ${status.configured.CF_API_TOKEN ? 'set' : 'missing'}`} />
          <StatusDot ok={status.configured.CF_ACCOUNT_ID} label={`CF account id ${status.configured.CF_ACCOUNT_ID ? 'set' : 'missing'}`} />
          <StatusDot ok={status.configured.GH_TOKEN} label={`GitHub token ${status.configured.GH_TOKEN ? 'set' : 'missing'}`} />
          <StatusDot ok={status.configured.ARTIFACTS_KV} label="ARTIFACTS KV" />
          <StatusDot ok={!!status.configured.GH_REPO} label={status.configured.GH_REPO || 'GH_REPO missing'} />
        </div>
      )}

      {/* Local vs Remote state */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>Local</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontFamily: 'monospace' }}>
            sha {shortSha(localMeta?.sha256 || localSha)}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
            {localMeta ? fmtBytes(localMeta.bytes) : '—'} · built {localMeta ? relTime(new Date(localMeta.builtAt).getTime()) : 'never'}
          </div>
        </div>
        <div style={{
          background: 'rgba(255,255,255,0.02)',
          border: `1px solid ${inSync ? 'rgba(16, 185, 129, 0.4)' : 'rgba(245, 158, 11, 0.4)'}`,
          borderRadius: 8, padding: 12,
        }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>Remote</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontFamily: 'monospace' }}>
            sha {shortSha(remoteSha)}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
            {fmtBytes(manifest?.bytes)} · deployed {relTime(manifest?.deployedAt ? new Date(manifest.deployedAt).getTime() : null)}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem' }}>
        {inSync ? (
          <><Check size={14} color="#10B981" /> <span style={{ color: '#10B981' }}>Local and remote are in sync</span></>
        ) : (
          <><AlertCircle size={14} color="#F59E0B" /> <span style={{ color: '#F59E0B' }}>Local and remote differ - push or pull to reconcile</span></>
        )}
        {staged && (
          <span style={{ marginLeft: 12, padding: '2px 8px', background: 'rgba(245, 158, 11, 0.15)', color: '#F59E0B', borderRadius: 4, fontWeight: 600 }}>
            bundle staged
          </span>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button"
          className="btn btn-ghost"
          onClick={handlePull}
          disabled={!!busy}
          style={{ flex: '1 1 130px', minHeight: 40, gap: 6 }}
        >
          <Download size={14} /> {busy === 'pull' ? 'Pulling…' : 'Pull from Cloud'}
        </button>
        <button type="button"
          className="btn btn-primary"
          onClick={handlePush}
          disabled={!!busy}
          style={{ flex: '1 1 130px', minHeight: 40, gap: 6 }}
        >
          <Upload size={14} /> {busy === 'push' ? 'Pushing…' : 'Push to Cloud'}
        </button>
        <button type="button"
          className="btn btn-ghost"
          onClick={handleAgentPR}
          disabled={!!busy || !status?.configured.GH_TOKEN}
          title={!status?.configured.GH_TOKEN ? 'GH_TOKEN not configured' : 'Open a GitHub PR via the agent'}
          style={{ flex: '1 1 130px', minHeight: 40, gap: 6 }}
        >
          <GitPullRequest size={14} /> {busy === 'pr' ? 'Submitting…' : 'Agent PR'}
        </button>
      </div>

      {/* History (last 5) */}
      {history.length > 0 && (
        <div>
          <div className="section-label--activity">
            <History size={12} /> Recent Activity
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {history.slice(0, 5).map((h) => (
              <div key={h.id} className="pill-history-row">
                {h.type === 'deploy' && <Cpu size={12} color={h.ok ? '#10B981' : '#EF4444'} />}
                {h.type === 'pr' && <GitPullRequest size={12} color={h.ok ? '#10B981' : '#EF4444'} />}
                {h.type === 'stage' && <Package size={12} color={h.ok ? '#F59E0B' : '#EF4444'} />}
                {h.type === 'pages' && <Cloud size={12} color={h.ok ? '#10B981' : '#EF4444'} />}
                <span style={{ flex: 1 }}>{h.summary}</span>
                <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>{relTime(h.ts)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activity log + errors */}
      {(log.length > 0 || error) && (
        <div className="code-log--black">
          {log.map((l) => (
            <div key={`log-${l.slice(0, 20)}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Terminal size={10} color="var(--text-tertiary)" /> {l}
            </div>
          ))}
          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#EF4444', marginTop: 4 }}>
              <AlertCircle size={10} /> {error}
            </div>
          )}
        </div>
      )}

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
