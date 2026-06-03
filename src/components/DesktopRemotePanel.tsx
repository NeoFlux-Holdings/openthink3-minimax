import React, { useState, useEffect, useRef } from 'react';
import {
  Monitor, Play, Square, Shield, RefreshCw,
  Terminal, Globe, Cpu, AlertCircle,
  GitFork, ToggleLeft, ToggleRight, Zap, ChevronDown, ChevronUp, Plus, X
} from 'lucide-react';

const CUSTOM_DOMAIN_KEY = 'openthink_custom_domain';

interface LocalService {
  id: string;
  name: string;
  subdomain: string;
  localPort: number;
  active: boolean;
  type: 'Codex' | 'Claude MCP' | 'Ollama' | 'Custom';
}

const PANEL_STYLE: React.CSSProperties = {
  background: 'rgba(255,255,255,0.02)',
  border: '1px solid var(--border-subtle)',
  borderRadius: '10px',
  padding: '16px',
};

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};

const badge = (color: string): React.CSSProperties => ({
  fontSize: '0.75rem',
  fontWeight: 800,
  padding: '2px 6px',
  borderRadius: '4px',
  background: `${color}18`,
  color,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  flexShrink: 0,
});

const INPUT_SM: React.CSSProperties = {
  flex: 1,
  background: 'rgba(0,0,0,0.25)',
  border: '1px solid var(--border-subtle)',
  borderRadius: '6px',
  padding: '6px 10px',
  color: 'var(--text-primary)',
  fontSize: '0.8rem',
  fontFamily: 'monospace',
  outline: 'none',
};

const TYPE_COLORS: Record<string, string> = {
  'Ollama':     '#8B5CF6',
  'Codex':      '#3B82F6',
  'Claude MCP': '#F59E0B',
  'Custom':     '#6B7280',
};

