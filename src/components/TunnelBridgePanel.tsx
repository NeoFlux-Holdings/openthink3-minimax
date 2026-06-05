import React, { useEffect, useReducer, useRef } from 'react';
import { X, Save, Radio, Copy, Check, RefreshCw, Terminal, ExternalLink, Plug, Wifi } from 'lucide-react';
import {
  getBridgeStatus,
  registerTunnel,
  unregister,
  pingBridge,
  discoverBridgeTools,
  type BridgeStatus,
  type ToolCatalog,
  type PingResult,
  type ToolDescriptor,
} from '../lib/tunnelBridge';

type PanelState = {
  modalOpen: boolean;
  draftUrl: string;
  busy: boolean;
  error: string | null;
  status: BridgeStatus | null;
  ping: PingResult | null;
  tools: ToolDescriptor[];
  toolsBusy: boolean;
  toolsError: string | null;
  toolsSource: string | null;
  copied: boolean;
};

type PanelAction =
  | { type: 'OPEN_MODAL' }
  | { type: 'CLOSE_MODAL' }
  | { type: 'SET_DRAFT'; value: string }
  | { type: 'SET_BUSY'; value: boolean }
  | { type: 'SET_ERROR'; value: string | null }
  | { type: 'SET_STATUS'; value: BridgeStatus | null }
  | { type: 'SET_PING'; value: PingResult | null }
  | { type: 'SET_TOOLS'; tools: ToolDescriptor[]; source: string | null }
  | { type: 'SET_TOOLS_BUSY'; value: boolean }
  | { type: 'SET_TOOLS_ERROR'; value: string | null }
  | { type: 'SET_COPIED'; value: boolean };

const initialState: PanelState = {
  modalOpen: false,
  draftUrl: '',
  busy: false,
  error: null,
  status: null,
  ping: null,
  tools: [],
  toolsBusy: false,
  toolsError: null,
  toolsSource: null,
  copied: false,
};

function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'OPEN_MODAL':
      return { ...state, modalOpen: true, error: null };
    case 'CLOSE_MODAL':
      return { ...state, modalOpen: false, error: null };
    case 'SET_DRAFT':
      return { ...state, draftUrl: action.value };
    case 'SET_BUSY':
      return { ...state, busy: action.value };
    case 'SET_ERROR':
      return { ...state, error: action.value };
    case 'SET_STATUS':
      return { ...state, status: action.value };
    case 'SET_PING':
      return { ...state, ping: action.value };
    case 'SET_TOOLS':
      return { ...state, tools: action.tools, toolsSource: action.source, toolsError: null };
    case 'SET_TOOLS_BUSY':
      return { ...state, toolsBusy: action.value };
    case 'SET_TOOLS_ERROR':
      return { ...state, toolsError: action.value };
    case 'SET_COPIED':
      return { ...state, copied: action.value };
  }
}

const BRIDGE_INSTALL_CMD = typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent || '')
  ? 'winget install Cloudflare.cloudflared'
  : 'curl -fsSL https://pkg.cloudflare.com/cloudflared | bash';

const BRIDGE_TUNNEL_EXAMPLE = 'cloudflared tunnel --url http://localhost:3000';
const BRIDGE_SERVER_EXAMPLE = 'npx @modelcontextprotocol/server-filesystem C:\\Users\\thoma';
const BRIDGE_CLI_EXAMPLE = 'npx tsx scripts/bridge.mjs --port 3000 --server "@modelcontextprotocol/server-filesystem ."';

const Step: React.FC<{ index: number; title: string; children: React.ReactNode; accent?: string }> = ({ index, title, children, accent = 'var(--accent-primary)' }) => (
  <div className="bridge-step">
    <div className="bridge-step__head">
      <div className="bridge-step__num" style={{ background: `${accent}20`, border: `1px solid ${accent}40`, color: accent }}>
        {index}
      </div>
      <h4 className="bridge-step__title">{title}</h4>
    </div>
    <div className="bridge-step__body">{children}</div>
  </div>
);

