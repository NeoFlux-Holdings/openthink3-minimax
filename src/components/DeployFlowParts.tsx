import React, { useState } from 'react';
import { Check, CreditCard, Key, ArrowRight, Loader2, Play, RefreshCw, LogOut, Cloud, ShieldCheck } from 'lucide-react';
import { getCfCreds, setCfCreds, clearCfCreds, resolveAccount, type CfCreds } from '../lib/cfCreds';
import { beginAuthorize, getSession, revokeAndSignOut, CF_OAUTH_CONFIG } from '../lib/cfOAuth';

export const ProgressStepper: React.FC<{
  step: number;
  maxStepReached: number;
  onStepSelect: (s: number) => void;
}> = ({ step, maxStepReached, onStepSelect }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '48px', position: 'relative' }}>
    <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: '2px', background: 'var(--border-strong)', zIndex: 0 }} />
    {[1, 2, 3, 4].map(s => {
      const isClickable = s <= maxStepReached;
      return (
        <button
          type="button"
          key={s}
          disabled={!isClickable}
          aria-disabled={!isClickable}
          aria-label={isClickable ? `Jump to Step ${s}` : `Complete previous steps to unlock Step ${s}`}
          onClick={() => isClickable && onStepSelect(s)}
          className="stepper-dot" data-active={step >= s} data-current={step === s}
          title={isClickable ? `Jump to Step ${s}` : `Complete previous steps to unlock Step ${s}`}
        >
          {step > s ? <Check size={16} /> : s}
        </button>
      );
    })}
  </div>
);

export const DomainPicker: React.FC<{
  domains: string[];
  loadingDomains: boolean;
  domainsSource: 'fallback' | 'cached' | 'live';
  useCustomDomain: boolean;
  selectedBaseDomain: string;
  onSelectDomain: (value: string) => void;
}> = ({ domains, loadingDomains, domainsSource, useCustomDomain, selectedBaseDomain, onSelectDomain }) => (
  <div style={{ marginBottom: '20px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
      <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
        ☁️ Select Cloudflare Domain ({domains.length} Detected)
      </label>
      {loadingDomains ? (
        <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Loader2 size={10} className="spin" /> Syncing…
        </span>
      ) : (
        <span className="status-source-badge" data-source={domainsSource}>
          {domainsSource === 'live' ? '● Live API Sync' : domainsSource === 'cached' ? '● Cached Build Sync' : '● Default Fallback'}
        </span>
      )}
    </div>
    <div style={{ position: 'relative' }}>
      <select
        value={useCustomDomain ? 'custom' : selectedBaseDomain}
        onChange={e => onSelectDomain(e.target.value)}
        className="input-field select-chevron"
      >
        {domains.map(d => (
          <option key={d} value={d} style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
            {d}
          </option>
        ))}
        <option value="custom" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)', fontWeight: 600 }}>
          Custom / External Domain…
        </option>
      </select>
    </div>
  </div>
);

export const SubdomainInput: React.FC<{
  useCustomDomain: boolean;
  subdomain: string;
  selectedBaseDomain: string;
  customDomainInput: string;
  onSubdomainChange: (v: string) => void;
  onCustomDomainChange: (v: string) => void;
}> = ({ useCustomDomain, subdomain, selectedBaseDomain, customDomainInput, onSubdomainChange, onCustomDomainChange }) => (
  !useCustomDomain ? (
    <div style={{ marginBottom: '24px' }}>
      <label htmlFor="deploy-subdomain" style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '8px' }}>
        Subdomain Prefix
      </label>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <input
          id="deploy-subdomain"
          type="text"
          className="input-field"
          value={subdomain}
          onChange={e => onSubdomainChange(e.target.value)}
          style={{ fontSize: '0.9rem', padding: '12px 14px', flex: 1 }}
          placeholder="ao-0"
        />
        <span style={{ color: 'var(--text-tertiary)', fontWeight: 600 }}>.</span>
        <span style={{ color: 'var(--accent-secondary)', fontWeight: 600, fontSize: '0.9rem', background: 'rgba(59, 130, 246, 0.08)', padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.15)' }}>
          {selectedBaseDomain}
        </span>
      </div>
    </div>
  ) : (
    <div style={{ marginBottom: '24px' }}>
      <label htmlFor="deploy-custom-domain" style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '8px' }}>
        Full Custom Domain Path
      </label>
      <input
        id="deploy-custom-domain"
        type="text"
        className="input-field"
        value={customDomainInput}
        onChange={e => onCustomDomainChange(e.target.value)}
        style={{ fontSize: '0.9rem', padding: '12px 14px' }}
        placeholder="ao-0.openthink.app"
      />
    </div>
  )
);

