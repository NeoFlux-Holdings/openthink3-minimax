import React, { useState, useRef, useEffect, useEffectEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { ChevronRight, Globe, CheckCircle2 } from 'lucide-react';
import { ThreadHeader, Composer } from './ThreadFeedParts';

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
  const [pendingCount, setPendingCount] = useState(0);
  const isLoading = pendingCount > 0;
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadHistory = useEffectEvent(async () => {
    if (initialPrompt) return;
    setPendingCount(c => c + 1);
    setApiError(null);
    try {
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
      setPendingCount(c => c - 1);
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
    onInitialPrompt(initialPrompt ?? '');
  }, [initialPrompt]);

  const handleSend = async (overrideInput?: string) => {
    const userMsg = overrideInput || input;
    if (!userMsg.trim() || isLoading) return;

    setInput('');
    localStorage.removeItem(`openthink_draft_input_${threadId}`);
    setPendingCount(c => c + 1);

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
      setPendingCount(c => c - 1);
    }
  };

  return (
    <div className="thread-feed">
      <ThreadHeader isMobile={isMobile} title={threadTitle || 'New Conversation'} onOpenMenu={onOpenMenu} />

      <div className="thread-messages">
        {apiError && (
          <div className="glass-panel fade-in thread-error-banner">
            <div>
              <h3 className="thread-error-title">
                ⚠️ Cloudflare Agent Offline
              </h3>
              <p className="thread-error-text">
                Failed to connect to your live agent backend at <code className="thread-error-code">{getApiUrl()}</code>.
              </p>
              <p className="thread-error-detail">
                Error details: <code className="thread-error-code-accent">{apiError}</code>
              </p>
            </div>
            <div className="thread-error-actions">
              <button type="button"
                className="btn btn-primary thread-error-btn"
                onClick={() => navigate('/deploy')}
              >
                Go to Deploy Wizard
              </button>
              <button type="button"
                className="btn btn-ghost thread-error-btn"
                onClick={() => {
                  localStorage.removeItem('openthink_api_url');
                  localStorage.removeItem('openthink_custom_domain');
                  setApiError(null);
                  window.location.reload();
                }}
              >
                Reset to Localhost (8787)
              </button>
              <button type="button"
                className="btn btn-ghost thread-error-btn"
                onClick={() => {
                  setApiError(null);
                  window.dispatchEvent(new Event('storage'));
                }}
              >
                Retry Connection
              </button>
            </div>
          </div>
        )}

        {messages.length === 0 && !isLoading && !apiError && (
          <div className="thread-empty">
            <div className="thread-empty-icon" />
            Start typing below to begin the conversation.
          </div>
        )}

        {messages.map(msg => (
          <Message key={msg.id} isUser={msg.isUser} status={msg.status} content={msg.content}>
            {msg.reasoning && (
              <details className="thread-reasoning">
                <summary className="thread-reasoning-summary">
                  <ChevronRight size={16} /> Reasoned
                </summary>
                <div className="thread-reasoning-body">
                  {msg.reasoning.map((r) => <div key={r}>{r}</div>)}
                </div>
              </details>
            )}

            {msg.tools && (
              <div className="thread-tools">
                {msg.tools.map((t) => (
                  <ToolChip key={t.name} icon={t.icon === 'globe' ? <Globe size={14} /> : <CheckCircle2 size={14} color="#10B981" />} label={t.name} />
                ))}
              </div>
            )}
          </Message>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <Composer
        isLoading={isLoading}
        input={input}
        onInputChange={handleInputChange}
        onSend={() => handleSend()}
      />
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
        className="thread-feed-message message-bubble" data-user={isUser}
      >
        {isUser ? content : <ReactMarkdown>{content}</ReactMarkdown>}
      </div>
      {children}
    </div>
  </div>
);

const ToolChip = ({ icon, label }: { icon: React.ReactNode, label: string }) => (
  <div className="pill-clickable">
    {icon} {label}
  </div>
);

export default ThreadFeed;
