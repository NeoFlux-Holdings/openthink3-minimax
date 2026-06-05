import React, { useCallback, useEffect, useReducer, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BarChart2,
  CheckCircle2,
  Clock,
  Gauge,
  Play,
  RefreshCw,
  Sparkles,
  TrendingUp,
  XCircle,
} from 'lucide-react';

const SUITE = 'gbrain';
const REFRESH_DELAY_MS = 3000;

const getApiUrl = (): string => {
  if (typeof window === 'undefined') return '';
  const { hostname } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'http://127.0.0.1:8787';
  return 'https://openthink3-worker.thomas-zarebczan.workers.dev';
};

const formatScorePercent = (score: number): string => `${(score * 100).toFixed(1)}%`;

const formatRelativeTime = (epochSeconds: number): string => {
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - epochSeconds);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(epochSeconds * 1000).toLocaleDateString();
};

const formatAbsoluteTime = (epochSeconds: number): string =>
  new Date(epochSeconds * 1000).toLocaleString();

type RunSource = 'scheduled' | 'manual';

const deriveSource = (suite: string): RunSource => {
  if (suite === 'cron-daily' || suite.startsWith('cron-')) return 'scheduled';
  return 'manual';
};

interface BenchmarkRow {
  id: string;
  suite: string;
  score: number;
  total: number;
  passed: number;
  details: string | null;
  created_at: number;
}

type State = {
  rows: BenchmarkRow[];
  latest: BenchmarkRow | null;
  loading: boolean;
  running: boolean;
  error: string | null;
};

type Action =
  | { type: 'LOAD_START' }
  | { type: 'LOAD_SUCCESS'; rows: BenchmarkRow[]; latest: BenchmarkRow | null }
  | { type: 'LOAD_ERROR'; error: string }
  | { type: 'RUN_START' }
  | { type: 'RUN_END' };

const initState = (): State => ({
  rows: [],
  latest: null,
  loading: true,
  running: false,
  error: null,
});

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'LOAD_START':
      return { ...state, loading: true, error: null };
    case 'LOAD_SUCCESS':
      return { ...state, loading: false, rows: action.rows, latest: action.latest, error: null };
    case 'LOAD_ERROR':
      return { ...state, loading: false, error: action.error };
    case 'RUN_START':
      return { ...state, running: true };
    case 'RUN_END':
      return { ...state, running: false };
  }
}

const panel: React.CSSProperties = {
  background: 'rgba(255,255,255,0.02)',
  border: '1px solid var(--border-subtle)',
  borderRadius: '10px',
  padding: '16px',
};

