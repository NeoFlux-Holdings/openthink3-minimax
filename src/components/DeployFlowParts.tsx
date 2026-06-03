import React from 'react';
import { Check, CreditCard, Key, ArrowRight, Loader2, Play } from 'lucide-react';

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
  progressLog: string[];
}> = ({ agentName, progressLog }) => (
  <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 0' }}>
    <Loader2 size={48} color="var(--accent-primary)" className="spin" style={{ marginBottom: '24px' }} />
    <h2 style={{ fontSize: '1.5rem', marginBottom: '16px' }}>Deploying {agentName}...</h2>

    <div className="code-log--elevated">
      {progressLog.map((log, i) => (
        <div key={`deploy-${log.slice(0, 20)}`} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: i === progressLog.length - 1 ? 'var(--accent-secondary)' : '#10B981' }} />
          <span style={{ color: i === progressLog.length - 1 ? 'var(--text-primary)' : 'inherit' }}>{log}</span>
        </div>
      ))}
    </div>
  </div>
);
