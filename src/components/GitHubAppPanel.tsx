import React, { useCallback, useEffect, useReducer, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  GitBranch,
  GitPullRequest,
  MessageSquare,
  RefreshCw,
  ExternalLink,
  CircleCheck,
  CircleAlert,
  Upload,
  X,
} from 'lucide-react';
import {
  beginInstall,
  handleCallback,
  getInstallStatus,
  openPR,
  commentOnIssue,
  fileToBase64,
  parseFilesTextarea,
  type GhAppRepo,
  type GhAppAccount,
  type GhInstallStatus,
  type OpenPRResult,
  type CommentIssueResult,
} from '../lib/githubApp';
import GithubUserSignin from './GithubUserSignin';

type Status = GhInstallStatus | null;

type State = {
  loading: boolean;
  status: Status;
  error: string | null;
  installBusy: boolean;
  prBusy: boolean;
  prResult: OpenPRResult | null;
  issueBusy: boolean;
  issueResult: CommentIssueResult | null;
  toast: { kind: 'ok' | 'err'; text: string } | null;
  selectedRepoId: string;
  branch: string;
  title: string;
  body: string;
  filesText: string;
  issueOwner: string;
  issueRepo: string;
  issueNumber: string;
  issueBody: string;
};

type Action =
  | { type: 'LOAD_START' }
  | { type: 'LOAD_SUCCESS'; status: Status }
  | { type: 'LOAD_ERROR'; error: string }
  | { type: 'SET_INSTALL_BUSY'; value: boolean }
  | { type: 'SET_PR_BUSY'; value: boolean }
  | { type: 'SET_PR_RESULT'; value: OpenPRResult | null }
  | { type: 'SET_ISSUE_BUSY'; value: boolean }
  | { type: 'SET_ISSUE_RESULT'; value: CommentIssueResult | null }
  | { type: 'SET_TOAST'; value: { kind: 'ok' | 'err'; text: string } | null }
  | { type: 'SET_REPO'; value: string }
  | { type: 'SET_BRANCH'; value: string }
  | { type: 'SET_TITLE'; value: string }
  | { type: 'SET_BODY'; value: string }
  | { type: 'SET_FILES_TEXT'; value: string }
  | { type: 'SET_ISSUE_OWNER'; value: string }
  | { type: 'SET_ISSUE_REPO'; value: string }
  | { type: 'SET_ISSUE_NUMBER'; value: string }
  | { type: 'SET_ISSUE_BODY'; value: string };

const initState: State = {
  loading: true,
  status: null,
  error: null,
  installBusy: false,
  prBusy: false,
  prResult: null,
  issueBusy: false,
  issueResult: null,
  toast: null,
  selectedRepoId: '',
  branch: '',
  title: '',
  body: '',
  filesText: '',
  issueOwner: '',
  issueRepo: '',
  issueNumber: '',
  issueBody: '',
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'LOAD_START':
      return { ...state, loading: true, error: null };
    case 'LOAD_SUCCESS':
      return { ...state, loading: false, status: action.status, error: null };
    case 'LOAD_ERROR':
      return { ...state, loading: false, error: action.error };
    case 'SET_INSTALL_BUSY':
      return { ...state, installBusy: action.value };
    case 'SET_PR_BUSY':
      return { ...state, prBusy: action.value };
    case 'SET_PR_RESULT':
      return { ...state, prResult: action.value };
    case 'SET_ISSUE_BUSY':
      return { ...state, issueBusy: action.value };
    case 'SET_ISSUE_RESULT':
      return { ...state, issueResult: action.value };
    case 'SET_TOAST':
      return { ...state, toast: action.value };
    case 'SET_REPO':
      return { ...state, selectedRepoId: action.value };
    case 'SET_BRANCH':
      return { ...state, branch: action.value };
    case 'SET_TITLE':
      return { ...state, title: action.value };
    case 'SET_BODY':
      return { ...state, body: action.value };
    case 'SET_FILES_TEXT':
      return { ...state, filesText: action.value };
    case 'SET_ISSUE_OWNER':
      return { ...state, issueOwner: action.value };
    case 'SET_ISSUE_REPO':
      return { ...state, issueRepo: action.value };
    case 'SET_ISSUE_NUMBER':
      return { ...state, issueNumber: action.value };
    case 'SET_ISSUE_BODY':
      return { ...state, issueBody: action.value };
  }
}