const BenchmarksView: React.FC = () => {
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(reducer, undefined, initState);
  const { rows, latest, loading, running, error } = state;
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const fetchAll = useCallback(async (suite: string) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    dispatch({ type: 'LOAD_START' });
    const base = getApiUrl();
    let listRes: Response;
    let latestRes: Response;
    try {
      [listRes, latestRes] = await Promise.all([
        fetch(`${base}/api/benchmarks?suite=${encodeURIComponent(suite)}&limit=50`, {
          signal: ac.signal,
          credentials: 'include',
        }),
        fetch(`${base}/api/benchmarks?suite=${encodeURIComponent(suite)}&latest=1`, {
          signal: ac.signal,
          credentials: 'include',
        }),
      ]);
    } catch (e) {
      if (ac.signal.aborted || !mountedRef.current) return;
      const msg = e instanceof Error ? e.message : 'Failed to load benchmarks';
      dispatch({ type: 'LOAD_ERROR', error: msg });
      return;
    }
    if (ac.signal.aborted || !mountedRef.current) return;
    if (!listRes.ok) {
      dispatch({ type: 'LOAD_ERROR', error: `HTTP ${listRes.status}` });
      return;
    }
    const listJson = (await listRes.json()) as { rows?: BenchmarkRow[] };
    let latestRow: BenchmarkRow | null = null;
    if (latestRes.ok) {
      const j = (await latestRes.json()) as { latest?: BenchmarkRow | null };
      latestRow = j.latest ?? null;
    }
    if (ac.signal.aborted || !mountedRef.current) return;
    dispatch({ type: 'LOAD_SUCCESS', rows: listJson.rows ?? [], latest: latestRow });
  }, []);

  useEffect(() => {
    void fetchAll(SUITE);
  }, [fetchAll]);

  const handleRun = useCallback(async () => {
    if (running) return;
    dispatch({ type: 'RUN_START' });
    try {
      const base = getApiUrl();
      const ac = new AbortController();
      const timer = window.setTimeout(() => ac.abort(), 10_000);
      await fetch(`${base}/api/benchmarks/run`, {
        method: 'POST',
        signal: ac.signal,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suite: SUITE }),
      }).catch(() => null);
      window.clearTimeout(timer);
    } finally {
      if (mountedRef.current) dispatch({ type: 'RUN_END' });
    }
    window.setTimeout(() => {
      if (mountedRef.current) void fetchAll(SUITE);
    }, REFRESH_DELAY_MS);
  }, [running, fetchAll]);

  const bestRow: BenchmarkRow | null = rows.length === 0
    ? null
    : rows.reduce((best, r) => (r.score > best.score ? r : best), rows[0]);
  const lastRunAt: number | null = latest?.created_at ?? null;
  const hasData = rows.length > 0;

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
                background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <BarChart2 size={18} color="white" />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, letterSpacing: '-0.01em' }}>
                Benchmarks
              </h1>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                gbrain-evals scorecard · suite: <code style={{ color: 'var(--accent-secondary)' }}>{SUITE}</code>
              </p>
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => void fetchAll(SUITE)}
            disabled={loading}
            className="btn btn-ghost"
            style={{ padding: '6px 10px' }}
            aria-label="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            <span style={{ fontSize: '0.8rem' }}>Refresh</span>
          </button>
          <button
            type="button"
            onClick={() => void handleRun()}
            disabled={running}
            className="btn btn-primary"
            style={{ padding: '8px 14px' }}
            aria-label="Run gbrain-evals"
          >
            {running ? <RefreshCw size={14} className="spin" /> : <Play size={14} fill="currentColor" />}
            <span style={{ fontSize: '0.85rem' }}>
              {running ? 'Triggering…' : 'Run gbrain-evals now'}
            </span>
          </button>
        </header>

        <section
          style={{
            ...panel,
            background: 'linear-gradient(135deg, rgba(16,185,129,0.06), rgba(59,130,246,0.04))',
            borderColor: 'rgba(16,185,129,0.2)',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '12px',
            }}
          >
            <SummaryStat
              icon={<Gauge size={16} color="#10B981" />}
              label="Latest score"
              value={latest ? formatScorePercent(latest.score) : '—'}
              sub={latest ? `${latest.passed}/${latest.total} cases` : 'awaiting first run'}
            />
            <SummaryStat
              icon={<TrendingUp size={16} color="#3B82F6" />}
              label="Best score"
              value={bestRow ? formatScorePercent(bestRow.score) : '—'}
              sub={bestRow ? `from ${formatRelativeTime(bestRow.created_at)}` : 'no history yet'}
            />
            <SummaryStat
              icon={<Sparkles size={16} color="#8B5CF6" />}
              label="Total runs"
              value={String(rows.length)}
              sub={hasData ? 'most recent 50' : 'no rows recorded'}
            />
            <SummaryStat
              icon={<Clock size={16} color="#F59E0B" />}
              label="Last run"
              value={lastRunAt ? formatRelativeTime(lastRunAt) : '—'}
              sub={lastRunAt ? formatAbsoluteTime(lastRunAt) : 'no cron fired yet'}
            />
          </div>
        </section>

        {error && (
          <div
            role="alert"
            className="glass-card"
            style={{
              borderColor: 'rgba(239,68,68,0.3)',
              background: 'rgba(239,68,68,0.06)',
              color: '#EF4444',
              fontSize: '0.85rem',
              padding: '12px 16px',
            }}
          >
            Failed to load benchmarks: {error}
          </div>
        )}

        <section className="glass-card" style={{ padding: '16px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '12px',
            }}
          >
            <BarChart2 size={14} color="var(--accent-secondary)" />
            <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>Run history</h2>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
              {hasData ? `${rows.length} run${rows.length === 1 ? '' : 's'}` : 'none yet'}
            </span>
          </div>

          {loading && !hasData ? (
            <LoadingState />
          ) : !hasData ? (
            <EmptyState />
          ) : (
            <RunHistoryTable rows={rows} />
          )}
        </section>

        <p
          style={{
            fontSize: '0.75rem',
            color: 'var(--text-tertiary)',
            textAlign: 'center',
            margin: 0,
          }}
        >
          Source: <code>/api/benchmarks</code> · data: <code>OPENTHINK3_DB.benchmarks</code>
        </p>
      </div>

      <style>{`
        .spin { animation: spin 1s linear infinite; transform-origin: center; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

const SummaryStat: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}> = ({ icon, label, value, sub }) => (
  <div
    style={{
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid var(--border-subtle)',
      borderRadius: '8px',
      padding: '12px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-tertiary)' }}>
      {icon}
      <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </span>
    </div>
    <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)' }}>{value}</div>
    <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{sub}</div>
  </div>
);

const LoadingState: React.FC = () => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      color: 'var(--text-tertiary)',
      fontSize: '0.85rem',
      padding: '24px 0',
      justifyContent: 'center',
    }}
  >
    <RefreshCw size={14} className="spin" />
    Loading benchmark runs…
  </div>
);

const EmptyState: React.FC = () => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '12px',
      padding: '40px 20px',
      textAlign: 'center',
      color: 'var(--text-tertiary)',
      fontSize: '0.9rem',
    }}
  >
    <CheckCircle2 size={28} color="var(--text-tertiary)" />
    <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
      No benchmarks yet. Run gbrain-evals or wait for the daily 06:00 UTC cron.
    </p>
    <p style={{ margin: 0, fontSize: '0.75rem' }}>
      Triggered runs typically take 30–60s to complete and appear here.
    </p>
  </div>
);

const SourceBadge: React.FC<{ source: RunSource }> = ({ source }) => {
  const isScheduled = source === 'scheduled';
  const color = isScheduled ? '#3B82F6' : '#10B981';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: '0.65rem',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        padding: '2px 6px',
        borderRadius: '4px',
        background: isScheduled ? 'rgba(59,130,246,0.12)' : 'rgba(16,185,129,0.12)',
        color,
        border: `1px solid ${isScheduled ? 'rgba(59,130,246,0.3)' : 'rgba(16,185,129,0.3)'}`,
        whiteSpace: 'nowrap',
      }}
    >
      {isScheduled ? <Clock size={9} /> : <Play size={9} />}
      {source}
    </span>
  );
};

const PercentBar: React.FC<{ value: number }> = ({ value }) => {
  const pct = Math.max(0, Math.min(100, value * 100));
  const color = pct >= 100 ? '#10B981' : pct >= 60 ? '#3B82F6' : '#F59E0B';
  return (
    <div
      style={{
        width: '100%',
        height: '4px',
        background: 'rgba(255,255,255,0.06)',
        borderRadius: '2px',
        overflow: 'hidden',
      }}
      aria-label={`${pct.toFixed(1)} percent`}
    >
      <div
        style={{
          width: `${pct}%`,
          height: '100%',
          background: color,
          borderRadius: '2px',
          transition: 'width 0.3s ease-out',
        }}
      />
    </div>
  );
};

const RunHistoryTable: React.FC<{ rows: BenchmarkRow[] }> = ({ rows }) => (
  <div style={{ overflowX: 'auto' }}>
    <table
      style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: '0.85rem',
      }}
    >
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          {['When', 'Suite', 'Score', 'Source'].map((h) => {
            const alignRight = h === 'Score';
            return (
              <th
                key={h}
                style={{
                  textAlign: alignRight ? 'right' : 'left',
                  padding: '8px 10px',
                  color: 'var(--text-tertiary)',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  fontSize: '0.75rem',
                  letterSpacing: '0.05em',
                }}
              >
                {h}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const allPassed = r.passed === r.total;
          const ratioColor = allPassed ? '#10B981' : '#F59E0B';
          return (
            <tr
              key={r.id}
              style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
            >
              <td
                style={{
                  padding: '10px',
                  color: 'var(--text-primary)',
                  whiteSpace: 'nowrap',
                }}
                title={formatAbsoluteTime(r.created_at)}
              >
                {formatRelativeTime(r.created_at)}
              </td>
              <td
                style={{
                  padding: '10px',
                  color: 'var(--text-secondary)',
                  fontFamily: 'monospace',
                  fontSize: '0.8rem',
                }}
              >
                {r.suite}
              </td>
              <td style={{ padding: '10px', minWidth: '180px' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '4px',
                  }}
                >
                  <span
                    style={{
                      color: ratioColor,
                      fontWeight: 700,
                      fontFamily: 'monospace',
                      fontSize: '0.8rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    {allPassed ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                    {r.passed}/{r.total}
                  </span>
                  <span
                    style={{
                      color: 'var(--text-primary)',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                    }}
                  >
                    {formatScorePercent(r.score)}
                  </span>
                </div>
                <PercentBar value={r.score} />
              </td>
              <td style={{ padding: '10px' }}>
                <SourceBadge source={deriveSource(r.suite)} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

export default BenchmarksView;
