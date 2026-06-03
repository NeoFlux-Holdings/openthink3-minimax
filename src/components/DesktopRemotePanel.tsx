import React, { useReducer, useEffect, useSyncExternalStore } from 'react';
import { Cpu, AlertCircle, RefreshCw } from 'lucide-react';
import {
  TunnelControl, ServiceList, McpBridge, LocalAgentRunner, ConsoleLog,
} from './DesktopRemotePanelParts';
import {
  type LocalService,
  PANEL_STYLE, ROW_STYLE,
  subscribeAgent, getAgentStatus, getAgentServerStatus, setAgentStatus,
} from './DesktopRemotePanel.types';

const CUSTOM_DOMAIN_KEY = 'openthink_custom_domain';

type State = {
  tunnelActive: boolean;
  baseDomain: string;
  services: LocalService[];
  ollamaModels: string[];
  scanningModels: boolean;
  consoleLogs: string[];
};

type Action =
  | { type: 'SET_TUNNEL_ACTIVE'; value: boolean }
  | { type: 'SET_OLLAMA_MODELS'; value: string[] }
  | { type: 'SET_SCANNING_MODELS'; value: boolean }
  | { type: 'SET_SERVICES'; value: LocalService[] | ((prev: LocalService[]) => LocalService[]) }
  | { type: 'SET_CONSOLE_LOGS'; value: string[] | ((prev: string[]) => string[]) };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_TUNNEL_ACTIVE':
      return { ...state, tunnelActive: action.value };
    case 'SET_OLLAMA_MODELS':
      return { ...state, ollamaModels: action.value };
    case 'SET_SCANNING_MODELS':
      return { ...state, scanningModels: action.value };
    case 'SET_SERVICES':
      return {
        ...state,
        services: typeof action.value === 'function'
          ? action.value(state.services)
          : action.value,
      };
    case 'SET_CONSOLE_LOGS':
      return {
        ...state,
        consoleLogs: typeof action.value === 'function'
          ? action.value(state.consoleLogs)
          : action.value,
      };
  }
}

const INITIAL_SERVICES: LocalService[] = [
  { id: 'ollama', name: 'Ollama Local LLMs',   subdomain: 'ollama-ai',   localPort: 11434, active: true,  type: 'Ollama'     },
  { id: 'codex',  name: 'Codex AI Engine',      subdomain: 'codex-local', localPort: 8000,  active: true,  type: 'Codex'      },
  { id: 'claude', name: 'Claude Desktop MCP',   subdomain: 'claude-mcp',  localPort: 3000,  active: false, type: 'Claude MCP' },
];

const INITIAL_LOGS: string[] = [
  '⚙️ Desktop Remote Control initialized.',
  '🔌 cloudflared v2026.5.0 module loaded.',
];

const DesktopRemotePanel: React.FC = () => {
  const tunnelId = 'ot-tunnel-84b2c9';
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    tunnelActive: false,
    baseDomain: localStorage.getItem(CUSTOM_DOMAIN_KEY) || 'jiggytom.com',
    services: INITIAL_SERVICES,
    ollamaModels: [] as string[],
    scanningModels: false,
    consoleLogs: INITIAL_LOGS,
  }));
  const { tunnelActive, baseDomain, services, ollamaModels, scanningModels, consoleLogs } = state;
  const setTunnelActive    = (value: boolean) => dispatch({ type: 'SET_TUNNEL_ACTIVE', value });
  const setOllamaModels    = (value: string[]) => dispatch({ type: 'SET_OLLAMA_MODELS', value });
  const setScanningModels  = (value: boolean) => dispatch({ type: 'SET_SCANNING_MODELS', value });
  const setServices        = (value: LocalService[] | ((prev: LocalService[]) => LocalService[])) => dispatch({ type: 'SET_SERVICES', value });
  const setConsoleLogs     = (value: string[] | ((prev: string[]) => string[])) => dispatch({ type: 'SET_CONSOLE_LOGS', value });
  const agentStatusValue = useSyncExternalStore(subscribeAgent, getAgentStatus, getAgentServerStatus);

  const addLog = (msg: string) => {
    const t = new Date().toLocaleTimeString();
    setConsoleLogs(p => [...p, `[${t}] ${msg}`]);
  };

  const checkLocalAgent = () => {
    setAgentStatus('checking');
    fetch('http://127.0.0.1:8787')
      .then(r => {
        if (r.ok) {
          setAgentStatus('live');
          addLog('🖥️ Local Wrangler Agent detected at :8787');
        } else {
          setAgentStatus('offline');
        }
      })
      .catch(() => setAgentStatus('offline'));
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

  const removeService = (id: string) => setServices(p => p.filter(s => s.id !== id));
  const addService    = (svc: LocalService) => setServices(p => [...p, svc]);

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

  const activeServiceCount = services.filter(s => s.active).length;

  return (
    <div className="col-flex-gap-16" style={{ fontFamily: "'Inter', sans-serif" }}>
      <TunnelControl
        tunnelActive={tunnelActive}
        tunnelId={tunnelId}
        baseDomain={baseDomain}
        activeServiceCount={activeServiceCount}
        onToggle={toggleTunnel}
      />
      <ServiceList
        services={services}
        tunnelActive={tunnelActive}
        onToggle={toggleService}
        onRemove={removeService}
        onAdd={addService}
        onLog={addLog}
      />
      <McpBridge tunnelActive={tunnelActive} onLog={addLog} />
      <LocalAgentRunner agentStatusValue={agentStatusValue} onCheckAgent={checkLocalAgent} />

      <div style={PANEL_STYLE}>
        <div className="row-flex-between" style={{ marginBottom: ollamaModels.length ? '10px' : 0 }}>
          <div style={ROW_STYLE}>
            <Cpu size={14} color="var(--accent-tertiary)" />
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Ollama Models
              {ollamaModels.length > 0 && <span style={{ marginLeft: '6px', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-tertiary)' }}>({ollamaModels.length})</span>}
            </span>
          </div>
          <button type="button" onClick={scanOllama} disabled={scanningModels} className="btn-chip">
            <RefreshCw size={10} className={scanningModels ? 'spin' : ''} />
            {scanningModels ? 'Scanning...' : 'Scan :11434'}
          </button>
        </div>
        {ollamaModels.length > 0 ? (
          <div className="row-flex" style={{ flexWrap: 'wrap', gap: '5px' }}>
            {ollamaModels.map((m) => (
              <span key={m} className="pill-purple">{m}</span>
            ))}
          </div>
        ) : !scanningModels && (
          <div className="row-flex" style={{ gap: '7px', fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '8px' }}>
            <AlertCircle size={13} color="#F59E0B" />
            No models found. Start Ollama and click Scan.
          </div>
        )}
      </div>

      <ConsoleLog consoleLogs={consoleLogs} onClear={() => setConsoleLogs([])} />
    </div>
  );
};

export default DesktopRemotePanel;
