import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Paperclip, Play, PenTool, Search, Image as ImageIcon, Globe, Mail, FileText, Sparkles, BarChart2, ArrowRight } from 'lucide-react';
import type { ThreadInfo } from '../App';
import TunnelBridgePanel from './TunnelBridgePanel';

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
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      onStartThread(input);
    }
  };

  return (
    <div className="home-view">

      {isMobile && (
        <button type="button"
          onClick={onOpenMenu}
          aria-label="Open menu"
          className="icon-btn-circle"
        >
          <Menu size={20} />
        </button>
      )}

      <div style={{ maxWidth: '760px', width: '100%', display: 'flex', flexDirection: 'column', gap: isMobile ? '20px' : '28px' }}>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div className="hero-eyebrow">
            <span className="status-dot status-dot--live idle-pulse" style={{ width: 5, height: 5 }} />
            agent online · brain synced
          </div>
          <h1 className="hero-title">
            What do you need <span className="accent">done</span>?
          </h1>
          <p className="hero-sub">
            A persistent brain with skills, a knowledge graph, and execution. Tell it what to do; it picks the path.
          </p>

          <div className="hero-stats">
            <div className="hero-stat">
              <span className="hero-stat__value accent">42<span className="unit">skills</span></span>
              <span className="hero-stat__label">loaded</span>
            </div>
            <div className="hero-stat">
              <span className="hero-stat__value">146,646<span className="unit">pg</span></span>
              <span className="hero-stat__label">brain</span>
            </div>
            <div className="hero-stat">
              <span className="hero-stat__value">P@5 49.1<span className="unit">%</span></span>
              <span className="hero-stat__label">retrieval</span>
            </div>
            <div className="hero-stat">
              <span className="hero-stat__value">R@5 97.9<span className="unit">%</span></span>
              <span className="hero-stat__label">recall</span>
            </div>
          </div>
        </div>

        <div className="cmd-palette">
          <div className="cmd-palette-header">
            <span className="dot-r" /><span className="dot-y" /><span className="dot-g" />
            <span className="title">openthink3 · prompt</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <span style={{ color: 'var(--accent-primary)' }}>●</span>
              <span>{taskMode}</span>
            </div>
          </div>
          <form onSubmit={handleSubmit} className="cmd-palette-body">
            <textarea
              className="cmd-palette-textarea"
              placeholder="> describe the task. Enter to send, Shift+Enter for newline."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              aria-label="Describe your task"
            />
            <div className="cmd-palette-footer">
              <div className="cmd-mode-tabs">
                {(['Auto', 'Plan first', 'Train'] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setTaskMode(mode)}
                    className="cmd-mode-tab"
                    data-active={taskMode === mode}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <div className="hint home-attach-wrap">
                <button type="button" className="home-icon-btn" aria-label="Attach file">
                  <Paperclip size={16} />
                </button>
                <button type="submit" className="cmd-send" disabled={!input.trim()}>
                  <Play size={12} fill="currentColor" /> send
                </button>
              </div>
            </div>
          </form>
        </div>

        <div className="action-tiles">
          <button type="button" className="action-tile" onClick={() => setInput("Write a draft about... ")}>
            <span className="icon"><PenTool size={16} /></span> Write something
          </button>
          <button type="button" className="action-tile" onClick={() => setInput("Research the topic of... ")}>
            <span className="icon"><Search size={16} /></span> Research a topic
          </button>
          <button type="button" className="action-tile" onClick={() => setInput("Generate an image of... ")}>
            <span className="icon"><ImageIcon size={16} /></span> Generate images
          </button>
          <button type="button" className="action-tile" onClick={() => setInput("Summarize the website at https://...")}>
            <span className="icon"><Globe size={16} /></span> Browse &amp; summarize
          </button>
          <button type="button" className="action-tile" onClick={() => setInput("Draft an email to... ")}>
            <span className="icon"><Mail size={16} /></span> Draft an email
          </button>
          <button type="button" className="action-tile" onClick={() => setInput("Ingest this into the brain: ")}>
            <span className="icon"><FileText size={16} /></span> Ingest content
          </button>
          <button type="button" className="action-tile" onClick={() => setInput("Brainstorm 5 ideas for: ")}>
            <span className="icon"><Sparkles size={16} /></span> Brainstorm
          </button>
        </div>

        <button
          type="button"
          className="glass-card glass-card--md glass-card--clickable"
          onClick={() => navigate('/benchmarks')}
          style={{ width: '100%' }}
          aria-label="Open Benchmarks dashboard"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(59,130,246,0.15))',
                border: '1px solid rgba(16,185,129,0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#10B981',
                flexShrink: 0,
              }}
            >
              <BarChart2 size={18} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', textAlign: 'left' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Benchmarks
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                gbrain-evals scorecard · live /api/benchmarks
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-primary)', fontSize: '0.75rem', fontWeight: 600 }}>
            <span>Open</span>
            <ArrowRight size={14} />
          </div>
        </button>

        <div className="home-bridge-section">
          <TunnelBridgePanel />
        </div>

        {recentThreads.length > 0 && (
          <div className="home-recent-list">
            <div className="sidebar-section-label home-recent-section-label">Recent threads</div>
            <div className="home-recent-grid">
              {recentThreads.slice(0, 6).map(thread => (
                <button
                  type="button"
                  key={thread.id}
                  onClick={() => onSelectThread(thread.id)}
                  className="home-recent-card"
                >
                  <div className="status-dot status-dot--off" style={{ background: 'var(--accent-primary)', opacity: 0.6, boxShadow: 'none' }} />
                  <div className="home-recent-card__body">
                    <h4 className="home-recent-card__title">{thread.title}</h4>
                    <p className="home-recent-card__meta">{thread.updatedAt}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="status-bar home-status-bar">
        <div className="status-bar__group">
          <span className="status-dot status-dot--live" />
          <span>v0.40.7.0</span>
        </div>
        <span className="status-bar__sep">|</span>
        <div className="status-bar__group">
          <span>brain</span><span className="status-bar__value">146,646pg</span>
        </div>
        <span className="status-bar__sep">|</span>
        <div className="status-bar__group">
          <span>skills</span><span className="status-bar__value">42</span>
        </div>
        <span className="status-bar__sep">|</span>
        <div className="status-bar__group">
          <span>cf</span><span className="status-bar__value" style={{ color: '#10B981' }}>connected</span>
        </div>
        <div style={{ flex: 1 }} />
        <div className="status-bar__group">
          <span>esc to close</span>
        </div>
      </div>
    </div>
  );
};

export default HomeView;
