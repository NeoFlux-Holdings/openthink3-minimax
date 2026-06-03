import React from 'react';
import { Menu, MoreHorizontal, Globe, CheckCircle2, ChevronRight, Sparkles, Puzzle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

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
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onInputChange: () => void;
  onSend: () => void;
}> = ({ isLoading, inputRef, onInputChange, onSend }) => (
  <div className="composer-wrapper">
    <div className="glass-panel composer-bar">
      <button type="button"
        className="btn-ghost composer-attach"
        aria-label="Attach file"
      >
        <PaperclipIcon />
      </button>
      <textarea
        ref={inputRef}
        className="input-field composer-input"
        placeholder="Reply to agent..."
        aria-label="Reply to agent"
        onChange={onInputChange}
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
        disabled={isLoading}
        aria-label="Send message"
        style={{ opacity: isLoading ? 0.5 : 1 }}
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

export const MessageBubble: React.FC<{
  isUser: boolean;
  content: string;
  status?: string;
  children?: React.ReactNode;
}> = ({ isUser, content, children, status }) => (
  <div style={{ display: 'flex', gap: '16px', maxWidth: '85%', alignSelf: isUser ? 'flex-end' : 'flex-start' }}>
    {!isUser && (
      <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-tertiary))', flexShrink: 0 }} />
    )}
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%' }}>
      {status && (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
          <div className="pulse-dot" style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent-secondary)' }} />
          {status}
        </div>
      )}
      <div
        className="thread-feed-message message-bubble" data-user={isUser}
      >
        {isUser ? content : <ReactMarkdown>{content}</ReactMarkdown>}
      </div>
      {children}
    </div>
  </div>
);

export const ToolChip: React.FC<{ icon: React.ReactNode; label: string }> = ({ icon, label }) => (
  <div className="pill-clickable">
    {icon} {label}
  </div>
);

export const SkillInjection: React.FC<{ id: string; summary: string }> = ({ id, summary }) => (
  <div className="skill-injection">
    <Sparkles size={12} />
    {id} · {summary}
  </div>
);

export const PluginInjection: React.FC<{ summary: string }> = ({ summary }) => (
  <div className="plugin-injection">
    <Puzzle size={12} />
    plugin hooks · {summary}
  </div>
);

export const MessageReasoning: React.FC<{ reasoning: string[] }> = ({ reasoning }) => (
  <details className="thread-reasoning">
    <summary className="thread-reasoning-summary">
      <ChevronRight size={16} /> Reasoned
    </summary>
    <div className="thread-reasoning-body">
      {reasoning.map((r) => <div key={r}>{r}</div>)}
    </div>
  </details>
);

export const MessageTools: React.FC<{ tools: { name: string; icon: string }[] }> = ({ tools }) => (
  <div className="thread-tools">
    {tools.map((t) => (
      <ToolChip
        key={t.name}
        icon={t.icon === 'globe' ? <Globe size={14} /> : <CheckCircle2 size={14} color="#10B981" />}
        label={t.name}
      />
    ))}
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