export const BindingPreview: React.FC<{
  useCustomDomain: boolean;
  subdomain: string;
  selectedBaseDomain: string;
  customDomainInput: string;
}> = ({ useCustomDomain, subdomain, selectedBaseDomain, customDomainInput }) => (
  <div className="glass-panel" style={{ padding: '16px', borderRadius: '8px', background: 'rgba(36,36,36,0.2)', marginBottom: '24px', boxShadow: 'inset 3px 0 0 0 #10B981' }}>
    <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#10B981', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
      Active secure tunnel bind mapping
    </span>
    <span style={{ fontFamily: 'monospace', fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
      https://{!useCustomDomain ? `${subdomain}.${selectedBaseDomain}` : customDomainInput}
    </span>
  </div>
);

export const AdvancedSettings: React.FC<{
  showAdvanced: boolean;
  onToggle: () => void;
  bypassAccess: boolean;
  onBypassAccessChange: (v: boolean) => void;
}> = ({ showAdvanced, onToggle, bypassAccess, onBypassAccessChange }) => (
  <div style={{ marginBottom: '24px' }}>
    <button type="button"
      onClick={onToggle}
      className="row-flex-gap-6"
    >
      {showAdvanced ? 'Hide Advanced Config ▴' : 'Show Advanced Config ▾'}
    </button>

    {showAdvanced && (
      <div className="glass-panel fade-in" style={{ marginTop: '12px', padding: '16px', borderRadius: '8px', background: 'rgba(255,255,255,0.01)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div className="row-flex-between-gap-10">
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', color: 'var(--text-primary)' }}>CF Access bypass</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>Allow public connections without Cloudflare Access auth headers.</span>
          </div>
          <input
            type="checkbox"
            checked={bypassAccess}
            onChange={e => onBypassAccessChange(e.target.checked)}
            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
           aria-label="Cloudflare API token" />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>Custom DNS Zone ID</span>
          <input
            type="text"
            className="input-field"
            placeholder="Automatic detection via wrangler"
            style={{ fontSize: '0.75rem', padding: '8px 10px', background: 'rgba(0,0,0,0.1)' }}
            disabled
           aria-label="Wrangler auth code" />
        </div>
      </div>
    )}
  </div>
);

export const Step1NameAgent: React.FC<{
  agentName: string;
  onAgentNameChange: (v: string) => void;
  onContinue: () => void;
}> = ({ agentName, onAgentNameChange, onContinue }) => (
  <div className="fade-in">
    <h2 style={{ fontSize: '1.5rem', marginBottom: '8px' }}>Name Your Agent</h2>
    <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>Give your personal agent a fun, memorable name.</p>
    <input
      type="text"
      className="input-field"
      value={agentName}
      onChange={e => onAgentNameChange(e.target.value)}
      style={{ marginBottom: '24px', fontSize: '1.25rem', padding: '16px' }}
      aria-label="Agent name" />
    <button type="button" className="btn btn-primary" style={{ width: '100%', padding: '16px', fontSize: '1.125rem' }} onClick={onContinue}>
      Continue <ArrowRight size={18} />
    </button>
  </div>
);

export const Step0CloudflareConnect: React.FC<{
  onConnected: (creds: CfCreds) => void;
}> = ({ onConnected }) => {
  const [tokenCreds, setTokenCreds] = useState<CfCreds | null>(() => getCfCreds());
  const [oauthSession, setOauthSession] = useState(() => getSession());
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTokenFallback, setShowTokenFallback] = useState(false);

  const handleConnect = async () => {
    if (!token.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const resolved = await resolveAccount(token.trim());
      setCfCreds(resolved);
      setTokenCreds(resolved);
      setToken('');
      onConnected(resolved);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnectToken = () => {
    clearCfCreds();
    setTokenCreds(null);
  };

  const handleOAuthSignIn = async () => {
    setError(null);
    try {
      await beginAuthorize('/deploy');
    } catch (e: any) {
      setError(e.message || String(e));
    }
  };

  const handleOAuthDisconnect = async () => {
    setBusy(true);
    try {
      await revokeAndSignOut();
      setOauthSession(null);
    } finally {
      setBusy(false);
    }
  };

  if (oauthSession) {
    return (
      <div className="fade-in">
        <div className="row-flex-gap-12">
          <Cloud color="#10B981" />
          <h2 style={{ fontSize: '1.5rem', margin: 0 }}>Connect Cloudflare</h2>
        </div>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
          Your Cloudflare account is connected via OAuth. OpenThink will deploy directly to this account.
        </p>
        <div style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '20px', borderRadius: 'var(--radius-md)', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <ShieldCheck size={16} color="#10B981" />
            <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#10B981' }}>
              Signed in as {oauthSession.email || oauthSession.accountName || oauthSession.accountId}
            </span>
          </div>
          {oauthSession.accountName && (
            <p style={{ fontSize: '0.875rem', margin: '0 0 4px', color: 'var(--text-secondary)' }}>
              Account: <strong style={{ color: 'var(--text-primary)' }}>{oauthSession.accountName}</strong>
            </p>
          )}
          <p style={{ fontSize: '0.75rem', marginTop: '6px', color: 'var(--text-tertiary)' }}>
            OAuth scopes: Workers (scripts, routes, KV), Pages, D1, Zone, Workers AI, account/user read.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button type="button" className="btn btn-ghost" onClick={handleOAuthDisconnect} disabled={busy}>
            <LogOut size={14} /> Sign out
          </button>
          <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={() => onConnected({
            token: 'oauth',
            accountId: oauthSession.accountId ?? '',
            accountName: oauthSession.accountName,
            email: oauthSession.email,
          })}>
            Continue <ArrowRight size={18} />
          </button>
        </div>
      </div>
    );
  }

  if (tokenCreds) {
    return (
      <div className="fade-in">
        <div className="row-flex-gap-12">
          <Key color="#10B981" />
          <h2 style={{ fontSize: '1.5rem', margin: 0 }}>Connect Cloudflare</h2>
        </div>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
          Your Cloudflare account is connected. OpenThink will deploy directly to this account.
        </p>

        <div style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '20px', borderRadius: 'var(--radius-md)', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10B981', boxShadow: '0 0 8px #10B981' }} />
            <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#10B981' }}>
              Connected to {tokenCreds.accountName || tokenCreds.accountId}
            </span>
          </div>
          {tokenCreds.email && (
            <p style={{ fontSize: '0.875rem', margin: 0, color: 'var(--text-secondary)' }}>
              Logged in as: <strong style={{ color: 'var(--text-primary)' }}>{tokenCreds.email}</strong>
            </p>
          )}
          <p style={{ fontSize: '0.75rem', marginTop: '6px', color: 'var(--text-tertiary)' }}>
            Full write permissions found for Workers scripts, D1 databases, Pages assets, and KV stores.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button type="button" className="btn btn-ghost" onClick={handleDisconnectToken}>
            <LogOut size={14} /> Disconnect
          </button>
          <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={() => onConnected(tokenCreds)}>
            Continue <ArrowRight size={18} />
          </button>
        </div>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
          Your Cloudflare account is connected. OpenThink will deploy directly to this account.
        </p>

        <div style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '20px', borderRadius: 'var(--radius-md)', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10B981', boxShadow: '0 0 8px #10B981' }} />
            <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#10B981' }}>
              Connected to {tokenCreds.accountName || tokenCreds.accountId}
            </span>
          </div>
          {tokenCreds.email && (
            <p style={{ fontSize: '0.875rem', margin: 0, color: 'var(--text-secondary)' }}>
              Logged in as: <strong style={{ color: 'var(--text-primary)' }}>{tokenCreds.email}</strong>
            </p>
          )}
          <p style={{ fontSize: '0.75rem', marginTop: '6px', color: 'var(--text-tertiary)' }}>
            Full write permissions found for Workers scripts, D1 databases, Pages assets, and KV stores.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button type="button" className="btn btn-ghost" onClick={handleDisconnectToken}>
            <LogOut size={14} /> Disconnect
          </button>
          <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={() => onConnected(tokenCreds)}>
            Continue <ArrowRight size={18} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div className="row-flex-gap-12">
        <Cloud color="var(--accent-secondary)" />
        <h2 style={{ fontSize: '1.5rem', margin: 0 }}>Connect Cloudflare</h2>
      </div>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
        OpenThink deploys directly to your Cloudflare account. The recommended path is OAuth — no token to copy, scoped to exactly what we need.
      </p>

      {CF_OAUTH_CONFIG.isConfigured() ? (
        <>
          <button type="button"
            className="btn btn-primary"
            style={{ width: '100%', padding: '16px', fontSize: '1.125rem', marginBottom: '12px' }}
            onClick={handleOAuthSignIn}
            disabled={busy}
          >
            <Cloud size={18} /> Sign in with Cloudflare <ArrowRight size={18} />
          </button>
          {error && (
            <div style={{ fontSize: '0.75rem', color: '#EF4444', marginBottom: '12px' }}>{error}</div>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            style={{ width: '100%', fontSize: '0.8rem' }}
            onClick={() => setShowTokenFallback(s => !s)}
          >
            {showTokenFallback ? 'Hide' : 'Or use an API token instead'} →
          </button>
          {showTokenFallback && (
            <div className="glass-card" style={{ marginTop: '20px' }}>
              <label htmlFor="cf-token-input" style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '8px' }}>
                Cloudflare API Token
              </label>
              <input
                id="cf-token-input"
                type="password"
                className="input-field"
                value={token}
                onChange={e => setToken(e.target.value)}
                placeholder="cf-api-token-…"
                style={{ fontSize: '0.9rem', padding: '12px 14px' }}
                disabled={busy}
                aria-label="Cloudflare API token"
              />
              <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: '8px', fontSize: '0.75rem', color: 'var(--accent-secondary)', textDecoration: 'underline' }}>
                Create a token at dash.cloudflare.com →
              </a>
              <button type="button"
                className="btn btn-primary"
                style={{ width: '100%', marginTop: '12px' }}
                onClick={handleConnect}
                disabled={busy || !token.trim()}
              >
                {busy ? <><RefreshCw size={14} className="spin" /> Connecting…</> : 'Connect with token'}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="glass-card" style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginBottom: '12px' }}>
            OAuth client not configured on this build. Falling back to API token.
          </div>
          <label htmlFor="cf-token-input" style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '8px' }}>
            Cloudflare API Token
          </label>
          <input
            id="cf-token-input"
            type="password"
            className="input-field"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="cf-api-token-…"
            style={{ fontSize: '0.9rem', padding: '12px 14px' }}
            disabled={busy}
            aria-label="Cloudflare API token"
          />
          {error && (
            <div style={{ fontSize: '0.75rem', color: '#EF4444', marginTop: '8px' }}>{error}</div>
          )}
          <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: '8px', fontSize: '0.75rem', color: 'var(--accent-secondary)', textDecoration: 'underline' }}>
            Create a token at dash.cloudflare.com →
          </a>
          <button type="button"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: '12px' }}
            onClick={handleConnect}
            disabled={busy || !token.trim()}
          >
            {busy ? <><RefreshCw size={14} className="spin" /> Connecting…</> : 'Connect'}
          </button>
        </div>
      )}
    </div>
  );
};