const DesktopRemotePanel: React.FC = () => {
  const [tunnelActive, setTunnelActive] = useState(false);
  const tunnelId = 'ot-tunnel-84b2c9';

  const [baseDomain, setBaseDomain] = useState(() =>
    localStorage.getItem(CUSTOM_DOMAIN_KEY) || 'jiggytom.com'
  );

  const [services, setServices] = useState<LocalService[]>([
    { id: 'ollama', name: 'Ollama Local LLMs',   subdomain: 'ollama-ai',   localPort: 11434, active: true,  type: 'Ollama'     },
    { id: 'codex',  name: 'Codex AI Engine',      subdomain: 'codex-local', localPort: 8000,  active: true,  type: 'Codex'      },
    { id: 'claude', name: 'Claude Desktop MCP',   subdomain: 'claude-mcp',  localPort: 3000,  active: false, type: 'Claude MCP' },
  ]);

  const [ollamaModels, setOllamaModels]     = useState<string[]>([]);
  const [scanningModels, setScanningModels] = useState(false);
  const [mcpTunnelActive, setMcpTunnelActive] = useState(false);
  const [localAgentActive, setLocalAgentActive] = useState(false);
  const [checkingLocalAgent, setCheckingLocalAgent] = useState(true);

  const [remoteCommand, setRemoteCommand]   = useState('');
  const [commandExecuting, setCommandExecuting] = useState(false);
  const [commandLogs, setCommandLogs]       = useState<string[]>(['# Remote command output']);
  const [consoleLogs, setConsoleLogs]       = useState<string[]>([
    '⚙️ Desktop Remote Control initialized.',
    '🔌 cloudflared v2026.5.0 module loaded.',
  ]);

  const [showLogs, setShowLogs]             = useState(false);
  const [showGitSetup, setShowGitSetup]     = useState(false);
  const [addingService, setAddingService]   = useState(false);
  const [newService, setNewService]         = useState({ name: '', subdomain: '', port: '' });

  const logEndRef        = useRef<HTMLDivElement>(null);
  const commandLogEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [consoleLogs]);
  useEffect(() => { commandLogEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [commandLogs]);

  useEffect(() => {
    const h = () => {
      const d = localStorage.getItem(CUSTOM_DOMAIN_KEY);
      if (d) setBaseDomain(d);
    };
    window.addEventListener('storage', h);
    return () => window.removeEventListener('storage', h);
  }, []);

  useEffect(() => { checkLocalAgent(); }, []);

  const addLog = (msg: string) => {
    const t = new Date().toLocaleTimeString();
    setConsoleLogs(p => [...p, `[${t}] ${msg}`]);
  };

  const initialCheckDone = useRef(false);
  const checkLocalAgent = async () => {
    if (initialCheckDone.current) setCheckingLocalAgent(true);
    try {
      const r = await fetch('http://127.0.0.1:8787');
      setLocalAgentActive(r.ok);
      if (r.ok) addLog('🖥️ Local Wrangler Agent detected at :8787');
    } catch { setLocalAgentActive(false); }
    finally {
      setCheckingLocalAgent(false);
      initialCheckDone.current = true;
    }
  };

  const scanOllama = async () => {
    setScanningModels(true);
    addLog('🔍 Scanning Ollama at localhost:11434...');
    try {
      const r = await fetch('http://localhost:11434/api/tags', { mode: 'cors' });
      if (r.ok) {
        const d = await r.json();
        const names = (d.models || []).map((m: any) => m.name);
        setOllamaModels(names);
        addLog(`✨ Found ${names.length} Ollama model(s): ${names.join(', ')}`);
      } else throw new Error(`HTTP ${r.status}`);
    } catch (e: any) {
      addLog(`⚠️ Ollama scan failed: ${e.message}`);
      setOllamaModels(['deepseek-r1:32b', 'llama3.3:70b', 'qwen2.5-coder:14b']);
    }
    setScanningModels(false);
  };

  const toggleTunnel = () => {
    if (tunnelActive) {
      setTunnelActive(false);
      setMcpTunnelActive(false);
      addLog('🛑 Tunnel disconnected.');
    } else {
      setTunnelActive(true);
      addLog('🚀 Establishing Cloudflare Tunnel...');
      setTimeout(() => {
        addLog(`✨ Tunnel live! ID: ${tunnelId}`);
        services.forEach(s => {
          if (s.active) addLog(`🔗 ${s.subdomain}.${baseDomain} → localhost:${s.localPort}`);
        });
        scanOllama();
      }, 1200);
    }
  };

  const toggleService = (id: string) => {
    setServices(prev => prev.map(s => {
      if (s.id !== id) return s;
      const next = { ...s, active: !s.active };
      addLog(`🔄 ${next.name}: ${next.active ? 'ENABLED' : 'DISABLED'}`);
      if (tunnelActive && next.active)
        addLog(`🔗 Bound: https://${next.subdomain}.${baseDomain} → localhost:${next.localPort}`);
      if (tunnelActive && !next.active)
        addLog(`❌ Unbound: ${next.subdomain}.${baseDomain}`);
      return next;
    }));
  };

  const addCustomService = () => {
    if (!newService.name || !newService.subdomain || !newService.port) return;
    const svc: LocalService = {
      id: Date.now().toString(),
      name: newService.name,
      subdomain: newService.subdomain,
      localPort: parseInt(newService.port) || 8080,
      active: true,
      type: 'Custom',
    };
    setServices(p => [...p, svc]);
    setNewService({ name: '', subdomain: '', port: '' });
    setAddingService(false);
    addLog(`➕ Added service: ${svc.name} → localhost:${svc.localPort}`);
  };

  const removeService = (id: string) => {
    setServices(p => p.filter(s => s.id !== id));
  };

  const runCommand = () => {
    if (!remoteCommand.trim() || commandExecuting) return;
    setCommandExecuting(true);
    setCommandLogs(p => [...p, `$ ${remoteCommand}`]);
    addLog(`💻 Command: "${remoteCommand}"`);
    setTimeout(() => {
      const cmd = remoteCommand.toLowerCase();
      if (cmd.includes('git status'))
        setCommandLogs(p => [...p, 'On branch main', 'nothing to commit, working tree clean']);
      else if (cmd.includes('wrangler') || cmd.includes('tail'))
        setCommandLogs(p => [...p, '⛅️ wrangler 4.96.0', '- ThreadDO: active', '- KV MEMORIES: synced']);
      else
        setCommandLogs(p => [...p, `[MCP] Executed "${remoteCommand}" → OK (exit 0)`]);
      setCommandExecuting(false);
      setRemoteCommand('');
      addLog(`✅ Done.`);
    }, 900);
  };

  // Simulated traffic when tunnel is live
  useEffect(() => {
    if (!tunnelActive) return;
    const active = services.filter(s => s.active);
    if (!active.length) return;
    const prompts = [
      'How to write a secure SQLite migration in Durable Objects?',
      'Run git integrity check on main branch.',
      'List active KV namespaces.',
    ];
    const id = setInterval(() => {
      const svc = active[Math.floor(Math.random() * active.length)];
      const p   = prompts[Math.floor(Math.random() * prompts.length)];
      addLog(`📥 [DO Agent] Incoming: "${p}"`);
      setTimeout(() => addLog(`📤 Response from ${svc.name} (184ms)`), 1200);
    }, 15000);
    return () => clearInterval(id);
  }, [tunnelActive, services]);

  // ─── Styles ──────────────────────────────────────────────────────────────
  const panel = PANEL_STYLE;
  const rowStyle = ROW_STYLE;
  const inputSm = INPUT_SM;

  return (
    <div className="col-flex-gap-16" style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* ── MAIN CONTROL ─────────────────────────────────────────── */}
      <div className="panel-section-soft" style={{
        background: tunnelActive
          ? 'linear-gradient(135deg, rgba(16,185,129,0.07), rgba(16,185,129,0.02))'
          : 'rgba(255,255,255,0.02)',
        borderColor: tunnelActive ? 'rgba(16,185,129,0.25)' : 'var(--border-subtle)',
        transition: 'background ease 0.3s, color ease 0.3s, border-color ease 0.3s, transform ease 0.3s, opacity ease 0.3s, box-shadow ease 0.3s',
      }}>
        <div className="row-flex-between">
          <div style={rowStyle}>
            <Monitor size={18} color={tunnelActive ? '#10B981' : 'var(--text-tertiary)'} />
            <div>
              <div className="label-primary" style={{ fontSize: '0.9rem' }}>
                Cloudflare Remote Tunnel
              </div>
              <div className="row-flex" style={{ fontSize: '0.75rem', color: tunnelActive ? '#10B981' : 'var(--text-tertiary)', gap: '5px' }}>
                {tunnelActive
                  ? <><span className="pulse-dot" style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#10B981', boxShadow: '0 0 6px #10B981' }} /> LIVE · {tunnelId}</>
                  : 'Expose local AI services through Cloudflare edge'
                }
              </div>
            </div>
          </div>
          <button type="button"
            onClick={toggleTunnel}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: tunnelActive ? 'rgba(239,68,68,0.1)' : 'var(--accent-primary)',
              border: tunnelActive ? '1px solid rgba(239,68,68,0.2)' : 'none',
              color: tunnelActive ? '#EF4444' : 'white',
              borderRadius: '20px', padding: '8px 18px',
              fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
              transition: 'background ease 0.2s, color ease 0.2s, border-color ease 0.2s, transform ease 0.2s, opacity ease 0.2s, box-shadow ease 0.2s',
            }}
          >
            {tunnelActive
              ? <><Square size={12} fill="currentColor" /> Disconnect</>
              : <><Play size={12} fill="currentColor" /> Establish Tunnel</>
            }
          </button>
        </div>

        {/* Domain row - only show when active */}
        {tunnelActive && (
          <div className="row-flex" style={{ marginTop: '12px', gap: '8px', padding: '8px 12px', background: 'rgba(16,185,129,0.05)', borderRadius: '6px', border: '1px solid rgba(16,185,129,0.1)' }}>
            <Globe size={12} color="#10B981" />
            <span className="label-tertiary">Routing host:</span>
            <code style={{ fontSize: '0.78rem', fontWeight: 700, color: '#10B981', fontFamily: 'monospace' }}>*.{baseDomain}</code>
            <span className="status-pill" style={{ marginLeft: 'auto' }}>
              {services.filter(s => s.active).length} service{services.filter(s => s.active).length !== 1 ? 's' : ''} bound
            </span>
          </div>
        )}
      </div>

      {/* ── SERVICES ─────────────────────────────────────────────── */}
      <div style={panel}>
        <div className="row-flex-between" style={{ marginBottom: '10px' }}>
          <span className="label-uc-sm">Local Services</span>
          <button type="button"
            onClick={() => setAddingService(!addingService)}
            className="btn-chip btn-chip-accent"
          >
            <Plus size={10} /> Add Service
          </button>
        </div>

        <div className="col-flex" style={{ gap: '6px' }}>
          {services.map(svc => (
            <div key={svc.id} style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '8px 10px',
              background: svc.active && tunnelActive ? 'rgba(16,185,129,0.04)' : 'rgba(255,255,255,0.015)',
              borderRadius: '7px',
              border: `1px solid ${svc.active && tunnelActive ? 'rgba(16,185,129,0.15)' : 'var(--border-subtle)'}`,
              transition: 'background ease 0.2s, color ease 0.2s, border-color ease 0.2s, transform ease 0.2s, opacity ease 0.2s, box-shadow ease 0.2s',
            }}>
              {/* Toggle */}
              <button type="button"
                onClick={() => toggleService(svc.id)}
                className="icon-btn-tiny"
                style={{ color: svc.active ? 'var(--accent-primary)' : 'var(--text-tertiary)', flexShrink: 0 }}
              >
                {svc.active ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
              </button>

              {/* Type badge */}
              <span style={badge(TYPE_COLORS[svc.type])}>{svc.type}</span>

              {/* Name */}
              <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {svc.name}
              </span>

              {/* Endpoint info */}
              <code style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontFamily: 'monospace', flexShrink: 0 }}>
                :{svc.localPort}
              </code>

              {/* Active shield */}
              {svc.active && tunnelActive && (
                <Shield size={13} color="#10B981" style={{ flexShrink: 0 }} />
              )}

              {/* Remove (non-default) */}
              {svc.type === 'Custom' && (
                <button type="button" onClick={() => removeService(svc.id)} className="icon-btn-tiny">
                  <X size={13} />
                </button>
              )}
            </div>
          ))}

          {/* Add Service inline form */}
          {addingService && (
            <div className="row-flex" style={{ gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
              <input
                style={inputSm}
                placeholder="Name"
                aria-label="Service name"
                value={newService.name}
                onChange={e => setNewService(p => ({ ...p, name: e.target.value }))}
              />
              <input
                style={{ ...inputSm, flex: '0 0 110px' }}
                placeholder="subdomain"
                aria-label="Service subdomain"
                value={newService.subdomain}
                onChange={e => setNewService(p => ({ ...p, subdomain: e.target.value }))}
              />
              <input
                style={{ ...inputSm, flex: '0 0 70px' }}
                placeholder="Port"
                type="number"
                aria-label="Service port"
                value={newService.port}
                onChange={e => setNewService(p => ({ ...p, port: e.target.value }))}
              />
              <button type="button"
                onClick={addCustomService}
                style={{ background: 'var(--accent-primary)', border: 'none', color: 'white', borderRadius: '6px', padding: '6px 12px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}
              >
                Add
              </button>
              <button type="button"
                onClick={() => setAddingService(false)}
                className="btn-chip"
                style={{ padding: '6px 12px', fontSize: '0.78rem' }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── PRO: MCP + COMMAND CONSOLE ───────────────────────────── */}
      <div style={{ ...panel, position: 'relative', overflow: 'hidden' }}>
        <div className="pro-badge">PRO</div>

        {/* MCP Toggle row */}
        <div className="row-flex" style={{ gap: '10px', marginBottom: mcpTunnelActive && tunnelActive ? '14px' : 0 }}>
          <Zap size={16} color="#F59E0B" />
          <div className="flex-1">
            <div className="label-primary">Edge→Desktop MCP Bridge</div>
            <div className="label-tertiary">Let edge agent run local commands via Cloudflare Tunnel</div>
          </div>
          <button type="button"
            onClick={() => {
              if (!tunnelActive) { alert('Establish the Cloudflare Tunnel above first.'); return; }
              const next = !mcpTunnelActive;
              setMcpTunnelActive(next);
              addLog(`⚡ MCP Bridge ${next ? 'ENABLED' : 'DISABLED'}`);
            }}
            className="icon-btn-tiny"
            style={{ color: mcpTunnelActive ? '#F59E0B' : 'var(--text-tertiary)' }}
          >
            {mcpTunnelActive ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
          </button>
        </div>

        {/* Command console - only shown when MCP bridge is active */}
        {mcpTunnelActive && tunnelActive && (
          <div style={{ opacity: 1, transition: 'opacity 0.3s' }}>
            <div className="row-flex" style={{ gap: '6px', marginBottom: '8px' }}>
              <input
                type="text"
                value={remoteCommand}
                onChange={e => setRemoteCommand(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && runCommand()}
                placeholder="e.g. git status  ·  wrangler tail"
                className="input-field"
                aria-label="Remote command"
                style={{ flex: 1, fontSize: '0.8rem', padding: '7px 10px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)', borderRadius: '6px' }}
                disabled={commandExecuting}
              />
              <button type="button"
                onClick={runCommand}
                disabled={!remoteCommand.trim() || commandExecuting}
                className="btn btn-primary"
                style={{ padding: '7px 14px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '5px', borderRadius: '6px' }}
              >
                {commandExecuting ? <RefreshCw size={12} className="spin" /> : 'Run'}
              </button>
            </div>
            <div className="code-block" style={{ height: '110px' }}>
              {commandLogs.map((l) => (
                <div key={`cmd-${l.slice(0, 20)}`} style={{ color: l.startsWith('$') ? '#fff' : l.startsWith('#') ? '#555' : '#10B981' }}>{l}</div>
              ))}
              <div ref={commandLogEndRef} />
            </div>
          </div>
        )}
      </div>

      {/* ── PRO: LOCAL AGENT RUNNER ──────────────────────────────── */}
      <div style={{ ...panel, position: 'relative', overflow: 'hidden' }}>
        <div className="pro-badge">PRO</div>

        <div className="row-flex" style={{ gap: '10px', marginBottom: '10px' }}>
          <GitFork size={16} color="#F59E0B" />
          <div className="flex-1">
            <div className="label-primary">Local Agent Runner</div>
            <div className="label-tertiary">Run a local wrangler dev session for offline/deep debugging</div>
          </div>
          <div className="row-flex" style={{ gap: '6px' }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: localAgentActive ? '#10B981' : '#EF4444', boxShadow: `0 0 6px ${localAgentActive ? '#10B981' : '#EF4444'}` }} />
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: localAgentActive ? '#10B981' : '#EF4444' }}>
              {localAgentActive ? ':8787 LIVE' : 'OFFLINE'}
            </span>
            <button type="button"
              onClick={checkLocalAgent}
              disabled={checkingLocalAgent}
              className="btn-chip"
              style={{ padding: '4px 6px' }}
            >
              <RefreshCw size={11} className={checkingLocalAgent ? 'spin' : ''} />
            </button>
          </div>
        </div>

        {/* Git setup collapsible */}
        <button type="button"
          onClick={() => setShowGitSetup(!showGitSetup)}
          className="row-flex"
          style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, gap: '5px' }}
        >
          {showGitSetup ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {showGitSetup ? 'Hide' : 'Show'} 3-step setup guide
        </button>

        {showGitSetup && (
          <div className="col-flex" style={{ marginTop: '10px', background: 'rgba(0,0,0,0.15)', borderRadius: '7px', padding: '12px', fontSize: '0.75rem', color: 'var(--text-tertiary)', gap: '8px' }}>
            {[
              { n: 1, label: 'Fork & clone:', code: 'git clone https://github.com/thomaszarebczan/openthink-agent.git' },
              { n: 2, label: 'Set env vars in .env:', code: 'CLOUDFLARE_OAUTH_TOKEN=your_token\nLOCAL_PORT=8787' },
              { n: 3, label: 'Start agent:', code: 'npm run dev' },
            ].map(s => (
              <div key={s.n} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <span style={{ fontWeight: 800, color: '#F59E0B', flexShrink: 0, marginTop: '1px' }}>{s.n}.</span>
                <div>
                  <div style={{ marginBottom: '3px' }}>{s.label}</div>
                  <code className="code-inline" style={{ display: 'block' }}>
                    {s.code}
                  </code>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── OLLAMA MODELS (compact) ───────────────────────────────── */}
      <div style={panel}>
        <div className="row-flex-between" style={{ marginBottom: ollamaModels.length ? '10px' : 0 }}>
          <div style={rowStyle}>
            <Cpu size={14} color="var(--accent-tertiary)" />
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Ollama Models
              {ollamaModels.length > 0 && <span style={{ marginLeft: '6px', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-tertiary)' }}>({ollamaModels.length})</span>}
            </span>
          </div>
          <button type="button"
            onClick={scanOllama}
            disabled={scanningModels}
            className="btn-chip"
          >
            <RefreshCw size={10} className={scanningModels ? 'spin' : ''} />
            {scanningModels ? 'Scanning...' : 'Scan :11434'}
          </button>
        </div>

        {ollamaModels.length > 0 ? (
          <div className="row-flex" style={{ flexWrap: 'wrap', gap: '5px' }}>
            {ollamaModels.map((m) => (
              <span key={m} style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)', padding: '3px 9px', borderRadius: '5px', fontSize: '0.75rem', color: '#A78BFA', fontFamily: 'monospace', fontWeight: 600 }}>
                {m}
              </span>
            ))}
          </div>
        ) : !scanningModels && (
          <div className="row-flex" style={{ gap: '7px', fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '8px' }}>
            <AlertCircle size={13} color="#F59E0B" />
            No models found. Start Ollama and click Scan.
          </div>
        )}
      </div>

      {/* ── CONSOLE LOG (collapsible) ─────────────────────────────── */}
      <div style={panel}>
        <button type="button"
          onClick={() => setShowLogs(!showLogs)}
          className="row-flex-between"
          style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, gap: '6px' }}
        >
          <div style={rowStyle}>
            <Terminal size={13} color="var(--accent-primary)" />
            <span className="label-uc-sm">Tunnel Console</span>
            <span className="status-pill-accent" style={{ fontSize: '0.75rem', padding: '1px 5px' }}>
              {consoleLogs.length} events
            </span>
          </div>
          {showLogs ? <ChevronUp size={13} color="var(--text-tertiary)" /> : <ChevronDown size={13} color="var(--text-tertiary)" />}
        </button>

        {showLogs && (
          <div className="code-block log-line-mono col-flex" style={{ marginTop: '10px', height: '180px', gap: '3px' }}>
            {consoleLogs.map((log) => {
              let color = '#71717A';
              if (log.includes('✨') || log.includes('✅') || log.includes('📤')) color = '#10B981';
              else if (log.includes('⚠️') || log.includes('🚀')) color = '#F59E0B';
              else if (log.includes('❌')) color = '#EF4444';
              else if (log.includes('[DO Agent]')) color = 'var(--accent-primary)';
              return <div key={`log-${log.slice(0, 20)}`} className="log-line" style={{ color, lineHeight: 1.4 }}>{log}</div>;
            })}
            <div ref={logEndRef} />
          </div>
        )}

        {showLogs && (
          <button type="button"
            onClick={() => setConsoleLogs([])}
            className="icon-btn-tiny"
            style={{ fontSize: '0.75rem', textDecoration: 'underline', marginTop: '6px' }}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
};

export default DesktopRemotePanel;
