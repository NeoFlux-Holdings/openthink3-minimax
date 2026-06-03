import React from 'react';
import { Check, AlertCircle, Key, Download, Upload, GitPullRequest, History, Cpu, Package, Cloud, Terminal, RefreshCw, type LucideIcon } from 'lucide-react';
import type { CfCreds } from '../lib/cfCreds';

export const CfConnectionBanner: React.FC<{
  creds: CfCreds | null;
  connectToken: string;
  connectBusy: boolean;
  connectError: string | null;
  onTokenChange: (v: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
}> = ({ creds, connectToken, connectBusy, connectError, onTokenChange, onConnect, onDisconnect }) => (
  creds ? (
    <div className="glass-card glass-card--md" style={{ borderColor: 'rgba(16, 185, 129, 0.3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10B981', boxShadow: '0 0 8px #10B981' }} />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#10B981' }}>
            Connected to {creds.accountName || creds.accountId}
          </span>
          {creds.email && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{creds.email}</span>
          )}
        </div>
      </div>
      <button type="button" className="btn btn-ghost" onClick={onDisconnect} style={{ fontSize: '0.75rem', padding: '4px 10px' }}>
        Disconnect
      </button>
    </div>
  ) : (
    <div className="glass-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <Key size={14} color="var(--accent-secondary)" />
        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>Connect Cloudflare</span>
      </div>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', margin: '0 0 8px 0', lineHeight: 1.4 }}>
        Paste a Cloudflare API token with Workers + Pages + Zones read scope. Stored only in your browser.
      </p>
      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          type="password"
          className="input-field"
          value={connectToken}
          onChange={e => onTokenChange(e.target.value)}
          placeholder="cf-api-token-…"
          style={{ fontSize: '0.8rem', padding: '8px 12px' }}
          disabled={connectBusy}
          aria-label="Cloudflare API token"
        />
        <button type="button"
          className="btn btn-primary"
          onClick={onConnect}
          disabled={connectBusy || !connectToken.trim()}
          style={{ padding: '8px 16px', minHeight: 0 }}
        >
          {connectBusy ? <RefreshCw size={12} className="spin" /> : 'Connect'}
        </button>
      </div>
      {connectError && (
        <div style={{ fontSize: '0.75rem', color: '#EF4444', marginTop: '6px' }}>{connectError}</div>
      )}
    </div>
  )
);

export const CfDiagnostics: React.FC<{
  status: { configured: Record<string, any>; credentialsSource?: string } | null;
}> = ({ status }) => {
  if (!status) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
      <StatusDot ok={status.configured.CF_API_TOKEN} label={`CF API token ${status.configured.CF_API_TOKEN ? 'set' : 'missing'}`} />
      <StatusDot ok={status.configured.CF_ACCOUNT_ID} label={`CF account id ${status.configured.CF_ACCOUNT_ID ? 'set' : 'missing'}`} />
      <StatusDot ok={status.configured.GH_TOKEN} label={`GitHub token ${status.configured.GH_TOKEN ? 'set' : 'missing'}`} />
      <StatusDot ok={status.configured.ARTIFACTS_KV} label="ARTIFACTS KV" />
      <StatusDot ok={!!status.configured.GH_REPO} label={status.configured.GH_REPO || 'GH_REPO missing'} />
      {status.credentialsSource && (
        <StatusDot ok={status.credentialsSource === 'header'} label={`creds from ${status.credentialsSource}`} />
      )}
    </div>
  );
};

const StatusDot: React.FC<{ ok: boolean; label: string }> = ({ ok, label }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: ok ? '#10B981' : '#EF4444' }}>
    <div style={{ width: 6, height: 6, borderRadius: '50%', background: ok ? '#10B981' : '#EF4444' }} />
    {label}
  </div>
);

export const CfLocalRemote: React.FC<{
  localSha: string | null | undefined;
  localMeta: { sha256?: string; bytes?: number; builtAt?: string } | null | undefined;
  remoteSha: string | null | undefined;
  manifest: { sha256?: string | null; bytes?: number; deployedAt?: string | null } | null | undefined;
  inSync: boolean;
  staged: boolean;
  shortSha: (s: string | null | undefined) => string;
  fmtBytes: (b?: number) => string;
  relTime: (t: number | null | undefined) => string;
}> = ({ localSha, localMeta, remoteSha, manifest, inSync, staged, shortSha, fmtBytes, relTime }) => (
  <>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 12 }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>Local</div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontFamily: 'monospace' }}>
          sha {shortSha(localMeta?.sha256 || localSha)}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
          {localMeta ? fmtBytes(localMeta.bytes) : '—'} · built {localMeta && localMeta.builtAt ? relTime(new Date(localMeta.builtAt).getTime()) : 'never'}
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
  </>
);

export const CfActionButtons: React.FC<{
  busy: string | null;
  ghTokenConfigured: boolean;
  onPull: () => void;
  onPush: () => void;
  onAgentPR: () => void;
}> = ({ busy, ghTokenConfigured, onPull, onPush, onAgentPR }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
    <button type="button"
      className="btn btn-ghost"
      onClick={onPull}
      disabled={!!busy}
      style={{ flex: '1 1 130px', minHeight: 40, gap: 6 }}
    >
      <Download size={14} /> {busy === 'pull' ? 'Pulling…' : 'Pull from Cloud'}
    </button>
    <button type="button"
      className="btn btn-primary"
      onClick={onPush}
      disabled={!!busy}
      style={{ flex: '1 1 130px', minHeight: 40, gap: 6 }}
    >
      <Upload size={14} /> {busy === 'push' ? 'Pushing…' : 'Push to Cloud'}
    </button>
    <button type="button"
      className="btn btn-ghost"
      onClick={onAgentPR}
      disabled={!!busy || !ghTokenConfigured}
      title={!ghTokenConfigured ? 'GH_TOKEN not configured' : 'Open a GitHub PR via the agent'}
      style={{ flex: '1 1 130px', minHeight: 40, gap: 6 }}
    >
      <GitPullRequest size={14} /> {busy === 'pr' ? 'Submitting…' : 'Agent PR'}
    </button>
  </div>
);

type HistoryEntry = { id: string; ts: number; type: string; ok: boolean; summary: string };

const historyIcon = (h: HistoryEntry): LucideIcon => {
  if (h.type === 'deploy') return Cpu;
  if (h.type === 'pr') return GitPullRequest;
  if (h.type === 'stage') return Package;
  if (h.type === 'pages') return Cloud;
  return History;
};

export const CfHistoryList: React.FC<{ history: HistoryEntry[]; relTime: (t: number) => string }> = ({ history, relTime }) => {
  if (history.length === 0) return null;
  return (
    <div>
      <div className="section-label--activity">
        <History size={12} /> Recent Activity
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {history.slice(0, 5).map((h) => {
          const Icon = historyIcon(h);
          return (
            <div key={h.id} className="pill-history-row">
              <Icon size={12} color={h.ok ? '#10B981' : '#EF4444'} />
              <span style={{ flex: 1 }}>{h.summary}</span>
              <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>{relTime(h.ts)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const CfActivityLog: React.FC<{ log: string[]; error: string | null }> = ({ log, error }) => {
  if (log.length === 0 && !error) return null;
  return (
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
  );
};