const CodeBlock: React.FC<{ code: string; onCopy?: () => void; copied?: boolean; language?: string }> = ({ code, onCopy, copied, language = 'bash' }) => (
  <div className="bridge-code">
    <div className="bridge-code__head">
      <span className="bridge-code__lang">{language}</span>
      {onCopy && (
        <button type="button" className="bridge-code__copy" onClick={onCopy} aria-label="Copy code">
          {copied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
        </button>
      )}
    </div>
    <pre className="bridge-code__pre"><code>{code}</code></pre>
  </div>
);

const TunnelBridgeCard: React.FC<{ onOpen: () => void; status: BridgeStatus | null; ping: PingResult | null; onPing: () => void; onDisconnect: () => void; busy: boolean }> = ({ onOpen, status, ping, onPing, onDisconnect, busy }) => {
  const connected = !!status?.registered;

  return (
    <article className="bridge-card" data-connected={connected ? 'true' : 'false'}>
      <div className="bridge-card__head">
        <div
          className="icon-color-tile"
          style={{
            background: connected ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 94, 0, 0.1)',
            border: `1px solid ${connected ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255, 94, 0, 0.3)'}`,
            color: connected ? '#10B981' : 'var(--accent-primary)',
          }}
        >
          <Radio size={16} />
        </div>
        <div className="bridge-card__head-text">
          <div className="row-flex-gap-6 bridge-card__title-row">
            <h4 className="bridge-card__title">Local Agent Bridge</h4>
            <code className="bridge-card__version">v1</code>
            <span className="bridge-card__badge" data-state={connected ? 'live' : 'idle'}>
              <span className={`status-dot ${connected ? 'status-dot--live' : 'status-dot--off'}`} />
              {connected ? 'Connected' : 'Not connected'}
            </span>
          </div>
          <p className="bridge-card__desc">
            Expose a local MCP server (filesystem, shell, browser) to the deployed worker via a quick Cloudflare Tunnel.
          </p>
        </div>
      </div>

      <div className="bridge-card__status">
        {connected && status?.tunnelUrl && (
          <div className="bridge-card__url" title={status.tunnelUrl}>
            <Plug size={11} />
            <span className="label-truncate">{status.tunnelUrl}</span>
          </div>
        )}
        {ping && (
          <div className="bridge-card__latency" data-ok={ping.ok ? 'true' : 'false'}>
            <Wifi size={11} />
            <span>{ping.ok ? `${ping.latencyMs}ms` : 'unreachable'}</span>
          </div>
        )}
      </div>

      <div className="bridge-card__actions">
        {connected ? (
          <>
            <button type="button" className="btn-ghost-sm" onClick={onPing} disabled={busy} aria-label="Ping tunnel">
              <RefreshCw size={12} /> {busy ? 'Pinging…' : 'Ping'}
            </button>
            <button type="button" className="btn-ghost-sm" onClick={onOpen} aria-label="Manage bridge">
              <Terminal size={12} /> Manage
            </button>
            <button type="button" className="btn-ghost-sm bridge-card__danger" onClick={onDisconnect} disabled={busy} aria-label="Disconnect bridge">
              <X size={12} /> Disconnect
            </button>
          </>
        ) : (
          <button type="button" className="btn-solid btn-solid--accent" onClick={onOpen} aria-label="Set up bridge">
            <Radio size={12} /> Set up bridge
          </button>
        )}
      </div>
    </article>
  );
};

type SetupModalProps = {
  state: PanelState;
  dispatch: React.Dispatch<PanelAction>;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefreshTools: () => void;
};

