import React, { useEffect, useReducer, useRef } from 'react';
import QRCode from 'qrcode';
import {
  Smartphone,
  Loader2,
  CircleCheck,
  CircleAlert,
  Copy,
  LogOut,
  ShieldCheck,
  ExternalLink,
  X,
  GitBranch as GithubIcon,
  KeyRound,
} from 'lucide-react';
import {
  getUserTokenStatus,
  beginDeviceFlow,
  pollDeviceToken,
  cancelDeviceFlow,
  revokeUserToken,
  buildAuthorizeUrl,
  randomState,
  type GhUserTokenStatus,
  type GhDeviceCodeStart,
  type GhDevicePollResult,
} from '../lib/githubApp';

type State = {
  loading: boolean;
  status: GhUserTokenStatus | null;
  error: string | null;
  busy: boolean;
  modal: null | { start: GhDeviceCodeStart; qrDataUrl: string; lastResult?: GhDevicePollResult };
  toast: { kind: 'ok' | 'err'; text: string } | null;
};

type Action =
  | { type: 'LOAD_START' }
  | { type: 'LOAD_SUCCESS'; status: GhUserTokenStatus }
  | { type: 'LOAD_ERROR'; error: string }
  | { type: 'SET_BUSY'; value: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'OPEN_MODAL'; start: GhDeviceCodeStart; qrDataUrl: string }
  | { type: 'MODAL_RESULT'; result: GhDevicePollResult }
  | { type: 'CLOSE_MODAL' }
  | { type: 'TOAST'; toast: State['toast'] };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'LOAD_START': return { ...state, loading: true, error: null };
    case 'LOAD_SUCCESS': return { ...state, loading: false, status: action.status };
    case 'LOAD_ERROR': return { ...state, loading: false, error: action.error };
    case 'SET_BUSY': return { ...state, busy: action.value };
    case 'SET_ERROR': return { ...state, error: action.error };
    case 'OPEN_MODAL': return { ...state, modal: { start: action.start, qrDataUrl: action.qrDataUrl }, error: null, busy: false };
    case 'MODAL_RESULT': {
      if (!state.modal) return state;
      return { ...state, modal: { ...state.modal, lastResult: action.result } };
    }
    case 'CLOSE_MODAL': return { ...state, modal: null };
    case 'TOAST': return { ...state, toast: action.toast };
    default: return state;
  }
}

const initial: State = { loading: true, status: null, error: null, busy: false, modal: null, toast: null };

const panel: React.CSSProperties = {
  borderRadius: '12px',
  padding: '14px 16px',
  background: 'var(--surface-card, rgba(255,255,255,0.04))',
  border: '1px solid var(--border-glass, rgba(255,255,255,0.08))',
  marginBottom: '12px',
};

async function makeQrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 200,
    color: { dark: '#0d1117', light: '#ffffff' },
  });
}

