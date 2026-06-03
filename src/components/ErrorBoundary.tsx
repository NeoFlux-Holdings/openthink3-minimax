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
        <div className="page-wrapper--error">
          <div className="glass-panel glass-card glass-card--accent">
            <div className="icon-badge icon-badge--48 icon-badge--error">
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
            <div className="code-log code-log--error">
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
                  className="btn btn-ghost btn-ghost-flex1"
                  onClick={this.handleCopyLog}
                  style={{ color: this.state._copyConfirmed ? '#10B981' : undefined }}
                >
                  <Copy size={12} /> {this.state._copyConfirmed ? 'Copied!' : 'Copy Crash Logs'}
                </button>
                <button type="button"
                  className="btn btn-ghost btn-ghost-flex1 btn-ghost-flex1--err"
                  onClick={this.handlePurgeCache}
                >
                  <Trash2 size={12} /> Reset Cache
                </button>
              </div>

              {this.state._showPurgeConfirm && (
                <dialog
                  open
                  aria-label="Confirm cache reset"
                  className="glass-panel confirm-dialog"
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
                </dialog>
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
