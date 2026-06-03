import { useState, useEffect } from 'react';
import { GitBranch, CheckCircle2, Loader2, Layers, GitCommit, Terminal, Dock } from 'lucide-react';

interface Task {
  id: string;
  name: string;
  status: 'done' | 'running' | 'idle';
}

const PierrePanel = ({ isPoppedOut = false }: { isPoppedOut?: boolean }) => {
  const [tasks, setTasks] = useState<Task[]>([
    { id: '1', name: 'Create self-hosted Convex Docker and tunnel config', status: 'done' },
    { id: '2', name: 'Set Cloudflare DNS/tunnel for c and login hosts', status: 'done' },
    { id: '3', name: 'Recover/verify Docker engine and start Convex on D: storage', status: 'done' },
    { id: '4', name: 'Generate admin key and activate self-hosted envs', status: 'done' },
    { id: '5', name: 'Deploy functions and env to a clean self-hosted Convex database', status: 'done' },
    { id: '6', name: 'Audit and reduce pipeline/database bandwidth hotspots without hurting UX', status: 'running' },
  ]);

  const [activeBranch, setActiveBranch] = useState('feat/agent-orange-evolution');
  const [activeEnv, setActiveEnv] = useState('Local');
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitMessage, setCommitMessage] = useState('feat: evolve Agent Orange 0 and integrate robust streaming');
  const [logs, setLogs] = useState<string[]>([
    'Local branch setup completed.',
    'Docker daemon responsive on host port 2375.',
    'Tunnel established: https://convex.openthink.internal -> 127.0.0.1:3210'
  ]);

  // Simulate progress logic
  useEffect(() => {
    let interval: any;
    if (tasks.some(t => t.status === 'running')) {
      interval = setInterval(() => {
        setTasks(prev => {
          const runningIdx = prev.findIndex(t => t.status === 'running');
          if (runningIdx === -1) return prev;
          const next = [...prev];
          const finished = next[runningIdx];
          next[runningIdx] = { ...finished, status: 'done' };
          if (runningIdx + 1 < next.length) {
            next[runningIdx + 1] = { ...next[runningIdx + 1], status: 'running' };
            setLogs(l => [...l, `Task completed: ${finished.name}`]);
          } else {
            setLogs(l => [...l, `Task completed: ${finished.name}`]);
          }
          return next;
        });
      }, 8000);
    }
    return () => clearInterval(interval);
  }, [tasks]);

  const handleSimulateCommit = () => {
    if (isCommitting) return;
    setIsCommitting(true);
    setLogs(l => [...l, `Preparing commit on ${activeBranch}...`]);
    setTimeout(() => {
      setLogs(l => [...l, `Changes staged. Writing objects...`]);
    }, 1000);
    setTimeout(() => {
      setLogs(l => [...l, `Committed: ${commitMessage.slice(0, 30)}...`]);
      setLogs(l => [...l, `Pushing to origin/${activeBranch}...`]);
    }, 2000);
    setTimeout(() => {
      setLogs(l => [...l, `Successfully pushed. PR updated at https://github.com/openthink/harness/pull/1`]);
      setIsCommitting(false);
    }, 3500);
  };

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: isPoppedOut ? 'var(--bg-primary)' : 'transparent',
      padding: isPoppedOut ? '24px' : '0',
      color: 'var(--text-primary)',
      fontFamily: "'Inter', sans-serif"
    }}>
      {isPoppedOut && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '24px', paddingBottom: '12px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-tertiary))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Layers size={16} color="white" />
            </div>
            <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: '1.15rem', fontWeight: 700 }}>Pierre - Environment & Git</span>
          </div>
          <button type="button"
            className="btn btn-ghost"
            onClick={() => {
              localStorage.setItem('openthink_popout_pierre', 'false');
              window.dispatchEvent(new Event('storage'));
              window.close();
            }}
            aria-label="Dock back"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', padding: '8px 14px', borderRadius: 'var(--radius-full)', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', minHeight: 40, cursor: 'pointer', touchAction: 'manipulation' }}
          >
            <Dock size={14} /> Dock Back
          </button>
        </div>
      )}

      {/* Progress Section */}
      <div className="glass-panel" style={{ padding: '16px', borderRadius: 'var(--radius-md)', background: 'rgba(36,36,36,0.3)', marginBottom: '16px' }}>
        <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-tertiary)', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '12px' }}>Pierre Pipeline Progress</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {tasks.map(task => (
            <div key={task.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '0.85rem' }}>
              {task.status === 'done' ? (
                <CheckCircle2 size={16} color="#10B981" style={{ marginTop: '2px', flexShrink: 0 }} />
              ) : task.status === 'running' ? (
                <Loader2 size={16} color="var(--accent-secondary)" className="spin" style={{ marginTop: '2px', flexShrink: 0 }} />
              ) : (
                <div style={{ width: '16px', height: '16px', borderRadius: '50%', border: '2px dashed var(--text-tertiary)', marginTop: '2px', flexShrink: 0 }} />
              )}
              <span style={{ color: task.status === 'done' ? 'var(--text-secondary)' : task.status === 'running' ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                {task.name}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Git & Branch Configuration */}
      <div className="glass-panel" style={{ padding: '16px', borderRadius: 'var(--radius-md)', background: 'rgba(36,36,36,0.3)', marginBottom: '16px' }}>
        <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-tertiary)', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '12px' }}>Environment Management</div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Environment selector */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Active Env</span>
            <select
              value={activeEnv}
              onChange={e => setActiveEnv(e.target.value)}
              className="focus-ring"
              style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)', borderRadius: '4px', padding: '4px 8px', color: 'var(--text-primary)', fontSize: '0.8rem' }}
            >
              <option value="Local">Local Dev</option>
              <option value="Staging">Cloudflare Staging</option>
              <option value="Production">Cloudflare Production</option>
            </select>
          </div>

          {/* Branch selector */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Branch</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <GitBranch size={14} color="var(--accent-primary)" />
              <select
                value={activeBranch}
                onChange={e => setActiveBranch(e.target.value)}
                className="focus-ring"
                style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)', borderRadius: '4px', padding: '4px 8px', color: 'var(--text-primary)', fontSize: '0.8rem' }}
              >
                <option value="feat/agent-orange-evolution">feat/agent-orange-evolution</option>
                <option value="master">master</option>
                <option value="hotfix/streaming-buffer">hotfix/streaming-buffer</option>
              </select>
            </div>
          </div>

          <div style={{ height: '1px', background: 'var(--border-subtle)', margin: '4px 0' }} />

          {/* Commit simulator */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>Commit message</span>
            <input 
              type="text"
              value={commitMessage}
              onChange={e => setCommitMessage(e.target.value)}
              className="input-field"
              style={{ fontSize: '0.8rem', padding: '8px 10px', background: 'var(--bg-tertiary)' }}
             aria-label="Terminal command input" />
            <button type="button" 
              className="btn btn-primary" 
              onClick={handleSimulateCommit}
              disabled={isCommitting || !commitMessage.trim()}
              style={{ width: '100%', padding: '10px', fontSize: '0.85rem', borderRadius: '6px', gap: '8px' }}
            >
              {isCommitting ? <Loader2 size={14} className="spin" /> : <GitCommit size={14} />}
              {isCommitting ? 'Committing...' : 'Commit & Push Changes'}
            </button>
          </div>
        </div>
      </div>

      {/* Terminal Logs */}
      <div className="glass-panel" style={{ flex: 1, padding: '12px', borderRadius: 'var(--radius-md)', background: 'black', border: '1px solid var(--border-strong)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10B981', fontSize: '0.75rem', fontFamily: 'monospace', borderBottom: '1px solid #10B981', paddingBottom: '6px', marginBottom: '8px' }}>
          <Terminal size={14} /> PIERRE HARNESS TERMINAL
        </div>
        <div style={{ flex: 1, overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.75rem', color: '#10B981', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {logs.map((log) => (
            <div key={`log-${log.slice(0, 20)}`} style={{ lineBreak: 'anywhere' }}>
              <span style={{ color: '#6B7280' }}>$</span> {log}
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .spin { animation: spin 1.2s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default PierrePanel;