const SetupModal: React.FC<SetupModalProps> = ({ state, dispatch, onConnect, onDisconnect, onRefreshTools }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (state.modalOpen && !el.open) el.showModal();
    if (!state.modalOpen && el.open) el.close();
  }, [state.modalOpen]);

  const isConnected = !!state.status?.registered;
  const draftTrimmed = state.draftUrl.trim();
  const draftValid = /^https:\/\/[\w-]+\.trycloudflare\.com\/?$/.test(draftTrimmed);

  const copyText = (text: string) => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    void navigator.clipboard.writeText(text);
    dispatch({ type: 'SET_COPIED', value: true });
    setTimeout(() => dispatch({ type: 'SET_COPIED', value: false }), 1200);
  };

  return (
    <dialog
      ref={dialogRef}
      className="plugin-modal bridge-modal"
      aria-label="Local Agent Bridge setup"
      onClose={() => dispatch({ type: 'CLOSE_MODAL' })}
    >
      <div className="plugin-modal__panel">
        <header className="plugin-modal__head">
          <div className="row-flex-gap-6">
            <div
              className="icon-color-tile"
              style={{
                background: isConnected ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 94, 0, 0.1)',
                border: `1px solid ${isConnected ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255, 94, 0, 0.3)'}`,
                color: isConnected ? '#10B981' : 'var(--accent-primary)',
              }}
            >
              <Radio size={16} />
            </div>
            <div>
              <h3 className="plugin-modal__title">Local Agent Bridge</h3>
              <p className="plugin-modal__sub">cloudflared · *.trycloudflare.com · 24h ttl</p>
            </div>
          </div>
          <button type="button" className="home-icon-btn" onClick={() => dispatch({ type: 'CLOSE_MODAL' })} aria-label="Close bridge setup">
            <X size={16} />
          </button>
        </header>

        <div className="plugin-modal__body bridge-modal__body">
          {!isConnected ? (
            <>
              <Step index={1} title="Install cloudflared">
                <p className="bridge-step__hint">Skip this step if <code>cloudflared</code> is already on your PATH.</p>
                <CodeBlock code={BRIDGE_INSTALL_CMD} onCopy={() => copyText(BRIDGE_INSTALL_CMD)} copied={state.copied} />
                <p className="bridge-step__hint">
                  Or grab a release binary:&nbsp;
                  <a href="https://github.com/cloudflare/cloudflared/releases" target="_blank" rel="noopener noreferrer" className="bridge-link">
                    github.com/cloudflare/cloudflared/releases <ExternalLink size={10} />
                  </a>
                </p>
              </Step>

              <Step index={2} title="Run a local MCP server">
                <p className="bridge-step__hint">Any stdio MCP server works. Example: the official filesystem server.</p>
                <CodeBlock code={BRIDGE_SERVER_EXAMPLE} onCopy={() => copyText(BRIDGE_SERVER_EXAMPLE)} copied={state.copied} />
                <p className="bridge-step__hint">Or use the bundled one-shot launcher:</p>
                <CodeBlock code={BRIDGE_CLI_EXAMPLE} onCopy={() => copyText(BRIDGE_CLI_EXAMPLE)} copied={state.copied} language="bash" />
              </Step>

              <Step index={3} title="Expose it via a quick tunnel">
                <p className="bridge-step__hint">
                  <code>cloudflared tunnel --url</code> gives you a free, no-account <code>*.trycloudflare.com</code> URL.
                </p>
                <CodeBlock code={BRIDGE_TUNNEL_EXAMPLE} onCopy={() => copyText(BRIDGE_TUNNEL_EXAMPLE)} copied={state.copied} />
              </Step>

              <Step index={4} title="Paste the trycloudflare URL and connect" accent="#10B981">
                <p className="bridge-step__hint">Look for the <code>https://…trycloudflare.com</code> line in the cloudflared stdout.</p>
                <div className="bridge-modal__connect-row">
                  <input
                    type="url"
                    className="input-field bridge-modal__url-input"
                    placeholder="https://your-tunnel-xyz.trycloudflare.com"
                    value={state.draftUrl}
                    onChange={(e) => dispatch({ type: 'SET_DRAFT', value: e.target.value })}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Tunnel URL"
                  />
                  <button
                    type="button"
                    className="btn-solid btn-solid--accent"
                    onClick={onConnect}
                    disabled={state.busy || !draftValid}
                    aria-label="Connect bridge"
                  >
                    {state.busy ? 'Connecting…' : (<><Save size={12} /> Connect</>)}
                  </button>
                </div>
                {state.error && (
                  <div className="bridge-modal__error" role="alert">{state.error}</div>
                )}
                {draftTrimmed && !draftValid && (
                  <div className="bridge-modal__error" role="alert">
                    URL must be an <code>https://*.trycloudflare.com</code> address.
                  </div>
                )}
              </Step>
            </>
          ) : (
            <>
              <div className="bridge-connected">
                <div className="bridge-connected__row">
                  <span className="bridge-connected__label">Tunnel URL</span>
                  <code className="bridge-connected__value" title={state.status?.tunnelUrl ?? ''}>
                    {state.status?.tunnelUrl}
                  </code>
                  <button type="button" className="btn-ghost-sm" onClick={() => copyText(state.status?.tunnelUrl ?? '')} aria-label="Copy tunnel URL">
                    {state.copied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
                  </button>
                </div>
                <div className="bridge-connected__row">
                  <span className="bridge-connected__label">Latency</span>
                  <span className="bridge-connected__value" data-ok={state.ping?.ok ? 'true' : 'false'}>
                    {state.ping
                      ? state.ping.ok
                        ? `${state.ping.latencyMs}ms`
                        : `unreachable${state.ping.error ? ` — ${state.ping.error}` : ''}`
                      : 'not yet pinged'}
                  </span>
                </div>
                <div className="bridge-connected__row">
                  <span className="bridge-connected__label">TTL</span>
                  <span className="bridge-connected__value">{state.status?.ttlSeconds ?? 0}s</span>
                </div>
              </div>

              <div className="bridge-tools">
                <div className="bridge-tools__head">
                  <span className="bridge-tools__title">Discovered tools</span>
                  <button type="button" className="btn-ghost-sm" onClick={onRefreshTools} disabled={state.toolsBusy} aria-label="Refresh tools">
                    <RefreshCw size={11} /> {state.toolsBusy ? 'Scanning…' : 'Refresh'}
                  </button>
                </div>
                {state.toolsError && <div className="bridge-modal__error" role="alert">{state.toolsError}</div>}
                {state.tools.length === 0 && !state.toolsBusy && !state.toolsError && (
                  <div className="bridge-tools__empty">
                    No tools discovered. Make sure your MCP server exposes <code>GET /tools</code>.
                  </div>
                )}
                {state.tools.length > 0 && (
                  <ul className="bridge-tools__list">
                    {state.tools.map((tool) => (
                      <li key={tool.name} className="bridge-tools__item">
                        <code className="bridge-tools__name">{tool.name}</code>
                        {tool.description && <span className="bridge-tools__desc">{tool.description}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {state.toolsSource && (
                  <div className="bridge-tools__source">source: <code>{state.toolsSource}</code></div>
                )}
              </div>
            </>
          )}
        </div>

        <footer className="plugin-modal__foot">
          <button type="button" className="btn-ghost-sm" onClick={() => dispatch({ type: 'CLOSE_MODAL' })}>
            Close
          </button>
          {isConnected && (
            <button type="button" className="btn-ghost-sm bridge-card__danger" onClick={onDisconnect} disabled={state.busy}>
              <X size={12} /> Disconnect
            </button>
          )}
        </footer>
      </div>
    </dialog>
  );
};

const TunnelBridgePanel: React.FC = () => {
  const [state, dispatch] = useReducer(panelReducer, initialState);

  const refreshStatus = async (): Promise<BridgeStatus> => {
    try {
      const s = await getBridgeStatus();
      dispatch({ type: 'SET_STATUS', value: s });
      if (s.registered && s.tunnelUrl) {
        dispatch({ type: 'SET_DRAFT', value: s.tunnelUrl });
      }
      return s;
    } catch (err) {
      dispatch({ type: 'SET_ERROR', value: err instanceof Error ? err.message : String(err) });
      return { registered: false, tunnelUrl: null, ttlSeconds: 0, lastPinged: null };
    }
  };

  useEffect(() => {
    void refreshStatus();
  }, []);

  const handleConnect = async () => {
    const url = state.draftUrl.trim();
    if (!url) return;
    dispatch({ type: 'SET_BUSY', value: true });
    dispatch({ type: 'SET_ERROR', value: null });
    try {
      await registerTunnel(url);
      const s = await refreshStatus();
      if (s.registered) {
        try {
          const catalog: ToolCatalog = await discoverBridgeTools();
          dispatch({ type: 'SET_TOOLS', tools: catalog.tools, source: catalog.source });
          if (!catalog.ok && catalog.error) {
            dispatch({ type: 'SET_TOOLS_ERROR', value: catalog.error });
          }
        } catch (err) {
          dispatch({ type: 'SET_TOOLS_ERROR', value: err instanceof Error ? err.message : String(err) });
        }
      }
    } catch (err) {
      dispatch({ type: 'SET_ERROR', value: err instanceof Error ? err.message : String(err) });
    } finally {
      dispatch({ type: 'SET_BUSY', value: false });
    }
  };

  const handleDisconnect = async () => {
    dispatch({ type: 'SET_BUSY', value: true });
    try {
      await unregister();
      dispatch({ type: 'SET_STATUS', value: { registered: false, tunnelUrl: null, ttlSeconds: 0, lastPinged: null } });
      dispatch({ type: 'SET_PING', value: null });
      dispatch({ type: 'SET_TOOLS', tools: [], source: null });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', value: err instanceof Error ? err.message : String(err) });
    } finally {
      dispatch({ type: 'SET_BUSY', value: false });
    }
  };

  const handlePing = async () => {
    dispatch({ type: 'SET_BUSY', value: true });
    try {
      const p = await pingBridge();
      dispatch({ type: 'SET_PING', value: p });
      void refreshStatus();
    } catch (err) {
      dispatch({ type: 'SET_PING', value: { ok: false, latencyMs: 0, error: err instanceof Error ? err.message : String(err) } });
    } finally {
      dispatch({ type: 'SET_BUSY', value: false });
    }
  };

  const handleRefreshTools = async () => {
    dispatch({ type: 'SET_TOOLS_BUSY', value: true });
    dispatch({ type: 'SET_TOOLS_ERROR', value: null });
    try {
      const catalog = await discoverBridgeTools();
      dispatch({ type: 'SET_TOOLS', tools: catalog.tools, source: catalog.source });
      if (!catalog.ok) {
        dispatch({ type: 'SET_TOOLS_ERROR', value: catalog.error ?? 'No tools found' });
      }
    } catch (err) {
      dispatch({ type: 'SET_TOOLS_ERROR', value: err instanceof Error ? err.message : String(err) });
    } finally {
      dispatch({ type: 'SET_TOOLS_BUSY', value: false });
    }
  };

  return (
    <div className="bridge-panel">
      <div className="bridge-panel__head">
        <div className="row-flex-gap-6">
          <Radio size={14} color="var(--accent-primary)" />
          <span className="bridge-panel__title">Local Agent Bridge</span>
        </div>
        <span className="status-bar__value">
          {state.status?.registered ? `${state.status.tunnelUrl}` : 'no tunnel registered'}
        </span>
      </div>
      <TunnelBridgeCard
        onOpen={() => dispatch({ type: 'OPEN_MODAL' })}
        status={state.status}
        ping={state.ping}
        onPing={handlePing}
        onDisconnect={handleDisconnect}
        busy={state.busy || state.toolsBusy}
      />
      <SetupModal
        state={state}
        dispatch={dispatch}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        onRefreshTools={handleRefreshTools}
      />
    </div>
  );
};

export default TunnelBridgePanel;