export const Step2CloudflareAccess: React.FC<{
  onBack: () => void;
  onContinue: () => void;
}> = ({ onBack, onContinue }) => (
  <div className="fade-in">
    <div className="row-flex-gap-12">
      <Key color="var(--accent-secondary)" />
      <h2 style={{ fontSize: '1.5rem', margin: 0 }}>Cloudflare Access</h2>
    </div>
    <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
      OpenThink deploys directly to your Cloudflare account. We detected an active OAuth credentials session.
    </p>

    <div style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '20px', borderRadius: 'var(--radius-md)', marginBottom: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10B981', boxShadow: '0 0 8px #10B981' }} />
        <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#10B981' }}>Wrangler Authentication Active</span>
      </div>
      <p style={{ fontSize: '0.875rem', margin: 0, color: 'var(--text-secondary)' }}>
        Logged in as: <strong style={{ color: 'var(--text-primary)' }}>thomas.zarebczan@gmail.com</strong>
      </p>
      <p style={{ fontSize: '0.75rem', marginTop: '6px', color: 'var(--text-tertiary)' }}>
        Full write permissions found for Workers scripts, D1 databases, Pages assets, and KV stores.
      </p>
    </div>

    <div style={{ display: 'flex', gap: '12px' }}>
      <button type="button" className="btn btn-ghost" onClick={onBack}>Back</button>
      <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={onContinue}>
        Use Active Session
      </button>
    </div>
  </div>
);

