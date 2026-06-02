import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ShieldAlert, RefreshCw, Copy, Trash2 } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  _copyConfirmed?: boolean;
  _showPurgeConfirm?: boolean;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  private copyConfirmTimer: number | null = null;

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({
      error,
      errorInfo
    });
    console.error("OpenThink Error Boundary caught exception:", error, errorInfo);
  }

  public componentWillUnmount() {
    if (this.copyConfirmTimer) window.clearTimeout(this.copyConfirmTimer);
  }

  private handleCopyLog = () => {
    const log = `OpenThink Crash Log [${this.props.fallbackName || 'Generic Context'}]\nError: ${this.state.error?.message}\nStack: ${this.state.error?.stack}\nInfo: ${JSON.stringify(this.state.errorInfo)}`;
    navigator.clipboard.writeText(log).then(() => {
      this.setState({ hasError: true, error: this.state.error, errorInfo: this.state.errorInfo, _copyConfirmed: true } as State);
      if (this.copyConfirmTimer) window.clearTimeout(this.copyConfirmTimer);
      this.copyConfirmTimer = window.setTimeout(() => {
        this.setState({ _copyConfirmed: false } as unknown as State);
      }, 1800);
    }).catch(err => {
      console.warn("Clipboard write failed:", err);
    });
  };

  private handleSoftReload = () => {
    window.location.reload();
  };

  private handlePurgeCache = () => {
    this.setState({ _showPurgeConfirm: true } as unknown as State);
  };

  private cancelPurge = () => {
    this.setState({ _showPurgeConfirm: false } as unknown as State);
  };

  private confirmPurge = () => {
    localStorage.removeItem('openthink_active_thread_id');
    localStorage.removeItem('openthink_active_canvas_tab');
    localStorage.removeItem('openthink_popout_canvas');
    localStorage.removeItem('openthink_popout_pierre');
    localStorage.removeItem('openthink_popout_harness');
    localStorage.removeItem('openthink_popout_summaries');
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '24px',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)',
          fontFamily: "'Inter', sans-serif",
          textAlign: 'center'
        }}>
          <div className="glass-panel" style={{
            maxWidth: '500px',
            padding: '32px',
            borderRadius: 'var(--radius-lg)',
            background: 'rgba(36, 36, 36, 0.4)',
            border: '1.5px solid var(--accent-primary)',
            boxShadow: 'var(--shadow-lg), 0 0 24px rgba(249, 115, 22, 0.1)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '18px'
          }}>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: 'rgba(239, 68, 68, 0.1)',
              color: '#EF4444',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <ShieldAlert size={28} />
            </div>

            <div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 8px', color: 'var(--text-primary)' }}>
                Workspace Recovery HUD
              </h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                OpenThink captured a rendering exception in the panel context: <strong style={{ color: 'var(--accent-secondary)' }}>{this.props.fallbackName || 'Component Canvas'}</strong>. Unsaved prompt drafts and active thread SQLite states remain fully preserved.
              </p>
            </div>

            {/* Error Detail Stack */}
            <div style={{
              width: '100%',
              background: 'black',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              padding: '12px',
              fontFamily: 'monospace',
              fontSize: '0.75rem',
              color: '#EF4444',
              textAlign: 'left',
              overflowX: 'auto',
              maxHeight: '120px'
            }}>
              {this.state.error ? this.state.error.message : 'Unknown exception.'}
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: '10px' }}>
              <button type="button"
                className="btn btn-primary"
                onClick={this.handleSoftReload}
                style={{ width: '100%', padding: '10px', borderRadius: '6px', gap: '8px', fontSize: '0.85rem', minHeight: 44 }}
              >
                <RefreshCw size={14} /> Soft Reload Workspace
              </button>

              <div style={{ display: 'flex', width: '100%', gap: '10px' }}>
                <button type="button"
                  className="btn btn-ghost"
                  onClick={this.handleCopyLog}
                  style={{ flex: 1, padding: '10px', borderRadius: '6px', gap: '6px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)', minHeight: 44, color: this.state._copyConfirmed ? '#10B981' : undefined }}
                >
                  <Copy size={12} /> {this.state._copyConfirmed ? 'Copied!' : 'Copy Crash Logs'}
                </button>
                <button type="button"
                  className="btn btn-ghost"
                  onClick={this.handlePurgeCache}
                  style={{ flex: 1, padding: '10px', borderRadius: '6px', gap: '6px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)', color: '#EF4444', minHeight: 44 }}
                >
                  <Trash2 size={12} /> Reset Cache
                </button>
              </div>

              {this.state._showPurgeConfirm && (
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label="Confirm cache reset"
                  className="glass-panel"
                  style={{
                    width: '100%',
                    padding: '16px', borderRadius: '8px',
                    background: 'rgba(36, 36, 36, 0.6)',
                    border: '1px solid var(--accent-primary)',
                    display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'stretch',
                  }}
                >
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    Reset navigation coordinates and drafts? Your SQLite thread history is preserved on the server.
                  </p>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="button"
                      className="btn btn-ghost"
                      onClick={this.cancelPurge}
                      style={{ flex: 1, padding: '10px', borderRadius: '6px', minHeight: 44, fontSize: '0.85rem' }}
                    >
                      Cancel
                    </button>
                    <button type="button"
                      className="btn btn-primary"
                      onClick={this.confirmPurge}
                      style={{ flex: 1, padding: '10px', borderRadius: '6px', minHeight: 44, fontSize: '0.85rem', background: '#EF4444', borderColor: '#EF4444' }}
                    >
                      Confirm Reset
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
