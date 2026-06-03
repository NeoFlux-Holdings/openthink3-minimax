import React, { useState, useEffect } from 'react';
import { Eye, CheckSquare, Layers, Code, Edit3 } from 'lucide-react';

interface CanvasPanelProps {
  isPoppedOut?: boolean;
}

function dockCanvas() {
  localStorage.setItem('openthink_popout_canvas', 'false');
  window.dispatchEvent(new Event('storage'));
  window.close();
}

const CanvasPanel: React.FC<CanvasPanelProps> = ({ isPoppedOut = false }) => {
  const [notepad, setNotepad] = useState(() => {
    return localStorage.getItem('openthink_intel_canvas_notes') ||
      '// Collaborator Sync Stream\n- Setup production Cloudflare Durable Object SQLite tables.\n- Ensure R2 repo snapshots align with local worktrees.';
  });

  const [activeModel, setActiveModel] = useState(() => {
    return localStorage.getItem('openthink_active_model') || '@cf/meta/llama-3.1-8b-instruct';
  });

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'openthink_intel_canvas_notes' && e.newValue !== null) {
        setNotepad(e.newValue);
      }
      if (e.key === 'openthink_active_model' && e.newValue) {
        setActiveModel(e.newValue);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const handleNotepadChange = (val: string) => {
    setNotepad(val);
    localStorage.setItem('openthink_intel_canvas_notes', val);
    // Notify other windows
    window.dispatchEvent(new Event('storage'));
  };

  const handleDock = dockCanvas;

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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', paddingBottom: '12px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Layers size={16} color="white" />
            </div>
            <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: '1.15rem', fontWeight: 700 }}>Workspace Intel Canvas</span>
          </div>
          <button type="button"
            className="btn btn-ghost row-flex-gap-6"
            onClick={handleDock}
          >
            <Layers size={14} /> Dock Back
          </button>
        </div>
      )}

      {/* Focus & Sprint Section */}
      <div className="glass-panel" style={{ padding: '16px', borderRadius: 'var(--radius-md)', background: 'rgba(36,36,36,0.3)', marginBottom: '16px' }}>
        <div className="section-header" style={{ marginBottom: '12px' }}>
          <span>Active Cognitive Focus</span>
          <Eye size={14} color="var(--accent-secondary)" />
        </div>
        <div style={{ fontSize: '0.9rem', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
          Currently evolving <strong style={{ color: 'var(--text-primary)' }}>Agent Orange 0</strong> with a high-fidelity <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{activeModel}</span> edge model execution layer, multi-monitor tab coordination, and interactive Convex tunnel pipes.
        </div>
      </div>

      {/* Attention & Environment Checklist */}
      <div className="glass-panel" style={{ padding: '16px', borderRadius: 'var(--radius-md)', background: 'rgba(36,36,36,0.3)', marginBottom: '16px' }}>
        <div className="section-header" style={{ marginBottom: '12px' }}>
          <span>Attention Checklist</span>
          <CheckSquare size={14} color="var(--accent-primary)" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.825rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10B981' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10B981' }} />
            <span>Llama 3.1 8B edge default model integration - Active</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10B981' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10B981' }} />
            <span>Cross-window storage event sync - Functional</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--text-tertiary)' }} />
            <span>Configure Cloudflare paid tier model tests - Pending plan setup</span>
          </div>
        </div>
      </div>

      {/* Durable Objects Git Storage Spec */}
      <div className="glass-panel" style={{ padding: '16px', borderRadius: 'var(--radius-md)', background: 'rgba(36,36,36,0.3)', marginBottom: '16px' }}>
        <div className="section-header" style={{ marginBottom: '12px' }}>
          <span>Durable Objects SQLite & Git Integration Spec</span>
          <Code size={14} color="var(--accent-tertiary)" />
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4, margin: '0 0 12px' }}>
          Instead of relying on third-party remote endpoints, OpenThink archives local code diffs and environment structures inside Durable Objects. The active branch is committed directly to a DO SQLite transaction table, which automatically backups incrementally as physical snapshots to <strong style={{ color: 'var(--text-primary)' }}>Cloudflare R2 Objects</strong>.
        </p>
        <div style={{ background: 'black', borderRadius: '6px', padding: '12px', fontFamily: 'monospace', fontSize: '0.75rem', color: '#10B981', border: '1px solid var(--border-subtle)' }}>
          <span style={{ color: '#6B7280' }}>{'\u002F\u002F SQLite commit schema inside DO'}</span><br />
          <span style={{ color: 'var(--accent-secondary)' }}>CREATE TABLE</span> commit_snapshots (<br />
          &nbsp;&nbsp;commit_hash <span style={{ color: 'var(--accent-tertiary)' }}>TEXT</span> PRIMARY KEY,<br />
          &nbsp;&nbsp;branch_name <span style={{ color: 'var(--accent-tertiary)' }}>TEXT</span>,<br />
          &nbsp;&nbsp;diff_content <span style={{ color: 'var(--accent-tertiary)' }}>TEXT</span>,<br />
          &nbsp;&nbsp;timestamp <span style={{ color: 'var(--accent-tertiary)' }}>INTEGER</span><br />
          );
        </div>
      </div>

      {/* Sync Notepad */}
      <div className="glass-panel" style={{ flex: 1, padding: '16px', borderRadius: 'var(--radius-md)', background: 'rgba(36,36,36,0.3)', display: 'flex', flexDirection: 'column' }}>
        <div className="section-header" style={{ marginBottom: '12px' }}>
          <span>Collaborative Scratchpad (Synced Live)</span>
          <Edit3 size={14} color="var(--accent-secondary)" />
        </div>
        <textarea
          value={notepad}
          onChange={e => handleNotepadChange(e.target.value)}
          className="focus-ring code-textarea"
          placeholder="// Type custom developer notes to sync instantly across popped-out tabs..."
         aria-label="Canvas prompt input" />
      </div>
    </div>
  );
};

export default CanvasPanel;