const GithubUserSignin: React.FC<{ onUserChange?: () => void }> = ({ onUserChange }) => {
  const [state, dispatch] = useReducer(reducer, initial);
  const mountedRef = useRef(true);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const windowRef = useRef<Window | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    void (async () => {
      try {
        const status = await getUserTokenStatus();
        if (!mountedRef.current) return;
        dispatch({ type: 'LOAD_SUCCESS', status });
      } catch (e: any) {
        if (!mountedRef.current) return;
        dispatch({ type: 'LOAD_ERROR', error: e?.message || String(e) });
      }
    })();
    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!state.modal) return;
    const last = state.modal.lastResult as any;
    if (last && (last.status === 'expired' || last.status === 'denied' || last.status === 'error')) return;
    if (last && last.ok) return;
    const interval = last && last.status === 'slow_down' && last.interval
      ? last.interval
      : state.modal.start.interval;
    pollTimerRef.current = setTimeout(() => { void poll(); }, Math.max(2, interval) * 1000);
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.modal]);

  async function poll() {
    try {
      const result = await pollDeviceToken();
      if (!mountedRef.current) return;
      dispatch({ type: 'MODAL_RESULT', result });
      if ((result as any).ok) {
        if (windowRef.current && !windowRef.current.closed) {
          try { windowRef.current.close(); } catch { /* ignore */ }
        }
        const status = await getUserTokenStatus();
        if (mountedRef.current) {
          dispatch({ type: 'LOAD_SUCCESS', status });
          const login = (result as any).user?.login;
          dispatch({ type: 'TOAST', toast: { kind: 'ok', text: login ? `Signed in as ${login}` : 'GitHub user authorized' } });
          setTimeout(() => dispatch({ type: 'TOAST', toast: null }), 4000);
          onUserChange?.();
        }
        setTimeout(() => dispatch({ type: 'CLOSE_MODAL' }), 1200);
      }
    } catch (e: any) {
      if (!mountedRef.current) return;
      dispatch({ type: 'MODAL_RESULT', result: { ok: false, status: 'error', error: e?.message || String(e) } });
    }
  }

  async function handleWebSignIn() {
    dispatch({ type: 'SET_BUSY', value: true });
    try {
      const state2 = randomState();
      sessionStorage.setItem('openthink_gh_oauth_state', state2);
      const redirectUri = `${window.location.origin}/oauth/github/callback`;
      const url = buildAuthorizeUrl('Iv23licZBCvE6dJMUQ0v', redirectUri, state2, 'read:user user:email repo');
      window.location.href = url;
    } catch (e: any) {
      dispatch({ type: 'SET_ERROR', error: e?.message || String(e) });
    } finally {
      dispatch({ type: 'SET_BUSY', value: false });
    }
  }

  async function handleStartDevice() {
    dispatch({ type: 'SET_BUSY', value: true });
    try {
      const start = await beginDeviceFlow('read:user user:email repo');
      const qrDataUrl = await makeQrDataUrl(start.verificationUri);
      dispatch({ type: 'OPEN_MODAL', start, qrDataUrl });
      windowRef.current = window.open(start.verificationUri, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      dispatch({ type: 'SET_ERROR', error: e?.message || String(e) });
    } finally {
      dispatch({ type: 'SET_BUSY', value: false });
    }
  }

  async function handleCloseModal() {
    if (windowRef.current && !windowRef.current.closed) {
      try { windowRef.current.close(); } catch { /* ignore */ }
    }
    windowRef.current = null;
    dispatch({ type: 'SET_BUSY', value: true });
    try { await cancelDeviceFlow(); } catch { /* ignore */ }
    dispatch({ type: 'CLOSE_MODAL' });
    dispatch({ type: 'SET_BUSY', value: false });
  }

  async function handleRevoke() {
    if (!confirm('Sign out of GitHub? PR/issue features will stop working until you sign in again.')) return;
    dispatch({ type: 'SET_BUSY', value: true });
    try {
      await revokeUserToken();
      const status = await getUserTokenStatus();
      dispatch({ type: 'LOAD_SUCCESS', status });
      dispatch({ type: 'TOAST', toast: { kind: 'ok', text: 'Signed out' } });
      setTimeout(() => dispatch({ type: 'TOAST', toast: null }), 3000);
      onUserChange?.();
    } catch (e: any) {
      dispatch({ type: 'SET_ERROR', error: e?.message || String(e) });
    } finally {
      dispatch({ type: 'SET_BUSY', value: false });
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      dispatch({ type: 'TOAST', toast: { kind: 'ok', text: 'Code copied' } });
      setTimeout(() => dispatch({ type: 'TOAST', toast: null }), 1500);
    } catch { /* ignore */ }
  }

  const signedIn = state.status?.signedIn;
  const user = state.status?.user;

  return (
    <>
      <section style={panel} aria-label="GitHub user sign-in">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <GithubIcon size={16} color="var(--text-primary)" />
            <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>GitHub Account</h3>
          </div>
          {state.status?.configured === false && (
            <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>not configured</span>
          )}
        </div>

        {state.loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>
            <Loader2 size={14} className="spin" /> Checking…
          </div>
        ) : signedIn ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              {user?.avatar_url && (
                <img src={user.avatar_url} alt="" width={28} height={28} style={{ borderRadius: '50%' }} />
              )}
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#10B981', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <ShieldCheck size={12} /> Signed in as {user?.login ?? 'GitHub user'}
                </div>
                {state.status?.scope && (
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>scopes: {state.status.scope}</div>
                )}
              </div>
            </div>
            <button type="button" className="btn btn-ghost" onClick={handleRevoke} disabled={state.busy} style={{ fontSize: '0.75rem', padding: '6px 10px' }}>
              <LogOut size={12} /> Sign out
            </button>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', margin: '0 0 12px', lineHeight: 1.4 }}>
              Sign in to GitHub so the agent can open PRs, post comments, and read your repos.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button type="button" className="btn btn-primary" onClick={handleWebSignIn} disabled={state.busy} style={{ fontSize: '0.85rem', padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <GithubIcon size={16} /> Sign in with GitHub
              </button>
              <button type="button" className="btn btn-ghost" onClick={handleStartDevice} disabled={state.busy} style={{ fontSize: '0.8rem', padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <Smartphone size={14} /> Use a code on another device
              </button>
            </div>
          </div>
        )}

        {state.error && (
          <div style={{ fontSize: '0.75rem', color: '#EF4444', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <CircleAlert size={12} /> {state.error}
          </div>
        )}
        {state.toast && !state.modal && (
          <div
            role="status"
            style={{
              position: 'fixed', bottom: '20px', right: '20px',
              background: state.toast.kind === 'ok' ? '#10B981' : '#EF4444',
              color: 'white', padding: '8px 12px', borderRadius: '8px',
              display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', zIndex: 1000,
            }}
          >
            {state.toast.kind === 'ok' ? <CircleCheck size={14} /> : <CircleAlert size={14} />}
            {state.toast.text}
          </div>
        )}
      </section>

      {state.modal && <DeviceFlowModal state={state} onCopy={copyToClipboard} onClose={handleCloseModal} onReopen={() => { windowRef.current = window.open(state.modal!.start.verificationUri, '_blank', 'noopener,noreferrer'); }} />}
    </>
  );
};

const DeviceFlowModal: React.FC<{
  state: State;
  onCopy: (s: string) => void;
  onClose: () => void;
  onReopen: () => void;
}> = ({ state, onCopy, onClose, onReopen }) => {
  const modal = state.modal!;
  const last = modal.lastResult as any;
  const status: 'pending' | 'slow_down' | 'expired' | 'denied' | 'error' | 'ok' = last
    ? (last.ok ? 'ok' : last.status)
    : 'pending';
  const expiresAt = Date.now() + modal.start.expiresIn * 1000;
  const [secondsLeft, setSecondsLeft] = React.useState(Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)));
  useEffect(() => {
    const t = setInterval(() => {
      const left = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0 && status === 'pending') {
        // worker will reject the poll with expired_token; nothing to do here
      }
    }, 1000);
    return () => clearInterval(t);
  }, [expiresAt, status]);
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  const statusColor = status === 'ok' ? '#10B981' : status === 'expired' || status === 'denied' || status === 'error' ? '#EF4444' : 'var(--accent-primary)';
  const statusText =
    status === 'ok' ? 'Signed in — closing…' :
    status === 'expired' ? 'Code expired. Try again.' :
    status === 'denied' ? 'You denied the request.' :
    status === 'error' ? (last?.error || 'Something went wrong.') :
    status === 'slow_down' ? `Polling… (next check in ${last?.interval || modal.start.interval + 5}s)` :
    `Waiting for you to enter the code (${timeStr} left)`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="gh-device-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        className="glass-card"
        style={{
          width: '100%', maxWidth: '420px',
          padding: '24px',
          position: 'relative',
          background: 'var(--surface-elevated, rgba(20,20,30,0.92))',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute', top: '10px', right: '10px',
            background: 'transparent', border: 'none', color: 'var(--text-tertiary)',
            cursor: 'pointer', padding: '6px', borderRadius: '6px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <X size={16} />
        </button>

        <div style={{ textAlign: 'center', marginBottom: '16px' }}>
          <KeyRound size={28} color={statusColor} style={{ marginBottom: '6px' }} />
          <h2 id="gh-device-title" style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Sign in to GitHub
          </h2>
        </div>

        <div
          style={{
            fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
            fontSize: 'clamp(1.8rem, 7vw, 2.2rem)',
            fontWeight: 700,
            letterSpacing: '0.25em',
            textAlign: 'center',
            color: status === 'ok' ? '#10B981' : 'var(--text-primary)',
            background: 'rgba(255,255,255,0.04)',
            border: `1px solid ${statusColor}40`,
            borderRadius: '12px',
            padding: '18px 12px',
            marginBottom: '12px',
            userSelect: 'all',
            textShadow: status === 'ok' ? '0 0 12px #10B981' : 'none',
          }}
        >
          {modal.start.userCode}
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '16px' }}>
          <button type="button" className="btn btn-ghost" onClick={() => onCopy(modal.start.userCode)} style={{ fontSize: '0.78rem', padding: '6px 12px' }}>
            <Copy size={12} /> Copy code
          </button>
          <a
            href={modal.start.verificationUri}
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost"
            style={{ fontSize: '0.78rem', padding: '6px 12px' }}
          >
            <ExternalLink size={12} /> Open manually
          </a>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '10px', marginBottom: '12px' }}>
          <img src={modal.qrDataUrl} alt="QR code to github.com/login/device" width={88} height={88} style={{ borderRadius: '6px', flexShrink: 0 }} />
          <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
            Or scan with your phone's camera to open <strong style={{ color: 'var(--text-primary)' }}>github.com/login/device</strong> and enter the code above.
          </div>
        </div>

        <a
          href={modal.start.verificationUri}
          target="_blank"
          rel="noreferrer"
          className="btn btn-primary"
          onClick={onReopen}
          style={{ width: '100%', padding: '12px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
        >
          <ExternalLink size={16} /> Open github.com/login/device
        </a>

        <div
          role="status"
          aria-live="polite"
          style={{
            marginTop: '14px',
            fontSize: '0.8rem',
            color: statusColor,
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            minHeight: '20px',
          }}
        >
          {status === 'ok' ? <CircleCheck size={14} /> :
           status === 'expired' || status === 'denied' || status === 'error' ? <CircleAlert size={14} /> :
           <Loader2 size={14} className="spin" />}
          {statusText}
        </div>

        {(status === 'expired' || status === 'denied' || status === 'error') && (
          <button type="button" className="btn btn-primary" onClick={onClose} style={{ width: '100%', marginTop: '12px', padding: '10px' }}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
};

export default GithubUserSignin;
