import React, { useState } from 'react';
import {
  Puzzle, Brain, Zap, Server, Wrench, ToggleLeft, ToggleRight,
  ChevronDown, ChevronUp, ExternalLink,
  Plus, Settings, RefreshCw
} from 'lucide-react';

interface Plugin {
  id: string;
  name: string;
  description: string;
  longDescription: string;
  enabled: boolean;
  configurable: boolean;
  status: 'active' | 'config_needed' | 'optional' | 'installing';
  source: 'builtin' | 'community';
  icon: React.ReactNode;
  iconColor: string;
  skills: string[];
  link: string;
  premium?: boolean;
  config?: Record<string, { label: string; placeholder: string; type?: string }>;
}

const getApiUrl = () => {
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') return 'http://127.0.0.1:8787';
  return 'https://openthink3-worker.thomas-zarebczan.workers.dev';
};

function getStatusBadge(status: Plugin['status'], enabled: boolean) {
  if (!enabled) return { label: 'Disabled', color: 'var(--text-tertiary)', bg: 'rgba(255,255,255,0.03)' };
  return {
    active: { label: '● Active', color: '#10B981', bg: 'rgba(16,185,129,0.08)' },
    config_needed: { label: '⚠ Setup needed', color: '#F59E0B', bg: 'rgba(245,158,11,0.08)' },
    optional: { label: '○ Optional', color: '#3B82F6', bg: 'rgba(59,130,246,0.08)' },
    installing: { label: '⏳ Installing', color: '#8B5CF6', bg: 'rgba(139,92,246,0.08)' },
  }[status];
}

const BUILTIN_PLUGINS: Omit<Plugin, 'enabled'>[] = [
  {
    id: 'gbrain-memory',
    name: 'GBrain Memory',
    description: 'Persistent, synthesized agent memory with knowledge graphs',
    longDescription: 'GBrain gives your agent persistent memory that survives sessions. Uses hybrid vector + BM25 + knowledge graph retrieval with zero LLM calls in the retrieval loop. 97.9% R@5 on LongMemEval — SOTA.',
    configurable: true,
    status: 'active',
    source: 'builtin',
    icon: <Brain size={20} />,
    iconColor: '#8B5CF6',
    skills: ['Memory enrichment', 'Knowledge synthesis', 'Gap analysis', 'Dream cycles'],
    link: 'https://github.com/garrytan/gbrain',
    config: {
      vmUrl: { label: 'exe.dev VM URL', placeholder: 'https://my-vm.exe.xyz' },
    }
  },
  {
    id: 'gstack-discipline',
    name: 'GStack Discipline',
    description: 'Structured agentic workflow with 23 opinionated skills',
    longDescription: 'GStack wraps your agent in Garry Tan\'s exact Claude Code setup: CEO review, engineering manager, QA, designer personas. The "GStack Discipline" skill enforces Think→Plan→Build→Review→Ship cadence on all responses.',
    configurable: false,
    status: 'active',
    source: 'builtin',
    icon: <Zap size={20} />,
    iconColor: '#F59E0B',
    skills: ['/office-hours', '/plan', '/build', '/qa', '/ship', '/review'],
    link: 'https://github.com/garrytan/gstack',
  },
  {
    id: 'exe-dev-compute',
    name: 'exe.dev Compute',
    description: 'Persistent Linux VMs for long-running agent processes',
    longDescription: 'Provision and manage persistent Linux VMs via exe.dev. Run GBrain server, code execution sandboxes, eval runners, and any long-lived agent process. SSH-first with automatic HTTPS and auth proxy.',
    configurable: true,
    status: 'config_needed',
    source: 'builtin',
    icon: <Server size={20} />,
    iconColor: '#3B82F6',
    skills: ['VM provisioning', 'SSH exec', 'HTTPS routing', 'Agent hosting'],
    link: 'https://exe.dev/',
    premium: true,
    config: {
      apiToken: { label: 'exe.dev API Token', placeholder: 'Bearer token from ssh exe.dev ssh-key generate-api-key', type: 'password' },
    }
  },
  {
    id: 'executor-tools',
    name: 'Executor Tool Catalog',
    description: 'Unified tool integration layer — OpenAPI, MCP, GraphQL, custom JS',
    longDescription: 'Executor unifies all tool types (OpenAPI specs, MCP servers, GraphQL endpoints, custom JS/TS functions) into a single catalog with human-in-the-loop approval gates and workspace-scoped credentials.',
    configurable: true,
    status: 'optional',
    source: 'builtin',
    icon: <Wrench size={20} />,
    iconColor: '#10B981',
    skills: ['OpenAPI connectors', 'MCP pass-through', 'Approval gates', 'Tool catalog'],
    link: 'https://github.com/RhysSullivan/executor',
    config: {
      executorUrl: { label: 'Executor URL', placeholder: 'http://127.0.0.1:4788 (or VM URL)' },
    }
  },
];

