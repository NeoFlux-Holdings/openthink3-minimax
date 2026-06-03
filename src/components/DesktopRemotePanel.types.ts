import type React from 'react';

export interface LocalService {
  id: string;
  name: string;
  subdomain: string;
  localPort: number;
  active: boolean;
  type: 'Codex' | 'Claude MCP' | 'Ollama' | 'Custom';
}

export type AgentStatus = 'checking' | 'live' | 'offline';

let _agentStatus: AgentStatus = 'checking';
const _agentListeners = new Set<() => void>();
export const setAgentStatus = (s: AgentStatus) => {
  if (_agentStatus === s) return;
  _agentStatus = s;
  _agentListeners.forEach(l => l());
};
export const subscribeAgent = (cb: () => void) => {
  _agentListeners.add(cb);
  if (_agentListeners.size === 1) {
    fetch('http://127.0.0.1:8787')
      .then(r => setAgentStatus(r.ok ? 'live' : 'offline'))
      .catch(() => setAgentStatus('offline'));
  }
  return () => { _agentListeners.delete(cb); };
};
export const getAgentStatus = (): AgentStatus => _agentStatus;
export const getAgentServerStatus = (): AgentStatus => 'offline';

export const PANEL_STYLE: React.CSSProperties = {
  background: 'rgba(255,255,255,0.02)',
  border: '1px solid var(--border-subtle)',
  borderRadius: '10px',
  padding: '16px',
};

export const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};

export const INPUT_SM: React.CSSProperties = {
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

export const TYPE_COLORS: Record<string, string> = {
  'Ollama':     '#8B5CF6',
  'Codex':      '#3B82F6',
  'Claude MCP': '#F59E0B',
  'Custom':     '#6B7280',
};

export const badge = (color: string): React.CSSProperties => ({
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

