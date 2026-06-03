import React from 'react';
import { Menu, MoreHorizontal } from 'lucide-react';

export const ThreadHeader: React.FC<{
  isMobile?: boolean;
  title: string;
  onOpenMenu?: () => void;
}> = ({ isMobile, title, onOpenMenu }) => (
  <div className="thread-header">
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
      {isMobile && (
        <button type="button"
          onClick={onOpenMenu}
          aria-label="Open menu"
          className="icon-btn-circle" style={{ marginLeft: -8 }}
        >
          <Menu size={20} />
        </button>
      )}
      <h2 className="thread-header-title">{title || 'New Conversation'}</h2>
      <div className="row-flex-gap-6">
        <div className="pulse-dot" style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10B981' }} />
        Live
      </div>
    </div>
    <div className="thread-header-actions">
      {!isMobile && (
        <div className="row-flex-gap-6 thread-header-persona">
          <div style={{ width: '16px', height: '16px', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-tertiary))', borderRadius: '4px' }} />
          Persona Core
        </div>
      )}
      <button type="button" className="btn-ghost thread-header-more" aria-label="More options">
        <MoreHorizontal size={18} />
      </button>
    </div>
  </div>
);

export const Composer: React.FC<{
  isLoading: boolean;
  input: string;
  onInputChange: (v: string) => void;
  onSend: () => void;
}> = ({ isLoading, input, onInputChange, onSend }) => (
  <div className="composer-wrapper">
    <div className="glass-panel composer-bar">
      <button type="button"
        className="btn-ghost composer-attach"
        aria-label="Attach file"
      >
        <PaperclipIcon />
      </button>
      <textarea
        className="input-field composer-input"
        placeholder="Reply to agent..."
        aria-label="Reply to agent"
        value={input}
        onChange={e => onInputChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        rows={1}
        disabled={isLoading}
      />
      <button type="button"
        className="btn-primary send-btn"
        onClick={onSend}
        disabled={isLoading || !input.trim()}
        aria-label="Send message"
        style={{ opacity: (isLoading || !input.trim()) ? 0.5 : 1 }}
      >
        <SendIcon />
      </button>
    </div>
    <div className="composer-hints">
      <span>Toggle Train Mode (Ctrl+T)</span>
      <span>~ $0.02 cost</span>
    </div>
  </div>
);

const PaperclipIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

const SendIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);