export const Step4Review: React.FC<{
  agentName: string;
  domain: string;
  onBack: () => void;
  onDeploy: () => void;
}> = ({ agentName, domain, onBack, onDeploy }) => (
  <div className="fade-in">
    <div className="row-flex-gap-12">
      <CreditCard color="#10B981" />
      <h2 style={{ fontSize: '1.5rem', margin: 0 }}>Review & Deploy</h2>
    </div>
    <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
      You're ready to spin up <strong>{agentName}</strong>.
      (Optional: Add Stripe to manage domain purchases and setup).
    </p>

    <div style={{ background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', padding: '16px', marginBottom: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ color: 'var(--text-secondary)' }}>Agent Name</span>
        <span style={{ fontWeight: 600 }}>{agentName}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ color: 'var(--text-secondary)' }}>Domain</span>
        <span style={{ fontWeight: 600 }}>{domain || 'Auto-generated CF worker'}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ color: 'var(--text-secondary)' }}>Security</span>
        <span style={{ fontWeight: 600, color: '#10B981' }}>CF Access Locked</span>
      </div>
    </div>

    <div style={{ display: 'flex', gap: '12px' }}>
      <button type="button" className="btn btn-ghost" onClick={onBack}>Back</button>
      <button type="button" className="btn btn-primary" style={{ flex: 1, padding: '16px', fontSize: '1.125rem' }} onClick={onDeploy}>
        Deploy Infrastructure <Play size={18} fill="currentColor" />
      </button>
    </div>
  </div>
);

