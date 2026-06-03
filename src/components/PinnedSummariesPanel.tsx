import { useState } from 'react';
import { Pin, Dock, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';

interface SummaryItem {
  id: string;
  title: string;
  short: string;
  detail: string;
  category: string;
}

const PINNED_SUMMARIES: SummaryItem[] = [
  {
    id: 'orange-core',
    title: 'Orange Core Spec',
    category: 'Agent System',
    short: 'Agent Orange 0 is a self-evolving AI Durable Object orchestrator.',
    detail: 'Operates natively inside Cloudflare Durable Objects. Features a persistent transactional SQLite engine, real-time memory consolidation across conversation threads, and native support for Model Context Protocol (MCP) clients to run custom background tasks.'
  },
  {
    id: 'remote-runtime',
    title: 'Remote Runtime Tunnels',
    category: 'Infrastructure',
    short: 'Cloudflare quick-tunnel brings the exe.dev VM onto the same localhost origin.',
    detail: 'The Desktop Remote panel spawns a `cloudflared` quick-tunnel targeting 127.0.0.1:11434 for Ollama and 4000 for gbrain. Until the tunnel id is registered, the local fallback list is used and the panel shows a "not connected" badge.'
  },
  {
    id: 'stacked-diffs',
    title: 'Stacked Diffs Engine',
    category: 'Git & Environment',
    short: 'Pierre-style Git workflow is configured for stacked environments.',
    detail: 'Leverages stacked PR branching structures to enable developer-friendly incremental commits. Features a live stage router (Local, Staging, Production) with simulated automated deployment pipelines.'
  },
  {
    id: 'cloudflare-inference',
    title: 'Cloudflare Inference',
    category: 'Inference',
    short: 'Dynamic global routing of edge-executed Workers AI models.',
    detail: 'Enables hot-swapping between Llama 3.1, Llama 3.3 70B, Hermes 2 Pro, and Qwen 1.5. Real-time prompt eval latency metrics, generation speeds (tokens/sec), and cumulative conversation session cost trackers are fully active.'
  }
];

function dockSummaries() {
  localStorage.setItem('openthink_popout_summaries', 'false');
  window.dispatchEvent(new Event('storage'));
  window.close();
}

const PinnedSummariesPanel = ({ isPoppedOut = false, onClose }: { isPoppedOut?: boolean, onClose?: () => void }) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const summaries = PINNED_SUMMARIES;
  const handleDock = dockSummaries;

  const handleCopy = (item: SummaryItem) => {
    navigator.clipboard.writeText(`${item.title}\n${item.detail}`);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-primary)',
      padding: 0,
      color: 'var(--text-primary)',
      fontFamily: "'Inter', sans-serif",
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '20px', paddingBottom: '12px',
        borderBottom: '1px solid var(--border-subtle)',
        paddingTop: 'env(safe-area-inset-top)',
        padding: '16px 20px 12px',
        position: 'sticky', top: 0, zIndex: 2,
        background: 'var(--bg-primary)',
        borderRadius: '20px 20px 0 0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Pin size={16} color="white" />
          </div>
          <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: '1.15rem', fontWeight: 700 }}>Pinned Summaries</span>
        </div>

        {isPoppedOut && (
          <button type="button"
            className="btn btn-ghost row-flex-gap-6"
            onClick={handleDock}
          >
            <Dock size={14} /> Dock Back
          </button>
        )}

        {onClose && !isPoppedOut && (
          <button type="button"
            className="btn btn-ghost"
            onClick={onClose}
            aria-label="Close"
            style={{ minWidth: 40, minHeight: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', cursor: 'pointer' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        )}
      </div>

      {/* Summaries List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1, padding: '0 20px 24px', paddingBottom: 'calc(24px + env(safe-area-inset-bottom))' }}>
        {summaries.map(item => {
          const isExpanded = expandedId === item.id;
          return (
            <div 
              key={item.id} 
              className="glass-panel" 
              style={{ 
                padding: '16px', 
                borderRadius: 'var(--radius-md)', 
                background: isExpanded ? 'rgba(255,255,255,0.03)' : 'rgba(36,36,36,0.3)',
                border: isExpanded ? '1px solid rgba(255, 255, 255, 0.15)' : '1px solid var(--border-subtle)',
                transition: 'background ease 0.25s, color ease 0.25s, border-color ease 0.25s, transform ease 0.25s, opacity ease 0.25s, box-shadow ease 0.25s'
              }}
            >
              {/* Card Title Bar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', cursor: 'pointer', flex: 1, background: 'transparent', border: 'none', padding: 0, textAlign: 'left', color: 'inherit', minWidth: 0 }}
                >
                  <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--accent-secondary)', fontWeight: 700, letterSpacing: '0.05em' }}>
                    {item.category}
                  </span>
                  <h4 style={{ margin: '4px 0', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {item.title}
                  </h4>
                </button>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                  <button type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopy(item);
                    }}
                    aria-label={copiedId === item.id ? 'Copied' : 'Copy summary'}
                    style={{ color: copiedId === item.id ? '#10B981' : 'var(--text-tertiary)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '8px', minWidth: 40, minHeight: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'manipulation' }}
                  >
                    {copiedId === item.id ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                  <span style={{ color: 'var(--text-tertiary)' }}>
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </span>
                </div>
              </div>

              {/* Short Summary Description */}
              <p style={{ margin: '8px 0 0', fontSize: '0.825rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                {item.short}
              </p>

              {/* Expanded Details */}
              {isExpanded && (
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed var(--border-subtle)', fontSize: '0.8rem', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                  {item.detail}
                </div>
              )}
            </div>
          );
        })}
      </div>
      
      <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', textAlign: 'center', marginTop: '24px' }}>
        Synced dynamically with OpenThink Agent Orange 0 cognitive memory stream.
      </div>
    </div>
  );
};

export default PinnedSummariesPanel;
