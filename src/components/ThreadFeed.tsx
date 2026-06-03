import React, { useRef, useEffect, useEffectEvent, useReducer } from 'react';
import { useNavigate } from 'react-router-dom';
import { ThreadHeader, Composer, MessageBubble, SkillInjection, PluginInjection, MessageReasoning, MessageTools } from './ThreadFeedParts';
import {
  buildSkillInvocation,
  skillWorkerUrl,
  type Skill,
} from '../lib/skills';
import { dispatchChatMessageBefore, summarizePluginHooks } from '../lib/plugins';

type SkillInjection = {
  skill: Skill;
  summary: string;
};

type PluginInjection = {
  results: { plugin: string; hook: string; handler: string; captured: boolean; detail?: string }[];
  summary: string;
};

interface MessageData {
  id: string;
  isUser: boolean;
  content: string;
  status?: string;
  reasoning?: string[];
  tools?: { name: string, icon: string }[];
  skillInjection?: SkillInjection;
  pluginInjection?: PluginInjection;
}

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

type ThreadState = { messages: MessageData[]; apiError: string | null };
type ThreadAction =
  | { type: 'setMessages'; value: MessageData[] }
  | { type: 'setApiError'; value: string | null }
  | { type: 'appendMessages'; value: MessageData[] }
  | { type: 'mapMessage'; id: string; patch: Partial<MessageData> };

const threadReducer = (state: ThreadState, action: ThreadAction): ThreadState => {
  switch (action.type) {
    case 'setMessages': return { ...state, messages: action.value };
    case 'setApiError': return { ...state, apiError: action.value };
    case 'appendMessages': return { ...state, messages: [...state.messages, ...action.value] };
    case 'mapMessage': return { ...state, messages: state.messages.map(m => m.id === action.id ? { ...m, ...action.patch } : m) };
    default: return state;
  }
};