export const DeployProgress: React.FC<{
  agentName: string;
  steps: Array<{ id: string; label: string; status: 'pending' | 'running' | 'done' | 'error'; detail?: string }>;
  rawLog: string[];
  showRawLog: boolean;
  setShowRawLog: (v: boolean) => void;
  agentUrl: string | null;
}> = ({ agentName, steps, rawLog, showRawLog, setShowRawLog, agentUrl }) => {
  const allDone = steps.every(s => s.status === 'done');
  const anyError = steps.some(s => s.status === 'error');
  const targetUrl = agentUrl ?? `https://${steps.find(s => s.id === 'open')?.detail?.replace(/^https?:\/\//, '') ?? ''}`;

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', padding: '8px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        {allDone ? (
          <Check size={28} color="#10B981" />
        ) : anyError ? (
          <LogOut size={28} color="#EF4444" />
        ) : (
          <Loader2 size={28} color="var(--accent-primary)" className="spin" />
        )}
        <h2 style={{ fontSize: '1.4rem', margin: 0 }}>
          {allDone ? `${agentName} is ready` : anyError ? 'Something went wrong' : `Setting up ${agentName}…`}
        </h2>
      </div>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {steps.map(step => {
          const isDone = step.status === 'done';
          const isRunning = step.status === 'running';
          const isError = step.status === 'error';
          return (
            <li
              key={step.id}
              data-status={step.status}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 12px',
                borderRadius: 'var(--radius-md)',
                background: isRunning ? 'var(--bg-tertiary)' : 'transparent',
                transition: 'background 200ms',
              }}
            >
              <span style={{ width: '20px', display: 'inline-flex', justifyContent: 'center' }}>
                {isDone ? <Check size={16} color="#10B981" /> :
                 isError ? <LogOut size={16} color="#EF4444" /> :
                 isRunning ? <Loader2 size={16} color="var(--accent-primary)" className="spin" /> :
                 <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--border-strong)' }} />}
              </span>
              <span style={{ flex: 1, color: isDone || isRunning ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                {step.label}
              </span>
              {step.detail && (
                <span style={{ fontSize: '0.8rem', color: isError ? '#EF4444' : 'var(--text-tertiary)' }}>
                  {step.detail}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {allDone && (
        <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <a
            href={targetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
            style={{ padding: '16px', fontSize: '1.05rem', textAlign: 'center', textDecoration: 'none' }}
          >
            Open your agent <ArrowRight size={18} />
          </a>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', textAlign: 'center' }}>
            {targetUrl}
          </span>
        </div>
      )}

      {anyError && (
        <div style={{ marginTop: '24px', padding: '12px 16px', borderRadius: 'var(--radius-md)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444', fontSize: '0.9rem' }}>
          Deployment failed. Check the details below or try again.
        </div>
      )}

      <button
        type="button"
        className="btn-ghost-sm"
        onClick={() => setShowRawLog(!showRawLog)}
        style={{ alignSelf: 'flex-start', marginTop: '16px', fontSize: '0.75rem' }}
        aria-expanded={showRawLog}
      >
        {showRawLog ? 'Hide' : 'Show'} build details ({rawLog.length} lines)
      </button>
      {showRawLog && (
        <div className="code-log--elevated" style={{ marginTop: '8px', maxHeight: '240px', overflow: 'auto' }}>
          {rawLog.slice(-100).map((log) => (
            <div key={log} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem' }}>
              <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'var(--border-strong)', flexShrink: 0 }} />
              <span style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{log}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
