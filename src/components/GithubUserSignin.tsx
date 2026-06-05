import React, { useEffect, useReducer, useRef } from 'react';
import {
  GitBranch as GithubIcon,
  Smartphone,
  Loader2,
  CircleCheck,
  CircleAlert,
  Copy,
  LogOut,
  ShieldCheck,
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
  flow: { kind: 'idle' } | { kind: 'device'; start: GhDeviceCodeStart; lastResult?: GhDevicePollResult };
  toast: { kind: 'ok' | 'err'; text: string } | null;
};

type Action =
  | { type: 'LOAD_START' }
  | { type: 'LOAD_SUCCESS'; status: GhUserTokenStatus }
  | { type: 'LOAD_ERROR'; error: string }
  | { type: 'SET_BUSY'; value: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'FLOW_DEVICE'; start: GhDeviceCodeStart }
  | { type: 'FLOW_DEVICE_RESULT'; result: GhDevicePollResult }
  | { type: 'FLOW_RESET' }
  | { type: 'TOAST'; toast: State['toast'] };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'LOAD_START': return { ...state, loading: true, error: null };
    case 'LOAD_SUCCESS': return { ...state, loading: false, status: action.status };
    case 'LOAD_ERROR': return { ...state, loading: false, error: action.error };
    case 'SET_BUSY': return { ...state, busy: action.value };
    case 'SET_ERROR': return { ...state, error: action.error };
    case 'FLOW_DEVICE': return { ...state, flow: { kind: 'device', start: action.start }, error: null };
    case 'FLOW_DEVICE_RESULT': {
      if (state.flow.kind !== 'device') return state;
      return { ...state, flow: { ...state.flow, lastResult: action.result } };
    }
    case 'FLOW_RESET': return { ...state, flow: { kind: 'idle' }, error: null };
    case 'TOAST': return { ...state, toast: action.toast };
    default: return state;
  }
}

const initial: State = { loading: true, status: null, error: null, busy: false, flow: { kind: 'idle' }, toast: null };

const panel: React.CSSProperties = {
  borderRadius: '12px',
  padding: '14px 16px',
  background: 'var(--surface-card, rgba(255,255,255,0.04))',
  border: '1px solid var(--border-glass, rgba(255,255,255,0.08))',
  marginBottom: '12px',
};

