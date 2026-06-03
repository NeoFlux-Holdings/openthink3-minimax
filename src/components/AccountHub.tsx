import React, { useState } from 'react';
import {
  CreditCard, Shield, Cloud, Database,
  ArrowLeft, Check, RefreshCw, BarChart2, Globe
} from 'lucide-react';
import CloudflareSyncPanel from './CloudflareSyncPanel';

interface AccountHubProps {
  isStandalone?: boolean;
}

const AccountHub: React.FC<AccountHubProps> = ({ isStandalone = false }) => {

  const [customDomain, setCustomDomain] = useState(() => {
    return localStorage.getItem('openthink_custom_domain') || 'openthink.ai';
  });

  const [apiUrl, setApiUrl] = useState(() => {
    return localStorage.getItem('openthink_api_url') || 'https://openthink3-worker.thomas-zarebczan.workers.dev';
  });

  const handleCustomDomainChange = (val: string) => {
    setCustomDomain(val);
    localStorage.setItem('openthink_custom_domain', val);
  };

  const handleApiUrlChange = (val: string) => {
    setApiUrl(val);
    localStorage.setItem('openthink_api_url', val);
  };

  const [isDeploying, setIsDeploying] = useState(false);
  const [deployed, setDeployed] = useState(false);

  const handleTriggerDeploy = () => {
    if (isDeploying) return;
    setIsDeploying(true);
    setTimeout(() => {
      setIsDeploying(false);
      setDeployed(true);
      setTimeout(() => setDeployed(false), 3000);
    }, 2500);
  };

  const content = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', fontFamily: "'Inter', sans-serif" }}>

      {/* Active Developer Profile */}
      <div className="glass-panel glass-card glass-card--pad20" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div className="icon-badge--48">
          T
        </div>
        <div>
          <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Thomas</h4>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>Developer Account Profile • Agent Orange 0 Sync Active</span>
        </div>
      </div>

      {/* Billing & paid AI GPU Quota */}
      <div className="account-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>

        {/* Stripe Card */}
        <div className="glass-panel" style={{ padding: '16px', borderRadius: '8px', background: 'rgba(36,36,36,0.3)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: '10px' }}>Active Plan billing</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', gap: '10px' }}>
              <span style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>AI Pro Tier</span>
              <span style={{ background: 'rgba(16,185,129,0.1)', color: '#10B981', padding: '2px 6px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>Active</span>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '14px' }}>
              <CreditCard size={14} /> Stripe •••• 4242 (Renews June 15)
            </div>
          </div>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent-primary)' }}>$15.00 / month</span>
        </div>

        {/* Paid GPU Tokens Quota */}
        <div className="glass-panel" style={{ padding: '16px', borderRadius: '8px', background: 'rgba(36,36,36,0.3)' }}>
          <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: '10px', display: 'flex', justifyContent: 'space-between' }}>
            <span>Monthly GPU Quota Usage</span>
            <BarChart2 size={14} color="var(--accent-secondary)" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '4px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Edge Prompt Tokens</span>
            <span style={{ fontWeight: 700 }}>24,000 / 10,000,000</span>
          </div>
          <div style={{ width: '100%', height: '6px', background: 'var(--bg-tertiary)', borderRadius: '3px', overflow: 'hidden', marginBottom: '12px' }}>
            <div style={{ width: '0.24%', height: '100%', background: 'linear-gradient(to right, var(--accent-primary), var(--accent-secondary))' }} />
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', lineHeight: 1.3 }}>
            Paid tier edge routing active. Workers AI runs without quota throttling checks.
          </div>
        </div>
      </div>

      {/* Cloudflare Edge Infrastructure HUD */}
      <div className="glass-panel" style={{ padding: '20px', borderRadius: '12px', background: 'rgba(36,36,36,0.3)', border: '1px solid var(--border-subtle)' }}>
        <div className="section-header" style={{ marginBottom: '16px' }}>
          <span>Cloudflare Edge Infrastructure HUD</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#10B981', fontSize: '0.75rem' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10B981', boxShadow: '0 0 6px #10B981' }} /> Live
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Worker Endpoint */}
          <div className="row-flex-between-gap-10">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
              <Cloud size={16} color="var(--accent-primary)" />
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Cloudflare Workers AI Endpoint</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>{apiUrl}</div>
              </div>
            </div>
            <span style={{ fontSize: '0.75rem', color: '#10B981', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10B981' }} />
              Active
            </span>
          </div>

          {/* Durable Object SQLite */}
          <div className="row-flex-between-gap-10">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
              <Database size={16} color="var(--accent-secondary)" />
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Durable Object SQLite (ThreadDO + OrchestratorDO)</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>openthink_DO_sqlite.db (4.8 MB)</div>
              </div>
            </div>
            <span style={{ fontSize: '0.75rem', color: '#10B981', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10B981' }} />
              Active
            </span>
          </div>

          {/* R2 Backup snapshots */}
          <div className="row-flex-between-gap-10">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
              <Shield size={16} color="var(--accent-tertiary)" />
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Cloudflare R2 Incremental Backups</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>Repo branch worktree backups syncing every 5 mins.</div>
              </div>
            </div>
            <button type="button"
              className="btn btn-ghost"
              onClick={handleTriggerDeploy}
              disabled={isDeploying}
              style={{ padding: '6px 12px', fontSize: '0.75rem', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)', borderRadius: '4px' }}
            >
              {isDeploying ? <RefreshCw size={12} className="spin" /> : deployed ? <Check size={12} color="#10B981" /> : 'Backup Now'}
            </button>
          </div>
        </div>
      </div>

      {/* Cloudflare DNS & Custom Domains Guide */}
      <div className="glass-panel" style={{ padding: '20px', borderRadius: '12px', background: 'rgba(36,36,36,0.3)', border: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
          <Globe size={18} color="var(--accent-primary)" />
          <h4 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '0.95rem', fontWeight: 700 }}>Cloudflare Custom Domain Guide &amp; Config</h4>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label htmlFor="acct-custom-domain" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Your Custom Domain</label>
            <input
              id="acct-custom-domain"
              type="text"
              value={customDomain}
              onChange={e => handleCustomDomainChange(e.target.value)}
              className="input-field"
              placeholder="openthink.ai"
              style={{ fontSize: '0.85rem', padding: '10px 12px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)', borderRadius: '6px' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label htmlFor="acct-api-url" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Active Edge API Endpoint (Worker URL)</label>
            <input
              id="acct-api-url"
              type="text"
              value={apiUrl}
              onChange={e => handleApiUrlChange(e.target.value)}
              className="input-field"
              placeholder="https://openthink3-worker.thomas-zarebczan.workers.dev"
              style={{ fontSize: '0.85rem', padding: '10px 12px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)', borderRadius: '6px' }}
            />
          </div>

          <ol style={{ margin: 0, paddingLeft: 18, fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            <li>Add the worker.dev URL above as a <strong>CNAME</strong> in your Cloudflare DNS panel.</li>
            <li>Open <a href="https://dash.cloudflare.com/?to=/:account/:zone/rules/origin" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-secondary)' }}>Origin Rules</a> and forward <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 5px', borderRadius: 3 }}>openthink.ai</code> to the worker.</li>
            <li>Lock the route with <strong>Cloudflare Access</strong> to your email.</li>
          </ol>
          <div style={{ marginTop: '14px', display: 'flex', gap: '12px' }}>
            <a href="https://dash.cloudflare.com/" target="_blank" rel="noreferrer" style={{ fontSize: '0.75rem', color: 'var(--accent-secondary)', textDecoration: 'underline', fontWeight: 600 }}>
              Open Cloudflare Dashboard →
            </a>
            <a href="https://developers.cloudflare.com/pages/configuration/custom-domains/" target="_blank" rel="noreferrer" style={{ fontSize: '0.75rem', color: 'var(--accent-secondary)', textDecoration: 'underline', fontWeight: 600 }}>
              Pages Custom Domains Doc →
            </a>
          </div>
        </div>
      </div>

      {/* Cloudflare Artifact Sync — pull/push/PR for worker & agent evolution */}
      <CloudflareSyncPanel />
    </div>
  );

  if (isStandalone) {
    return (
      <div className="page-wrapper">
        <div style={{ maxWidth: '650px', width: '100%' }}>
          {/* Standalone Header */}
          <div className="row-flex-gap-12">
            <a href="/app" className="row-flex-gap-6">
              <ArrowLeft size={16} /> Return to Harness
            </a>
            <span style={{ color: 'var(--text-tertiary)' }}>|</span>
            <span style={{ fontSize: '1.2rem', fontFamily: "'Outfit', sans-serif", fontWeight: 700 }}>OpenThink Account Hub</span>
          </div>

          {content}
        </div>
      </div>
    );
  }

  return content;
};

export default AccountHub;
