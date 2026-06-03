import React, { useState, useRef, useEffect, useEffectEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { Menu, MoreHorizontal, Paperclip, Send, ChevronRight, Globe, CheckCircle2 } from 'lucide-react';

const getApiUrl = () => {
  const custom = localStorage.getItem('openthink_api_url');
  if (custom) return custom.endsWith('/') ? custom.slice(0, -1) : custom;

  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://127.0.0.1:8787';
  }
  return 'https://openthink3-worker.thomas-zarebczan.workers.dev';
};

interface ThreadFeedProps {
  threadId: string;
  initialPrompt?: string | null;
  threadTitle?: string;
  onOpenMenu?: () => void;
  isMobile?: boolean;
}

interface MessageData {
  id: string;
  isUser: boolean;
  content: string;
  status?: string;
  reasoning?: string[];
  tools?: { name: string, icon: string }[];
}

const ThreadFeed: React.FC<ThreadFeedProps> = ({ threadId, initialPrompt, threadTitle, onOpenMenu, isMobile }) => {
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const navigate = useNavigate();

  const [input, setInput] = useState(() => {
    return localStorage.getItem(`openthink_draft_input_${threadId}`) || '';
  });

  const handleInputChange = (value: string) => {
    setInput(value);
    localStorage.setItem(`openthink_draft_input_${threadId}`, value);
  };
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadHistory = useEffectEvent(async () => {
    if (initialPrompt) return;
    try {
      setIsLoading(true);
      setApiError(null);
      const response = await fetch(`${getApiUrl()}/api/thread/${threadId}/history`);
      if (response.ok) {
        const data = await response.json();
        if (data.messages && Array.isArray(data.messages)) {
          const mapped = data.messages.map((m: any, index: number) => ({
            id: `history-${index}-${Date.now()}`,
            isUser: m.role === 'user',
            content: m.content
          }));
          setMessages(mapped);
        }
      } else {
        setApiError(`HTTP ${response.status} ${response.statusText}`);
      }
    } catch (err) {
      console.error("Failed to load thread history:", err);
      setApiError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  });

  useEffect(() => {
    loadHistory();
  }, [threadId]);

  const initialPromptSent = useRef(false);
  const onInitialPrompt = useEffectEvent((p: string) => {
    if (initialPromptSent.current) return;
    initialPromptSent.current = true;
    void handleSend(p);
  });

  useEffect(() => {
    if (initialPrompt) onInitialPrompt(initialPrompt);
  }, [initialPrompt]);

  const handleSend = async (overrideInput?: string) => {
    const userMsg = overrideInput || input;
    if (!userMsg.trim() || isLoading) return;
    
    setInput('');
    localStorage.removeItem(`openthink_draft_input_${threadId}`);
    setIsLoading(true);

    const newMsgId = Date.now().toString();
    setMessages(prev => [...prev, { id: newMsgId, isUser: true, content: userMsg }]);

    const agentMsgId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, { id: agentMsgId, isUser: false, content: '', status: 'Thinking...' }]);

    try {
      setApiError(null);
      const activeModel = localStorage.getItem('openthink_active_model') || '@cf/meta/llama-3.1-8b-instruct';
      const response = await fetch(`${getApiUrl()}/api/thread/${threadId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userMsg, model: activeModel })
      });

      if (!response.body) throw new Error('No readable stream');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let done = false;
      let buffer = "";
      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          const parts = buffer.split("\n");
          buffer = parts.pop() ?? "";
          for (const rawLine of parts) {
            const line = rawLine.trim();
            if (!line.startsWith('data: ')) continue;
            if (line === 'data: [DONE]') continue;
            try {
              const data = JSON.parse(line.slice(6));

              if (data.status) {
                setMessages(prev => prev.map(m =>
                  m.id === agentMsgId ? { ...m, status: data.status } : m
                ));
              }

              if (data.response) {
                setMessages(prev => prev.map(m =>
                  m.id === agentMsgId ? { ...m, content: m.content + data.response, status: undefined } : m
                ));
              }
            } catch (e) {
              // Ignore JSON parse errors on incomplete lines
            }
          }
        }
      }
    } catch (error) {
      console.error(error);
      const errMsg = error instanceof Error ? error.message : String(error);
      setApiError(errMsg);
      setMessages(prev => prev.map(m => 
        m.id === agentMsgId ? { ...m, content: 'Error communicating with the agent.', status: undefined } : m
      ));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="thread-feed">
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: isMobile ? '12px 16px' : '16px 24px',
        paddingTop: isMobile ? 'calc(12px + var(--safe-top))' : '16px 24px',
        borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-primary)', zIndex: 10,
        minHeight: 'var(--header-height)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
          {isMobile && (
            <button type="button"
              onClick={onOpenMenu}
              aria-label="Open menu"
              style={{
                width: 40, height: 40, borderRadius: '50%',
                background: 'transparent', border: 'none',
                color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', touchAction: 'manipulation', marginLeft: -8, flexShrink: 0,
              }}
            >
              <Menu size={20} />
            </button>
          )}
          <h2 style={{
            fontSize: isMobile ? '0.95rem' : '1rem', margin: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            minWidth: 0, flex: 1,
          }}>{threadTitle || 'New Conversation'}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(16, 185, 129, 0.1)', color: '#10B981', padding: '2px 8px', borderRadius: 'var(--radius-full)', fontSize: '0.75rem', fontWeight: 600, flexShrink: 0 }}>
            <div className="pulse-dot" style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10B981' }} />
            Live
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '8px' : '16px' }}>
          {!isMobile && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '16px', height: '16px', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-tertiary))', borderRadius: '4px' }} />
              Persona Core
            </div>
          )}
          <button type="button" className="btn-ghost" style={{ padding: '4px', minWidth: 36, minHeight: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-label="More options">
            <MoreHorizontal size={18} />
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: isMobile ? '16px' : '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: isMobile ? '16px' : '24px',
        WebkitOverflowScrolling: 'touch',
        overscrollBehavior: 'contain',
      }}>
        
        {apiError && (
          <div className="glass-panel fade-in" style={{ padding: '24px', borderRadius: '12px', boxShadow: 'inset 4px 0 0 0 var(--accent-secondary)', background: 'rgba(239, 68, 68, 0.04)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <h3 style={{ fontSize: '1.15rem', color: 'var(--text-primary)', margin: '0 0 8px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                ⚠️ Cloudflare Agent Offline
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.5, margin: 0 }}>
                Failed to connect to your live agent backend at <code style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '4px', fontFamily: 'monospace' }}>{getApiUrl()}</code>.
              </p>
              <p style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem', marginTop: '6px', margin: 0 }}>
                Error details: <code style={{ color: 'var(--accent-secondary)' }}>{apiError}</code>
              </p>
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button type="button" 
                className="btn btn-primary" 
                onClick={() => navigate('/deploy')}
                style={{ padding: '8px 16px', fontSize: '0.85rem' }}
              >
                Go to Deploy Wizard
              </button>
              <button type="button" 
                className="btn btn-ghost" 
                onClick={() => {
                  localStorage.removeItem('openthink_api_url');
                  localStorage.removeItem('openthink_custom_domain');
                  setApiError(null);
                  window.location.reload();
                }}
                style={{ padding: '8px 16px', fontSize: '0.85rem', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)', borderRadius: '6px' }}
              >
                Reset to Localhost (8787)
              </button>
              <button type="button" 
                className="btn btn-ghost" 
                onClick={() => {
                  setApiError(null);
                  window.dispatchEvent(new Event('storage'));
                }}
                style={{ padding: '8px 16px', fontSize: '0.85rem', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}
              >
                Retry Connection
              </button>
            </div>
          </div>
        )}

        {messages.length === 0 && !isLoading && !apiError && (
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-tertiary))', margin: '0 auto 16px', opacity: 0.5 }} />
            Start typing below to begin the conversation.
          </div>
        )}

        {messages.map(msg => (
          <Message key={msg.id} isUser={msg.isUser} status={msg.status} content={msg.content}>
            {msg.reasoning && (
              <details style={{ background: 'var(--bg-elevated)', padding: '12px', borderRadius: 'var(--radius-md)', marginTop: '12px', fontSize: '0.875rem' }}>
                <summary style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text-secondary)', userSelect: 'none' }}>
                  <ChevronRight size={16} /> Reasoned
                </summary>
                <div style={{ padding: '8px 0 0 24px', color: 'var(--text-tertiary)' }}>
                  {msg.reasoning.map((r) => <div key={r}>{r}</div>)}
                </div>
              </details>
            )}

            {msg.tools && (
              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                {msg.tools.map((t) => (
                  <ToolChip key={t.name} icon={t.icon === 'globe' ? <Globe size={14} /> : <CheckCircle2 size={14} color="#10B981" />} label={t.name} />
                ))}
              </div>
            )}
          </Message>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <div style={{
        padding: isMobile ? '12px 12px calc(12px + var(--safe-bottom))' : '24px',
        paddingBottom: isMobile ? 'calc(12px + var(--safe-bottom))' : '24px',
        background: 'linear-gradient(to top, var(--bg-primary) 80%, transparent)',
      }}>
        <div className="glass-panel" style={{ display: 'flex', alignItems: 'flex-end', padding: isMobile ? '8px' : '12px', gap: isMobile ? '8px' : '12px', borderRadius: 'var(--radius-lg)' }}>
          <button type="button"
            className="btn-ghost"
            aria-label="Attach file"
            style={{ padding: '8px', marginBottom: '4px', minWidth: 40, minHeight: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <Paperclip size={20} />
          </button>
          <textarea
            className="input-field"
            placeholder="Reply to agent..."
            aria-label="Reply to agent"
            value={input}
            onChange={e => handleInputChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            style={{ minHeight: '44px', padding: '10px 14px', background: 'var(--bg-tertiary)', border: 'none', resize: 'none' }}
            rows={1}
            disabled={isLoading}
          />
          <button type="button"
            className="btn-primary"
            onClick={() => handleSend()}
            disabled={isLoading || !input.trim()}
            aria-label="Send message"
            style={{ padding: '10px', borderRadius: 'var(--radius-md)', marginBottom: '4px', minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: (isLoading || !input.trim()) ? 0.5 : 1 }}
          >
            <Send size={18} />
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '8px', gap: '16px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>Toggle Train Mode (Ctrl+T)</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>~ $0.02 cost</span>
        </div>
      </div>
    </div>
  );
};

const Message = ({ isUser, content, children, status }: { isUser: boolean, content: string, children?: React.ReactNode, status?: string }) => (
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
        className="thread-feed-message"
        style={{
          background: isUser ? 'var(--bg-elevated)' : 'transparent',
          padding: isUser ? '12px 16px' : '0',
          borderRadius: 'var(--radius-md)',
          fontSize: '0.9375rem',
          lineHeight: 1.6,
          color: 'var(--text-primary)',
          wordBreak: 'break-word',
          overflowWrap: 'anywhere',
          minWidth: 0,
        }}
      >
        {isUser ? content : <ReactMarkdown>{content}</ReactMarkdown>}
      </div>
      {children}
    </div>
  </div>
);

const ToolChip = ({ icon, label }: { icon: React.ReactNode, label: string }) => (
  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-full)', border: '1px solid var(--border-subtle)', fontSize: '0.75rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
    {icon} {label}
  </div>
);

export default ThreadFeed;