const PluginPanel: React.FC = () => {
  const [plugins, setPlugins] = useState<Plugin[]>(() =>
    BUILTIN_PLUGINS.map(p => ({
      ...p,
      enabled: localStorage.getItem(`plugin_${p.id}`) !== 'false'
        || p.status === 'optional' ? localStorage.getItem(`plugin_${p.id}`) === 'true' : true
    }))
  );

  const [expandedId, setExpandedId] = useState<string | null>('gbrain-memory');
  const [configuringId, setConfiguringId] = useState<string | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [communityUrl, setCommunityUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [showAddCommunity, setShowAddCommunity] = useState(false);

  const togglePlugin = (id: string) => {
    setPlugins(prev => prev.map(p => {
      if (p.id !== id) return p;
      const next = !p.enabled;
      localStorage.setItem(`plugin_${id}`, String(next));
      // Sync brain skills
      if (id === 'gbrain-memory') localStorage.setItem('skill_gbrain_memory', String(next));
      if (id === 'gstack-discipline') localStorage.setItem('skill_gstack_discipline', String(next));
      window.dispatchEvent(new Event('storage'));
      return { ...p, enabled: next };
    }));
  };

  const saveConfig = (pluginId: string) => {
    Object.entries(configValues).forEach(([k, v]) => {
      localStorage.setItem(`plugin_config_${pluginId}_${k}`, v);
      if (pluginId === 'exe-dev-compute' && k === 'apiToken') {
        // Mark as configured
        setPlugins(prev => prev.map(p => p.id === pluginId ? { ...p, status: 'active' } : p));
      }
      if (pluginId === 'gbrain-memory' && k === 'vmUrl') {
        localStorage.setItem('openthink_gbrain_vm', v);
      }
    });
    setConfiguringId(null);
    setConfigValues({});
  };

  const addCommunityPlugin = async () => {
    if (!communityUrl.trim()) return;
    setAdding(true);
    try {
      const r = await fetch(`${getApiUrl()}/api/plugins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: communityUrl })
      });
      if (r.ok) {
        const plugin = await r.json();
        setPlugins(prev => [...prev, { ...plugin, enabled: true, source: 'community', icon: <Puzzle size={20} />, iconColor: '#EC4899' }]);
        setCommunityUrl('');
        setShowAddCommunity(false);
      }
    } catch {
      // Community plugins not connected
    }
    setAdding(false);
  };

  const statusBadge = getStatusBadge;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontFamily: "'Inter', sans-serif" }}>

      {/* ── HEADER ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '7px' }}>
            <Puzzle size={16} color="var(--accent-primary)" />
            Plugin System
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '2px' }}>
            {plugins.filter(p => p.enabled).length} of {plugins.length} plugins active
          </div>
        </div>
        <button type="button"
          onClick={() => setShowAddCommunity(!showAddCommunity)}
          style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '6px 10px', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.75rem' }}
        >
          <Plus size={12} />
          Community Plugin
        </button>
      </div>

      {/* Add community plugin */}
      {showAddCommunity && (
        <div style={{ background: 'rgba(236,72,153,0.04)', border: '1px solid rgba(236,72,153,0.15)', borderRadius: '8px', padding: '12px' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#EC4899', marginBottom: '8px' }}>Add Community Plugin</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              value={communityUrl}
              onChange={e => setCommunityUrl(e.target.value)}
              placeholder="https://raw.githubusercontent.com/.../plugin.json"
              className="input-field"
              style={{ flex: 1, fontSize: '0.78rem', padding: '7px 10px' }}
             aria-label="Search plugins" />
            <button type="button"
              onClick={addCommunityPlugin}
              disabled={adding}
              style={{ background: '#EC4899', border: 'none', color: 'white', borderRadius: '6px', padding: '7px 14px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}
            >
              {adding ? <RefreshCw size={12} className="spin" /> : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* ── PLUGIN CARDS ─────────────────────────────────────────── */}
      {plugins.map(plugin => {
        const badge = statusBadge(plugin.status, plugin.enabled);
        const isExpanded = expandedId === plugin.id;
        const isConfiguring = configuringId === plugin.id;

        return (
          <div
            key={plugin.id}
            style={{
              background: plugin.enabled ? `${plugin.iconColor}04` : 'rgba(255,255,255,0.01)',
              border: `1px solid ${plugin.enabled ? `${plugin.iconColor}20` : 'var(--border-subtle)'}`,
              borderRadius: '10px',
              overflow: 'hidden',
              transition: 'background ease 0.2s, color ease 0.2s, border-color ease 0.2s, transform ease 0.2s, opacity ease 0.2s, box-shadow ease 0.2s',
            }}
          >
            {/* Plugin header row */}
            <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              {/* Icon */}
              <div style={{
                width: 38, height: 38, borderRadius: '8px',
                background: `${plugin.iconColor}15`,
                border: `1px solid ${plugin.iconColor}25`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: plugin.enabled ? plugin.iconColor : 'var(--text-tertiary)',
                flexShrink: 0, transition: 'background ease 0.2s, color ease 0.2s, border-color ease 0.2s, transform ease 0.2s, opacity ease 0.2s, box-shadow ease 0.2s',
              }}>
                {plugin.icon}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row-flex-gap-6">
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>{plugin.name}</span>
                  {plugin.premium && (
                    <span style={{ background: 'linear-gradient(135deg, #F59E0B, #EF4444)', color: 'white', fontSize: '0.75rem', fontWeight: 800, padding: '1px 5px', borderRadius: '3px', textTransform: 'uppercase' }}>PRO</span>
                  )}
                  {plugin.source === 'community' && (
                    <span style={{ background: 'rgba(236,72,153,0.1)', color: '#EC4899', fontSize: '0.75rem', fontWeight: 700, padding: '1px 5px', borderRadius: '3px', border: '1px solid rgba(236,72,153,0.2)' }}>COMMUNITY</span>
                  )}
                  <span style={{ background: badge.bg, color: badge.color, fontSize: '0.75rem', fontWeight: 700, padding: '2px 6px', borderRadius: '4px' }}>{badge.label}</span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', lineHeight: 1.3 }}>{plugin.description}</div>
              </div>

              {/* Controls */}
              <div className="row-flex-gap-6">
                <button type="button"
                  onClick={() => setExpandedId(isExpanded ? null : plugin.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex' }}
                >
                  {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                <button type="button"
                  onClick={() => togglePlugin(plugin.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: plugin.enabled ? plugin.iconColor : 'var(--text-tertiary)', display: 'flex', transition: 'color 0.2s' }}
                >
                  {plugin.enabled ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
                </button>
              </div>
            </div>

            {/* Expanded details */}
            {isExpanded && (
              <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)' }} />

                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>{plugin.longDescription}</p>

                {/* Skills */}
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '5px' }}>Capabilities</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {plugin.skills.map((s) => (
                      <span key={s} style={{ background: `${plugin.iconColor}08`, border: `1px solid ${plugin.iconColor}20`, color: plugin.iconColor, padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600, fontFamily: s.startsWith('/') ? 'monospace' : 'inherit' }}>{s}</span>
                    ))}
                  </div>
                </div>

                {/* Config form */}
                {plugin.configurable && plugin.config && (
                  <div>
                    {!isConfiguring ? (
                      <button type="button"
                        onClick={() => {
                          setConfiguringId(plugin.id);
                          const vals: Record<string, string> = {};
                          Object.keys(plugin.config!).forEach(k => {
                            vals[k] = localStorage.getItem(`plugin_config_${plugin.id}_${k}`) || '';
                          });
                          setConfigValues(vals);
                        }}
                        style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '6px 10px', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.75rem' }}
                      >
                        <Settings size={12} /> Configure
                      </button>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                        {Object.entries(plugin.config).map(([k, def]) => (
                          <div key={k}>
                            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: '3px' }}>{def.label}</div>
                            <input
                              type={def.type || 'text'}
                              value={configValues[k] || ''}
                              onChange={e => setConfigValues(prev => ({ ...prev, [k]: e.target.value }))}
                              placeholder={def.placeholder}
                              className="input-field"
                              style={{ fontSize: '0.77rem', padding: '6px 10px', width: '100%', boxSizing: 'border-box' }}
                             aria-label="Search skill" />
                          </div>
                        ))}
                        <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
                          <button type="button" onClick={() => saveConfig(plugin.id)} style={{ background: plugin.iconColor, border: 'none', color: 'white', borderRadius: '5px', padding: '6px 12px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}>Save</button>
                          <button type="button" onClick={() => setConfiguringId(null)} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)', borderRadius: '5px', padding: '6px 10px', fontSize: '0.75rem', cursor: 'pointer' }}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Docs link */}
                <a href={plugin.link} target="_blank" rel="noreferrer" className="row-flex-gap-4">
                  <ExternalLink size={11} /> View on GitHub
                </a>
              </div>
            )}
          </div>
        );
      })}

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default PluginPanel;