const panel: React.CSSProperties = {
  background: 'rgba(255,255,255,0.02)',
  border: '1px solid var(--border-subtle)',
  borderRadius: '10px',
  padding: '16px',
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--text-tertiary)',
  marginBottom: '6px',
  display: 'block',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: '0.85rem',
  border: '1px solid var(--border-subtle)',
  borderRadius: '6px',
  background: 'var(--bg-secondary, rgba(0,0,0,0.2))',
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  minHeight: '120px',
  resize: 'vertical',
  lineHeight: 1.45,
};

const INSTALL_PARAM_KEYS = ['installation_id', 'state', 'setup_action'] as const;

function readInstallParams(): { installationId: string | null; state: string | null } {
  if (typeof window === 'undefined') return { installationId: null, state: null };
  const params = new URLSearchParams(window.location.search);
  return {
    installationId: params.get('installation_id'),
    state: params.get('state'),
  };
}

function clearInstallParams(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  for (const k of INSTALL_PARAM_KEYS) url.searchParams.delete(k);
  window.history.replaceState({}, '', url.toString());
}

function shortId(id: number | string | null | undefined): string {
  if (id == null) return '—';
  return String(id);
}

const GitHubAppPanel: React.FC = () => {
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(reducer, initState);
  const {
    loading,
    status,
    error,
    installBusy,
    prBusy,
    prResult,
    issueBusy,
    issueResult,
    toast,
    selectedRepoId,
    branch,
    title,
    body,
    filesText,
    issueOwner,
    issueRepo,
    issueNumber,
    issueBody,
  } = state;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const initialBootRef = useRef(false);

  const showToast = useCallback((kind: 'ok' | 'err', text: string) => {
    dispatch({ type: 'SET_TOAST', value: { kind, text } });
    if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      dispatch({ type: 'SET_TOAST', value: null });
      toastTimerRef.current = null;
    }, 4500);
  }, []);

  const refreshStatus = useCallback(async (): Promise<GhInstallStatus | null> => {
    dispatch({ type: 'LOAD_START' });
    try {
      const s = await getInstallStatus();
      dispatch({ type: 'LOAD_SUCCESS', status: s });
      if (s.installed && s.repos.length > 0 && !selectedRepoId) {
        dispatch({ type: 'SET_REPO', value: String(s.repos[0].id) });
      }
      if (s.installed && s.repos.length > 0) {
        const sel = s.repos.find((r) => String(r.id) === selectedRepoId);
        if (!sel) dispatch({ type: 'SET_REPO', value: String(s.repos[0].id) });
      }
      if (s.installed && s.account && !issueOwner) {
        dispatch({ type: 'SET_ISSUE_OWNER', value: s.account.login });
      }
      return s;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      dispatch({ type: 'LOAD_ERROR', error: msg });
      return null;
    }
  }, [selectedRepoId, issueOwner]);

  useEffect(() => {
    if (initialBootRef.current) return;
    initialBootRef.current = true;
    (async () => {
      const { installationId, state: csrf } = readInstallParams();
      if (installationId && csrf) {
        try {
          await handleCallback(csrf, installationId);
        } catch {
          // Non-fatal: getInstallStatus will surface the real state.
        }
        clearInstallParams();
      }
      await refreshStatus();
    })();
  }, [refreshStatus]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const handleInstall = () => {
    dispatch({ type: 'SET_INSTALL_BUSY', value: true });
    try {
      beginInstall('/github');
    } catch (e) {
      dispatch({ type: 'SET_INSTALL_BUSY', value: false });
      showToast('err', e instanceof Error ? e.message : String(e));
    }
  };

  const handlePickFiles = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const files = ev.target.files;
    if (!files || files.length === 0) return;
    const out: string[] = [];
    for (const f of Array.from(files)) {
      try {
        const b64 = await fileToBase64(f);
        out.push(`${f.name}:${b64}`);
      } catch (e) {
        showToast('err', `${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (out.length > 0) {
      const next = out.join('\n');
      dispatch({ type: 'SET_FILES_TEXT', value: filesText ? `${filesText}\n${next}` : next });
      showToast('ok', `Added ${out.length} file${out.length === 1 ? '' : 's'}`);
    }
    ev.target.value = '';
  };

  const selectedRepo: GhAppRepo | null =
    status?.repos.find((r) => String(r.id) === selectedRepoId) ?? null;

  const handleOpenPR = async () => {
    if (!status?.installed) {
      showToast('err', 'Install the GitHub App first');
      return;
    }
    if (!selectedRepo) {
      showToast('err', 'Pick a repository');
      return;
    }
    const head = branch.trim();
    if (!head) {
      showToast('err', 'Branch name is required');
      return;
    }
    if (!title.trim()) {
      showToast('err', 'PR title is required');
      return;
    }
    const files = parseFilesTextarea(filesText);
    if (files.length === 0) {
      showToast('err', 'At least one file required (path:base64content per line)');
      return;
    }
    dispatch({ type: 'SET_PR_BUSY', value: true });
    dispatch({ type: 'SET_PR_RESULT', value: null });
    try {
      const [owner, repo] = selectedRepo.full_name.split('/');
      const result = await openPR({
        owner,
        repo,
        head,
        base: selectedRepo.default_branch || 'main',
        title: title.trim(),
        body,
        files,
      });
      dispatch({ type: 'SET_PR_RESULT', value: result });
      if (result.ok) {
        showToast('ok', `Opened PR #${result.prNumber ?? '?'}`);
      } else {
        showToast('err', result.error || result.description || 'PR failed');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast('err', msg);
      dispatch({ type: 'SET_PR_RESULT', value: { ok: false, error: msg } });
    } finally {
      dispatch({ type: 'SET_PR_BUSY', value: false });
    }
  };

  const handleCommentOnIssue = async () => {
    if (!status?.installed) {
      showToast('err', 'Install the GitHub App first');
      return;
    }
    const owner = issueOwner.trim();
    const repo = issueRepo.trim();
    const num = parseInt(issueNumber, 10);
    if (!owner || !repo || !Number.isFinite(num) || num <= 0) {
      showToast('err', 'owner, repo, and issue number are required');
      return;
    }
    if (!issueBody.trim()) {
      showToast('err', 'Comment body is required');
      return;
    }
    dispatch({ type: 'SET_ISSUE_BUSY', value: true });
    dispatch({ type: 'SET_ISSUE_RESULT', value: null });
    try {
      const result = await commentOnIssue({ owner, repo, number: num, body: issueBody });
      dispatch({ type: 'SET_ISSUE_RESULT', value: result });
      if (result.ok) {
        showToast('ok', 'Comment posted');
      } else {
        showToast('err', result.error || 'Comment failed');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast('err', msg);
      dispatch({ type: 'SET_ISSUE_RESULT', value: { ok: false, error: msg } });
    } finally {
      dispatch({ type: 'SET_ISSUE_BUSY', value: false });
    }
  };

  const account: GhAppAccount | null = status?.account ?? null;
  const installed = !!status?.installed;
  const configured = status?.configured !== false;
  const notConfigured = status != null && !configured;

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: '960px',
          margin: '0 auto',
          padding: '32px 24px 64px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={() => navigate('/app')}
            className="btn btn-ghost"
            style={{ padding: '6px 10px' }}
            aria-label="Back to app"
          >
            <ArrowLeft size={14} /> Back
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #24292F, #6E7681)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <GitBranch size={18} color="white" />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, letterSpacing: '-0.01em' }}>
                GitHub App
              </h1>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                per-installation token · encrypted in <code>ARTIFACTS</code> KV
              </p>
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => void refreshStatus()}
            disabled={loading}
            className="btn btn-ghost"
            style={{ padding: '6px 10px' }}
            aria-label="Refresh status"
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            <span style={{ fontSize: '0.8rem' }}>Refresh</span>
          </button>
        </header>

        {error && (
          <div
            role="alert"
            style={{
              ...panel,
              borderColor: 'rgba(239,68,68,0.3)',
              background: 'rgba(239,68,68,0.06)',
              color: '#EF4444',
              fontSize: '0.85rem',
            }}
          >
            {error}
          </div>
        )}

        {toast && (
          <div
            role="status"
            style={{
              ...panel,
              borderColor: toast.kind === 'ok' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)',
              background: toast.kind === 'ok' ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)',
              color: toast.kind === 'ok' ? '#10B981' : '#EF4444',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            {toast.kind === 'ok' ? <CircleCheck size={14} /> : <CircleAlert size={14} />}
            {toast.text}
          </div>
        )}

        {notConfigured && (
          <div
            role="alert"
            style={{
              ...panel,
              borderColor: 'rgba(245,158,11,0.3)',
              background: 'rgba(245,158,11,0.06)',
              color: '#F59E0B',
              fontSize: '0.85rem',
            }}
          >
            <strong>Worker is not configured.</strong> Set <code>GITHUB_APP_ID</code>,{' '}
            <code>GITHUB_APP_SLUG</code> (in <code>[vars]</code>), and{' '}
            <code>GITHUB_APP_PRIVATE_KEY</code> + <code>GITHUB_INSTALL_TOKEN_KEY</code>{' '}
            (via <code>wrangler secret put</code>) on this worker.
          </div>
        )}

        <GithubUserSignin onUserChange={() => { void refreshStatus(); }} />

        {loading && !status ? (
          <section style={panel}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                color: 'var(--text-tertiary)',
                fontSize: '0.85rem',
              }}
            >
              <RefreshCw size={14} className="spin" />
              Checking installation status…
            </div>
          </section>
        ) : !installed ? (
          <section
            style={{
              ...panel,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '14px',
              padding: '36px 20px',
              textAlign: 'center',
            }}
          >
            <GitBranch size={36} color="var(--text-tertiary)" />
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>
              {configured ? 'GitHub App is not installed yet' : 'GitHub App not installed'}
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: '0.85rem',
                color: 'var(--text-secondary)',
                maxWidth: '480px',
                lineHeight: 1.5,
              }}
            >
              Install the OpenThink GitHub App on your account or org to enable per-installation
              tokens. The worker will mint a fresh token on demand and AES-GCM encrypt it in
              <code> ARTIFACTS </code> KV.
            </p>
            {status?.appSlug && (
              <code style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                slug: {status.appSlug}
              </code>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleInstall}
              disabled={installBusy || !configured}
              style={{ padding: '10px 20px', fontSize: '0.9rem' }}
            >
              <GitBranch size={14} />
              {installBusy ? 'Redirecting…' : 'Install GitHub App'}
            </button>
          </section>
        ) : (
          <>
            <section
              style={{
                ...panel,
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                flexWrap: 'wrap',
              }}
            >
              {account?.avatar_url ? (
                <img
                  src={account.avatar_url}
                  alt={account.login}
                  width={36}
                  height={36}
                  style={{ borderRadius: '50%', border: '1px solid var(--border-subtle)' }}
                />
              ) : (
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,0.05)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <GitBranch size={18} color="var(--text-tertiary)" />
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '0.95rem', fontWeight: 700 }}>{account?.login ?? 'unknown'}</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                  {account?.type ?? 'user'} · installation #{shortId(status?.repos.length ? 'live' : null)}
                </span>
              </div>
              <div style={{ flex: 1 }} />
              <span
                style={{
                  fontSize: '0.7rem',
                  color: '#10B981',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <CircleCheck size={12} /> installed
              </span>
            </section>

            <section style={panel}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '12px',
                }}
              >
                <GitPullRequest size={14} color="var(--accent-secondary)" />
                <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>New Pull Request</h2>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                  {status?.repos.length ?? 0} repos accessible
                </span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '12px',
                }}
              >
                <div>
                  <label style={labelStyle}>Repository</label>
                  <select
                    value={selectedRepoId}
                    onChange={(e) => dispatch({ type: 'SET_REPO', value: e.target.value })}
                    style={inputStyle}
                    disabled={(status?.repos.length ?? 0) === 0}
                  >
                    {(status?.repos.length ?? 0) === 0 ? (
                      <option value="">no repos accessible</option>
                    ) : (
                      status!.repos.map((r) => (
                        <option key={r.id} value={String(r.id)}>
                          {r.full_name} {r.private ? '🔒' : ''}
                        </option>
                      ))
                    )}
                  </select>
                  {selectedRepo && (
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                      base: <code>{selectedRepo.default_branch}</code>
                    </div>
                  )}
                </div>
                <div>
                  <label style={labelStyle}>Branch (head)</label>
                  <input
                    type="text"
                    value={branch}
                    onChange={(e) => dispatch({ type: 'SET_BRANCH', value: e.target.value })}
                    placeholder="feature/my-change"
                    style={inputStyle}
                  />
                </div>
              </div>

              <div style={{ marginTop: '12px' }}>
                <label style={labelStyle}>Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => dispatch({ type: 'SET_TITLE', value: e.target.value })}
                  placeholder="Brief description of the change"
                  style={inputStyle}
                />
              </div>

              <div style={{ marginTop: '12px' }}>
                <label style={labelStyle}>Body</label>
                <textarea
                  value={body}
                  onChange={(e) => dispatch({ type: 'SET_BODY', value: e.target.value })}
                  placeholder="What does this PR do? Why is it needed?"
                  style={{ ...textareaStyle, minHeight: '80px' }}
                />
              </div>

              <div style={{ marginTop: '12px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '6px',
                  }}
                >
                  <label style={{ ...labelStyle, marginBottom: 0 }}>
                    Files <span style={{ color: 'var(--text-tertiary)' }}>(path:base64content per line)</span>
                  </label>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      onChange={handlePickFiles}
                      style={{ display: 'none' }}
                    />
                    <button
                      type="button"
                      className="btn-ghost-sm"
                      onClick={() => fileInputRef.current?.click()}
                      aria-label="Add file"
                    >
                      <Upload size={12} /> Add file
                    </button>
                    {filesText && (
                      <button
                        type="button"
                        className="btn-ghost-sm"
                        onClick={() => dispatch({ type: 'SET_FILES_TEXT', value: '' })}
                        aria-label="Clear files"
                      >
                        <X size={12} /> Clear
                      </button>
                    )}
                  </div>
                </div>
                <textarea
                  value={filesText}
                  onChange={(e) => dispatch({ type: 'SET_FILES_TEXT', value: e.target.value })}
                  placeholder={"src/index.ts:VGhpcyBpcyBhIGJhc2U2NCBzdHJpbmc="}
                  style={textareaStyle}
                />
                <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                  {parseFilesTextarea(filesText).length} file
                  {parseFilesTextarea(filesText).length === 1 ? '' : 's'} parsed
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  marginTop: '14px',
                  flexWrap: 'wrap',
                }}
              >
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleOpenPR}
                  disabled={prBusy}
                  style={{ padding: '8px 16px' }}
                >
                  <GitPullRequest size={14} />
                  {prBusy ? 'Opening PR…' : 'Open PR'}
                </button>
                {prResult && (
                  <div style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {prResult.ok && prResult.url ? (
                      <a
                        href={prResult.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#10B981', display: 'flex', alignItems: 'center', gap: '4px' }}
                      >
                        PR #{prResult.prNumber} opened <ExternalLink size={11} />
                      </a>
                    ) : (
                      <span style={{ color: '#EF4444' }}>
                        {prResult.error || 'PR failed'}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </section>

            <section style={panel}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '12px',
                }}
              >
                <MessageSquare size={14} color="var(--accent-secondary)" />
                <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>Add comment to issue</h2>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: '12px',
                }}
              >
                <div>
                  <label style={labelStyle}>Owner</label>
                  <input
                    type="text"
                    value={issueOwner}
                    onChange={(e) => dispatch({ type: 'SET_ISSUE_OWNER', value: e.target.value })}
                    placeholder="acme"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Repo</label>
                  <input
                    type="text"
                    value={issueRepo}
                    onChange={(e) => dispatch({ type: 'SET_ISSUE_REPO', value: e.target.value })}
                    placeholder="my-repo"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Issue / PR #</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={issueNumber}
                    onChange={(e) => dispatch({ type: 'SET_ISSUE_NUMBER', value: e.target.value })}
                    placeholder="42"
                    style={inputStyle}
                  />
                </div>
              </div>
              <div style={{ marginTop: '12px' }}>
                <label style={labelStyle}>Body</label>
                <textarea
                  value={issueBody}
                  onChange={(e) => dispatch({ type: 'SET_ISSUE_BODY', value: e.target.value })}
                  placeholder="Leave a comment…"
                  style={{ ...textareaStyle, minHeight: '80px' }}
                />
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  marginTop: '14px',
                  flexWrap: 'wrap',
                }}
              >
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleCommentOnIssue}
                  disabled={issueBusy}
                  style={{ padding: '8px 16px' }}
                >
                  <MessageSquare size={14} />
                  {issueBusy ? 'Posting…' : 'Post comment'}
                </button>
                {issueResult && (
                  <div style={{ fontSize: '0.8rem' }}>
                    {issueResult.ok && issueResult.url ? (
                      <a
                        href={issueResult.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#10B981', display: 'flex', alignItems: 'center', gap: '4px' }}
                      >
                        Comment posted <ExternalLink size={11} />
                      </a>
                    ) : (
                      <span style={{ color: '#EF4444' }}>{issueResult.error || 'Comment failed'}</span>
                    )}
                  </div>
                )}
              </div>
            </section>
          </>
        )}

        <p
          style={{
            fontSize: '0.7rem',
            color: 'var(--text-tertiary)',
            textAlign: 'center',
            margin: 0,
            lineHeight: 1.4,
          }}
        >
          Tokens are minted on demand and stored as <code>gh:install:token:&lt;cf-account-id&gt;</code>{' '}
          in <code>ARTIFACTS</code> KV. AES-GCM (12-byte IV) is keyed by{' '}
          <code>GITHUB_INSTALL_TOKEN_KEY</code>. JWTs are RS256-signed with the app's private key.
        </p>
      </div>

      <style>{`
        .spin { animation: spin 1s linear infinite; transform-origin: center; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default GitHubAppPanel;
