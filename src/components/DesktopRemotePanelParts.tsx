import React, { useState, useEffect, useRef } from 'react';
import { Monitor, Play, Square, Shield, RefreshCw, Terminal, Globe, GitFork, ChevronDown, ChevronUp, Plus, X, ToggleLeft, ToggleRight, Zap } from 'lucide-react';
import type { LocalService, AgentStatus } from './DesktopRemotePanel.types';
import { PANEL_STYLE, ROW_STYLE, INPUT_SM, TYPE_COLORS, badge } from './DesktopRemotePanel.types';

export const TunnelControl: React.FC<{
  tunnelActive: boolean;
  tunnelId: string;
  baseDomain: string;
  activeServiceCount: number;
  onToggle: () => void;
}> = ({ tunnelActive, tunnelId, baseDomain, activeServiceCount, onToggle }) => (
  <div className="panel-section-soft" style={{
    background: tunnelActive
      ? 'linear-gradient(135deg, rgba(16,185,129,0.07), rgba(16,185,129,0.02))'
      : 'rgba(255,255,255,0.02)',
    borderColor: tunnelActive ? 'rgba(16,185,129,0.25)' : 'var(--border-subtle)',
    transition: 'background ease 0.3s, color ease 0.3s, border-color ease 0.3s, transform ease 0.3s, opacity ease 0.3s, box-shadow ease 0.3s',
  }}>
    <div className="row-flex-between">
      <div style={ROW_STYLE}>
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
      <button type="button" onClick={onToggle} className="row-flex-gap-6">
        {tunnelActive
          ? <><Square size={12} fill="currentColor" /> Disconnect</>
          : <><Play size={12} fill="currentColor" /> Establish Tunnel</>
        }
      </button>
    </div>
    {tunnelActive && (
      <div className="row-flex" style={{ marginTop: '12px', gap: '8px', padding: '8px 12px', background: 'rgba(16,185,129,0.05)', borderRadius: '6px', border: '1px solid rgba(16,185,129,0.1)' }}>
        <Globe size={12} color="#10B981" />
        <span className="label-tertiary">Routing host:</span>
        <code style={{ fontSize: '0.78rem', fontWeight: 700, color: '#10B981', fontFamily: 'monospace' }}>*.{baseDomain}</code>
        <span className="status-pill" style={{ marginLeft: 'auto' }}>
          {activeServiceCount} service{activeServiceCount !== 1 ? 's' : ''} bound
        </span>
      </div>
    )}
  </div>
);