const GithubUserSignin: React.FC<{ onUserChange?: () => void }> = ({ onUserChange }) => {
  const [state, dispatch] = useReducer(reducer, initial);
  const mountedRef = useRef(true);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (state.flow.kind !== 'device') return;
    if (state.flow.lastResult && (state.flow.lastResult as any).ok === true) return;
    if (state.flow.lastResult && (state.flow.lastResult as any).status && (state.flow.lastResult as any).status !== 'pending' && (state.flow.lastResult as any).status !== 'slow_down') {
      return;
    }
    const interval = state.flow.lastResult && (state.flow.lastResult as any).status === 'slow_down' && (state.flow.lastResult as any).interval
      ? (state.flow.lastResult as any).interval as number
      : state.flow.start.interval;
    pollTimerRef.current = setTimeout(() => { void poll(); }, Math.max(2, interval) * 1000);
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.flow]);

  async function poll() {
    try {
      const result = await pollDeviceToken();
      if (!mountedRef.current) return;
      dispatch({ type: 'FLOW_DEVICE_RESULT', result });
      if ((result as any).ok) {
        const status = await getUserTokenStatus();
        if (mountedRef.current) {
          dispatch({ type: 'LOAD_SUCCESS', status });
          const login = (result as any).user?.login;
          dispatch({ type: 'TOAST', toast: { kind: 'ok', text: login ? `Signed in as ${login}` : 'GitHub user authorized' } });
          setTimeout(() => dispatch({ type: 'TOAST', toast: null }), 4000);
          onUserChange?.();
        }
        setTimeout(() => dispatch({ type: 'FLOW_RESET' }), 1500);
      }
    } catch (e: any) {
      if (!mountedRef.current) return;
      dispatch({ type: 'FLOW_DEVICE_RESULT', result: { ok: false, status: 'error', error: e?.message || String(e) } });
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
      dispatch({ type: 'FLOW_DEVICE', start });
    } catch (e: any) {
      dispatch({ type: 'SET_ERROR', error: e?.message || String(e) });
    } finally {
      dispatch({ type: 'SET_BUSY', value: false });
    }
  }

  async function handleCancelDevice() {
    dispatch({ type: 'SET_BUSY', value: true });
    try {
      await cancelDeviceFlow();
    } catch { /* ignore */ }
    dispatch({ type: 'FLOW_RESET' });
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
      dispatch({ type: 'TOAST', toast: { kind: 'ok', text: 'Copied' } });
      setTimeout(() => dispatch({ type: 'TOAST', toast: null }), 1500);
    } catch { /* ignore */ }
  }

  const signedIn = state.status?.signedIn;
  const user = state.status?.user;

  return (
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
          <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', margin: '0 0 10px', lineHeight: 1.4 }}>
            Sign in to GitHub so the agent can open PRs, post comments, and read your repos.
          </p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={handleWebSignIn} disabled={state.busy} style={{ fontSize: '0.8rem', padding: '8px 12px' }}>
              <GithubIcon size={14} /> Sign in with GitHub
            </button>
            <button type="button" className="btn btn-ghost" onClick={handleStartDevice} disabled={state.busy} style={{ fontSize: '0.8rem', padding: '8px 12px' }}>
              <Smartphone size={14} /> Use device code
            </button>
          </div>
        </div>
      )}

      {state.flow.kind === 'device' && (
        <div style={{ marginTop: '12px', padding: '12px', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '10px' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-primary)' }}>
            Device Flow
          </div>
          <ol style={{ margin: 0, padding: '0 0 0 18px', fontSize: '0.78rem', color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
            <li>Open <a href={state.flow.start.verificationUri} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)' }}>{state.flow.start.verificationUri}</a></li>
            <li>Enter this code:{' '}
              <code style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: '4px', fontFamily: 'var(--font-mono, monospace)', fontSize: '0.85rem', letterSpacing: '0.1em' }}>
                {state.flow.start.userCode}
              </code>
              <button type="button" onClick={() => copyToClipboard(state.flow.kind === 'device' ? state.flow.start.userCode : '')} className="btn btn-ghost" style={{ padding: '2px 6px', marginLeft: '6px', fontSize: '0.7rem' }} aria-label="Copy user code">
                <Copy size={10} />
              </button>
            </li>
            <li>Waiting for you to authorize…</li>
          </ol>
          {state.flow.lastResult && (state.flow.lastResult as any).status === 'pending' && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Loader2 size={12} className="spin" /> Polling every {state.flow.start.interval}s
            </div>
          )}
          {state.flow.lastResult && (state.flow.lastResult as any).status === 'slow_down' && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '6px' }}>
              GitHub asked us to slow down. Polling every {((state.flow.lastResult as any).interval || state.flow.start.interval + 5)}s.
            </div>
          )}
          {state.flow.lastResult && ((state.flow.lastResult as any).status === 'expired' || (state.flow.lastResult as any).status === 'denied' || (state.flow.lastResult as any).status === 'error') && (
            <div style={{ fontSize: '0.75rem', color: '#EF4444', marginTop: '6px' }}>
              {(state.flow.lastResult as any).error || (state.flow.lastResult as any).status}
            </div>
          )}
          <button type="button" className="btn btn-ghost" onClick={handleCancelDevice} style={{ marginTop: '8px', fontSize: '0.75rem', padding: '4px 10px' }}>
            Cancel
          </button>
        </div>
      )}

      {state.error && (
        <div style={{ fontSize: '0.75rem', color: '#EF4444', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <CircleAlert size={12} /> {state.error}
        </div>
      )}
      {state.toast && (
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
  );
};

export default GithubUserSignin;
