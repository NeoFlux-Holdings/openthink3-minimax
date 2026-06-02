import React, { useState } from 'react';
import { Menu, Paperclip, Play, PenTool, Search, Image as ImageIcon, Globe, Mail } from 'lucide-react';
import type { ThreadInfo } from '../App';

interface HomeViewProps {
  onStartThread: (prompt: string) => void;
  recentThreads: ThreadInfo[];
  onSelectThread: (id: string) => void;
  onOpenMenu?: () => void;
  isMobile?: boolean;
}

const HomeView: React.FC<HomeViewProps> = ({ onStartThread, recentThreads, onSelectThread, onOpenMenu, isMobile }) => {
  const [taskMode, setTaskMode] = useState<'Auto' | 'Plan first' | 'Train'>('Auto');
  const [input, setInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      onStartThread(input);
    }
  };

  return (
    <div className="home-view" style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: isMobile ? 'flex-start' : 'center',
      padding: isMobile ? `calc(12px + var(--safe-top)) 16px 16px` : '40px',
      paddingTop: isMobile ? `calc(12px + var(--safe-top))` : '40px',
      overflowY: 'auto', WebkitOverflowScrolling: 'touch',
      position: 'relative',
    }}>

      {isMobile && (
        <button type="button"
          onClick={onOpenMenu}
          aria-label="Open menu"
          style={{
            position: 'absolute', top: 'calc(8px + var(--safe-top))', left: 8,
            width: 40, height: 40, borderRadius: '50%',
            background: 'transparent', border: 'none',
            color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', touchAction: 'manipulation',
          }}
        >
          <Menu size={20} />
        </button>
      )}

      <div style={{ maxWidth: '720px', width: '100%', display: 'flex', flexDirection: 'column', gap: isMobile ? '20px' : '32px' }}>

        <div style={{ textAlign: 'center' }}>
          <h1 style={{
            fontSize: isMobile ? '1.875rem' : '3rem', marginBottom: '8px',
            background: 'linear-gradient(to right, #fff, #A1A1AA)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            lineHeight: 1.15, padding: isMobile ? '0 8px' : 0,
          }}>
            What do you need done?
          </h1>
          <p style={{
            color: 'var(--text-secondary)',
            fontSize: isMobile ? '0.95rem' : '1.125rem',
            margin: 0, padding: isMobile ? '0 8px' : 0,
          }}>
            Persona agent ready. Start typing or use a template.
          </p>
        </div>

        <div className="glass-panel" style={{ padding: '4px', display: 'flex', flexDirection: 'column', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)' }}>
          <form onSubmit={handleSubmit} style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 12px 0' }}>
              <div style={{ display: 'flex', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-full)', padding: '4px' }}>
                {(['Auto', 'Plan first', 'Train'] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setTaskMode(mode)}
                    style={{
                      padding: '4px 12px', fontSize: '0.75rem', fontWeight: 600,
                      borderRadius: 'var(--radius-full)',
                      background: taskMode === mode ? 'var(--bg-primary)' : 'transparent',
                      color: taskMode === mode ? 'var(--text-primary)' : 'var(--text-secondary)',
                      boxShadow: taskMode === mode ? 'var(--shadow-sm)' : 'none',
                      transition: 'background ease 0.2s, color ease 0.2s, border-color ease 0.2s, transform ease 0.2s, opacity ease 0.2s, box-shadow ease 0.2s'
                    }}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            <textarea
              className="input-field"
              placeholder="Describe your task..."
              style={{
                background: 'transparent', border: 'none', boxShadow: 'none',
                minHeight: isMobile ? '100px' : '120px',
                fontSize: isMobile ? '1rem' : '1.125rem',
                padding: isMobile ? '14px 16px' : '16px 20px',
              }}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
            />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: isMobile ? '8px 12px 12px' : '12px 20px 16px' }}>
              <button type="button" className="btn btn-ghost" aria-label="Attach file" style={{ padding: '8px', minWidth: 40, minHeight: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Paperclip size={20} />
              </button>

              <button type="submit" className="btn btn-primary" style={{ borderRadius: 'var(--radius-full)', padding: isMobile ? '10px 18px' : '10px 24px', minHeight: 44 }} disabled={!input.trim()}>
                Start <Play size={16} fill="currentColor" />
              </button>
            </div>
          </form>
        </div>

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
          <QuickAction icon={<PenTool size={16} />} label="Write something" onClick={() => setInput("Write a draft about... ")} />
          <QuickAction icon={<Search size={16} />} label="Research a topic" onClick={() => setInput("Research the topic of... ")} />
          <QuickAction icon={<ImageIcon size={16} />} label="Generate images" onClick={() => setInput("Generate an image of... ")} />
          <QuickAction icon={<Globe size={16} />} label="Browse & summarize" onClick={() => setInput("Summarize the website at https://...")} />
          <QuickAction icon={<Mail size={16} />} label="Draft an email" onClick={() => setInput("Draft an email to... ")} />
        </div>

        {recentThreads.length > 0 && (
          <div style={{ marginTop: '48px' }}>
            <h3 style={{ fontSize: '1rem', color: 'var(--text-secondary)', marginBottom: '16px', paddingLeft: '8px' }}>Recent threads</h3>
            <div className="home-recent-threads" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
              {recentThreads.map(thread => (
                <div
                  key={thread.id}
                  onClick={() => onSelectThread(thread.id)}
                  className="glass-panel thread-card"
                  role="button"
                  tabIndex={0}
                  style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', cursor: 'pointer', transition: 'transform 0.2s, border-color 0.2s', minHeight: 64 }}
                >
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <ImageIcon size={20} color="var(--text-tertiary)" />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h4 style={{ fontSize: '0.875rem', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{thread.title}</h4>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', margin: 0 }}>{thread.updatedAt}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const QuickAction = ({ icon, label, onClick }: { icon: React.ReactNode, label: string, onClick: () => void }) => (
  <button type="button"
    onClick={onClick}
    className="quick-action"
    style={{
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '10px 16px', background: 'rgba(255, 255, 255, 0.05)',
      border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-full)',
      fontSize: '0.875rem', color: 'var(--text-secondary)',
      transition: 'background ease 0.2s, color ease 0.2s, border-color ease 0.2s, transform ease 0.2s, opacity ease 0.2s, box-shadow ease 0.2s', minHeight: 44,
      cursor: 'pointer', touchAction: 'manipulation',
    }}
  >
    {icon} {label}
  </button>
);

export default HomeView;