const ThreadFeed: React.FC<ThreadFeedProps> = ({ threadId, initialPrompt, threadTitle, onOpenMenu, isMobile }) => {
  const [threadState, dispatchThread] = useReducer(threadReducer, { messages: [], apiError: null });
  const messages = threadState.messages;
  const apiError = threadState.apiError;
  const setMessages = (value: MessageData[] | ((prev: MessageData[]) => MessageData[])) => {
    if (typeof value === 'function') {
      dispatchThread({ type: 'setMessages', value: value(threadState.messages) });
    } else {
      dispatchThread({ type: 'setMessages', value });
    }
  };
  const setApiError = (value: string | null) => dispatchThread({ type: 'setApiError', value });
  const navigate = useNavigate();

  const inputRef = useRef<HTMLTextAreaElement>(null);

  const getInput = () => inputRef.current?.value ?? '';
  const handleInputChange = () => {
    const value = getInput();
    localStorage.setItem(`openthink_draft_input_${threadId}`, value);
  };
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isLoading = messages.some(m => !m.isUser && (m.status === 'Thinking...' || m.content === ''));

  useEffect(() => {
    const stored = localStorage.getItem(`openthink_draft_input_${threadId}`);
    if (stored && inputRef.current) {
      inputRef.current.value = stored;
    }
  }, [threadId]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadHistory = useEffectEvent(async () => {
    if (initialPrompt) return;
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

  const runSkill = async (userMsg: string, userMsgId: string): Promise<{ summary: string; skill: Skill } | null> => {
    const hookResults = await dispatchChatMessageBefore(userMsg, threadId);
    const summary = summarizePluginHooks(hookResults);
    if (summary) {
      setMessages(prev => prev.map(m =>
        m.id === userMsgId
          ? { ...m, pluginInjection: { results: hookResults, summary } }
          : m
      ));
    }
    const invocation = buildSkillInvocation(userMsg);
    if (!invocation) return null;
    const { skill, request } = invocation;
    setMessages(prev => prev.map(m =>
      m.id === userMsgId
        ? { ...m, skillInjection: { skill, summary: `Calling ${skill.workerEndpoint}…` } }
        : m
    ));
    try {
      const res = await fetch(skillWorkerUrl(skill, getApiUrl()), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: request.prompt, config: request.config, threadId }),
      });
      if (!res.ok) throw new Error(`Skill ${skill.id} responded ${res.status}`);
      const data = await res.json();
      const summary = summarizeSkillResult(skill, data);
      setMessages(prev => prev.map(m =>
        m.id === userMsgId
          ? { ...m, skillInjection: { skill, summary } }
          : m
      ));
      return { summary, skill };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setMessages(prev => prev.map(m =>
        m.id === userMsgId
          ? { ...m, skillInjection: { skill, summary: `Skill failed: ${reason}` } }
          : m
      ));
      return null;
    }
  };

  const handleSend = async (overrideInput?: string) => {
    const userMsg = overrideInput || getInput();
    if (!userMsg.trim() || isLoading) return;

    if (inputRef.current) inputRef.current.value = '';
    localStorage.removeItem(`openthink_draft_input_${threadId}`);

    const newMsgId = Date.now().toString();
    setMessages(prev => [...prev, { id: newMsgId, isUser: true, content: userMsg }]);

    const agentMsgId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, { id: agentMsgId, isUser: false, content: '', status: 'Thinking...' }]);

    try {
      setApiError(null);
      const skillResult = await runSkill(userMsg, newMsgId);
      const systemContext = skillResult
        ? `[Skill ${skillResult.skill.id} injected]\n${skillResult.summary}`
        : undefined;
      const activeModel = localStorage.getItem('openthink_active_model') || '@cf/meta/llama-3.1-8b-instruct';
      const response = await fetch(`${getApiUrl()}/api/thread/${threadId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userMsg, model: activeModel, system: systemContext })
      });

      if (!response.body) throw new Error('No readable stream');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const processChunk = (value: Uint8Array | undefined) => {
        if (!value) return;
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
      };
      const readNext = async (): Promise<boolean> => {
        const result = await reader.read();
        if (result.done) return false;
        processChunk(result.value);
        return true;
      };
      const drainStream = async () => {
        const keepReading = await readNext();
        if (keepReading) {
          await drainStream();
        }
      };
      await drainStream();
    } catch (error) {
      console.error(error);
      const errMsg = error instanceof Error ? error.message : String(error);
      setApiError(errMsg);
      setMessages(prev => prev.map(m =>
        m.id === agentMsgId ? { ...m, content: 'Error communicating with the agent.', status: undefined } : m
      ));
    } finally {
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
          <MessageBubble key={msg.id} isUser={msg.isUser} status={msg.status} content={msg.content}>
            {msg.skillInjection && <SkillInjection id={msg.skillInjection.skill.id} summary={msg.skillInjection.summary} />}
            {msg.pluginInjection && <PluginInjection summary={msg.pluginInjection.summary} />}
            {msg.reasoning && <MessageReasoning reasoning={msg.reasoning} />}
            {msg.tools && <MessageTools tools={msg.tools} />}
          </MessageBubble>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <Composer
        isLoading={isLoading}
        inputRef={inputRef}
        onInputChange={handleInputChange}
        onSend={() => handleSend()}
      />
    </div>
  );
};

const summarizeSkillResult = (skill: Skill, data: any): string => {
  if (!data || typeof data !== 'object') return 'returned no data';
  if (skill.id === 'gbrain-search') {
    const count = Array.isArray(data.results)
      ? data.results.length
      : Array.isArray(data)
        ? data.length
        : 0;
    return `injected ${count} ${count === 1 ? 'page' : 'pages'}`;
  }
  if (skill.id === 'gbrain-think') {
    const answer = typeof data.answer === 'string' ? data.answer : data.response;
    if (typeof answer === 'string') return `synthesis: ${answer.slice(0, 120)}${answer.length > 120 ? '…' : ''}`;
    return 'synthesis complete';
  }
  if (skill.id === 'gbrain-capture') {
    return data.slug ? `captured as ${data.slug}` : 'captured';
  }
  if (skill.id === 'gstack-run') {
    if (typeof data.task === 'string') return `ran ${data.task}`;
    if (typeof data.status === 'string') return `status: ${data.status}`;
    return 'execution complete';
  }
  if (skill.id === 'gbrain-evals') {
    return typeof data.scorecard === 'object' ? 'scorecard posted' : 'benchmark complete';
  }
  return 'complete';
};

export default ThreadFeed;