export const ServiceList: React.FC<{
  services: LocalService[];
  tunnelActive: boolean;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: (svc: LocalService) => void;
  onLog: (msg: string) => void;
}> = ({ services, tunnelActive, onToggle, onRemove, onAdd, onLog }) => {
  const [addingService, setAddingService] = useState(false);
  const [newService, setNewService] = useState({ name: '', subdomain: '', port: '' });

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
    onAdd(svc);
    onLog(`➕ Added service: ${svc.name} → localhost:${svc.localPort}`);
    setNewService({ name: '', subdomain: '', port: '' });
    setAddingService(false);
  };

  return (
    <div style={PANEL_STYLE}>
      <div className="row-flex-between" style={{ marginBottom: '10px' }}>
        <span className="label-uc-sm">Local Services</span>
        <button type="button" onClick={() => setAddingService(!addingService)} className="btn-chip btn-chip-accent">
          <Plus size={10} /> Add Service
        </button>
      </div>
      <div className="col-flex" style={{ gap: '6px' }}>
        {services.map(svc => (
          <div key={svc.id} className="service-row" data-active={svc.active && tunnelActive}>
            <button type="button"
              onClick={() => onToggle(svc.id)}
              className="icon-btn-tiny"
              style={{ color: svc.active ? 'var(--accent-primary)' : 'var(--text-tertiary)', flexShrink: 0 }}
            >
              {svc.active ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
            </button>
            <span style={badge(TYPE_COLORS[svc.type])}>{svc.type}</span>
            <span className="row-icon-text--ellipsis">{svc.name}</span>
            <code style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontFamily: 'monospace', flexShrink: 0 }}>
              :{svc.localPort}
            </code>
            {svc.active && tunnelActive && <Shield size={13} color="#10B981" style={{ flexShrink: 0 }} />}
            {svc.type === 'Custom' && (
              <button type="button" onClick={() => onRemove(svc.id)} className="icon-btn-tiny">
                <X size={13} />
              </button>
            )}
          </div>
        ))}
        {addingService && (
          <div className="row-flex" style={{ gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
            <input
              style={INPUT_SM}
              placeholder="Name"
              aria-label="Service name"
              value={newService.name}
              onChange={e => setNewService(p => ({ ...p, name: e.target.value }))}
            />
            <input
              style={{ ...INPUT_SM, flex: '0 0 110px' }}
              placeholder="subdomain"
              aria-label="Service subdomain"
              value={newService.subdomain}
              onChange={e => setNewService(p => ({ ...p, subdomain: e.target.value }))}
            />
            <input
              style={{ ...INPUT_SM, flex: '0 0 70px' }}
              placeholder="Port"
              type="number"
              aria-label="Service port"
              value={newService.port}
              onChange={e => setNewService(p => ({ ...p, port: e.target.value }))}
            />
            <button type="button" onClick={addCustomService} className="btn-solid btn-solid--accent">Add</button>
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
  );
};

export const McpBridge: React.FC<{
  tunnelActive: boolean;
  onLog: (msg: string) => void;
}> = ({ tunnelActive, onLog }) => {
  const [mcpTunnelActive, setMcpTunnelActive] = useState(false);
  const prevTunnelRef = useRef(tunnelActive);
  const [remoteCommand, setRemoteCommand] = useState('');
  const [commandExecuting, setCommandExecuting] = useState(false);
  const [commandLogs, setCommandLogs] = useState<string[]>(['# Remote command output']);
  const commandLogEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { commandLogEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [commandLogs]);

  if (tunnelActive !== prevTunnelRef.current) {
    prevTunnelRef.current = tunnelActive;
    if (!tunnelActive) setMcpTunnelActive(false);
  }

  const runCommand = () => {
    if (!remoteCommand.trim() || commandExecuting) return;
    setCommandExecuting(true);
    setCommandLogs(p => [...p, `$ ${remoteCommand}`]);
    onLog(`💻 Command: "${remoteCommand}"`);
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
      onLog(`✅ Done.`);
    }, 900);
  };

  return (
    <div style={{ ...PANEL_STYLE, position: 'relative', overflow: 'hidden' }}>
      <div className="pro-badge">PRO</div>
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
            onLog(`⚡ MCP Bridge ${next ? 'ENABLED' : 'DISABLED'}`);
          }}
          className="icon-btn-tiny"
          style={{ color: mcpTunnelActive ? '#F59E0B' : 'var(--text-tertiary)' }}
        >
          {mcpTunnelActive ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
        </button>
      </div>
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
  );
};

export const LocalAgentRunner: React.FC<{
  agentStatusValue: AgentStatus;
  onCheckAgent: () => void;
}> = ({ agentStatusValue, onCheckAgent }) => {
  const [showGitSetup, setShowGitSetup] = useState(false);
  const localAgentActive: boolean | null = agentStatusValue === 'live' ? true : agentStatusValue === 'offline' ? false : null;
  const checkingLocalAgent = agentStatusValue === 'checking';

  return (
    <div style={{ ...PANEL_STYLE, position: 'relative', overflow: 'hidden' }}>
      <div className="pro-badge">PRO</div>
      <div className="row-flex" style={{ gap: '10px', marginBottom: '10px' }}>
        <GitFork size={16} color="#F59E0B" />
        <div className="flex-1">
          <div className="label-primary">Local Agent Runner</div>
          <div className="label-tertiary">Run a local wrangler dev session for offline/deep debugging</div>
        </div>
        <div className="row-flex" style={{ gap: '6px' }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: localAgentActive === true ? '#10B981' : '#EF4444', boxShadow: `0 0 6px ${localAgentActive === true ? '#10B981' : '#EF4444'}` }} />
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: localAgentActive === true ? '#10B981' : '#EF4444' }}>
            {localAgentActive === true ? ':8787 LIVE' : 'OFFLINE'}
          </span>
          <button type="button"
            onClick={onCheckAgent}
            disabled={checkingLocalAgent}
            className="btn-chip"
            style={{ padding: '4px 6px' }}
          >
            <RefreshCw size={11} className={checkingLocalAgent ? 'spin' : ''} />
          </button>
        </div>
      </div>
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
  );
};

export const ConsoleLog: React.FC<{
  consoleLogs: string[];
  onClear: () => void;
}> = ({ consoleLogs, onClear }) => {
  const [showLogs, setShowLogs] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [consoleLogs]);

  return (
    <div style={PANEL_STYLE}>
      <button type="button"
        onClick={() => setShowLogs(!showLogs)}
        className="row-flex-between"
        style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, gap: '6px' }}
      >
        <div style={ROW_STYLE}>
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
          onClick={onClear}
          className="icon-btn-tiny"
          style={{ fontSize: '0.75rem', textDecoration: 'underline', marginTop: '6px' }}
        >
          Clear
        </button>
      )}
    </div>
  );
};
