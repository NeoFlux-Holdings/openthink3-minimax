import React, { useState, useEffect } from 'react';
import { Plus, Search, Library, Brain, Zap, Settings, HelpCircle, MessageSquare, Pin, ExternalLink, User, Monitor } from 'lucide-react';
import type { ThreadInfo } from '../App';

interface SidebarProps {
  isCollapsed: boolean;
  toggleSidebar: () => void;
  onNewTask: () => void;
  recentThreads: ThreadInfo[];
  onSelectThread: (id: string) => void;
  activeThreadId: string | null;
  activeCanvasTab?: 'canvas' | 'pierre' | 'harness' | 'library' | 'learning' | 'skills' | 'settings' | 'account' | 'desktop';
  onSelectCanvasTab?: (tab: 'canvas' | 'pierre' | 'harness' | 'library' | 'learning' | 'skills' | 'settings' | 'account' | 'desktop') => void;
  /** When true, render as a mobile drawer with adapted styles. */
  isMobileDrawer?: boolean;
  onCloseDrawer?: () => void;
  /** Mobile-only: open the Pinned Summaries panel in an in-app sheet. */
  onOpenPinnedSummaries?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  isCollapsed,
  onNewTask,
  recentThreads,
  onSelectThread,
  activeThreadId,
  activeCanvasTab = 'canvas',
  onSelectCanvasTab,
  isMobileDrawer = false,
  onCloseDrawer,
  onOpenPinnedSummaries,
}) => {
  const [isSummariesExpanded, setIsSummariesExpanded] = useState(true);
  const [isSummariesPoppedOut, setIsSummariesPoppedOut] = useState(() => {
    return localStorage.getItem('openthink_popout_summaries') === 'true';
  });

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'openthink_popout_summaries') {
        setIsSummariesPoppedOut(e.newValue === 'true');
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const handlePopOutSummaries = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isMobileDrawer && onOpenPinnedSummaries) {
      onOpenPinnedSummaries();
      return;
    }
    setIsSummariesPoppedOut(true);
    localStorage.setItem('openthink_popout_summaries', 'true');
    const popout = window.open(
      '/popout/summaries',
      'OpenThinkPopout_summaries',
      'width=400,height=550,menubar=no,status=no,toolbar=no'
    );
    if (popout) {
      const interval = setInterval(() => {
        if (popout.closed) {
          clearInterval(interval);
          setIsSummariesPoppedOut(false);
          localStorage.setItem('openthink_popout_summaries', 'false');
        }
      }, 1000);
    }
  };

  const handleDockSummaries = () => {
    setIsSummariesPoppedOut(false);
    localStorage.setItem('openthink_popout_summaries', 'false');
  };

  return (
    <div
      className={`sidebar ${isCollapsed && !isMobileDrawer ? 'collapsed' : ''}`}
      style={{
        width: isMobileDrawer ? '100%' : (isCollapsed ? 0 : 'var(--sidebar-width)'),
        transition: 'transform 0.3s, opacity 0.3s',
      }}
    >
      {(!isCollapsed || isMobileDrawer) && (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>

          {isMobileDrawer && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 8px 16px', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-tertiary))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Brain size={18} color="white" />
                </div>
                <span style={{ fontSize: '1.05rem', fontWeight: 700, letterSpacing: '-0.01em' }}>OpenThink</span>
              </div>
              {onCloseDrawer && (
                <button type="button"
                  onClick={onCloseDrawer}
                  aria-label="Close menu"
                  className="icon-btn-min-square icon-btn-circle--square-pad"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              )}
            </div>
          )}

          <button type="button" className="btn btn-primary" onClick={onNewTask} style={{ width: '100%', marginBottom: '24px', justifyContent: 'flex-start', minHeight: 44 }}>
            <Plus size={18} /> <span className="sidebar-label">New Task</span>
          </button>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '24px' }}>
            <SidebarItem icon={<Search size={18} />} label="Search" isActive={false} onClick={() => onSelectCanvasTab?.('library')} />
            <SidebarItem icon={<Library size={18} />} label="Library" isActive={activeCanvasTab === 'library'} onClick={() => onSelectCanvasTab?.('library')} />
            <SidebarItem icon={<Brain size={18} />} label="Learning" badge="3" isActive={activeCanvasTab === 'learning'} onClick={() => onSelectCanvasTab?.('learning')} />
            <SidebarItem icon={<Zap size={18} />} label="Skills" isActive={activeCanvasTab === 'skills'} onClick={() => onSelectCanvasTab?.('skills')} />
            <SidebarItem icon={<Monitor size={18} />} label="Desktop Remote" isActive={activeCanvasTab === 'desktop'} onClick={() => onSelectCanvasTab?.('desktop')} />
          </div>

          <div style={{ height: '1px', background: 'var(--border-subtle)', margin: '0 8px 16px' }} />

          {/* Pinned Summaries Collapsible & Pop-out Section */}
          <div style={{ marginBottom: '24px' }}>
            <div className="section-label--sticky">
              <button
                type="button"
                aria-expanded={isSummariesExpanded}
                onClick={() => setIsSummariesExpanded(v => !v)}
                onFocus={e => { (e.currentTarget.parentElement as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
                onBlur={e => { (e.currentTarget.parentElement as HTMLElement).style.background = 'transparent'; }}
                className="row-flex-gap-6"
              >
                <Pin size={12} />
                <span>Pinned Summaries</span>
                <span style={{ marginLeft: 'auto' }}>{isSummariesExpanded ? '▼' : '▶'}</span>
              </button>
              {!isSummariesPoppedOut && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handlePopOutSummaries(e as unknown as React.MouseEvent); }}
                  aria-label="Pop out pinned summaries"
                  className="row-icon-text--pop"
                >
                  <ExternalLink size={10} />
                </button>
              )}
            </div>

            {isSummariesExpanded && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '4px' }}>
                {isSummariesPoppedOut ? (
                  <div style={{ padding: '8px', fontSize: '0.75rem', color: 'var(--text-tertiary)', textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: '4px' }}>
                    Popped out to window
                    <button type="button" onClick={handleDockSummaries} style={{ display: 'block', color: 'var(--accent-primary)', margin: '4px auto 0', textDecoration: 'underline' }}>
                      Dock back
                    </button>
                  </div>
                ) : (
                  <>
                    <SidebarItem
                      icon={<Pin size={12} />}
                      label="Orange Core Spec"
                      isSub={true}
                      onClick={() => handlePopOutSummaries({ stopPropagation: () => {} } as React.MouseEvent)}
                    />
                    <SidebarItem
                      icon={<Pin size={12} />}
                      label="Convex Tunnel Tasks"
                      isSub={true}
                      onClick={() => handlePopOutSummaries({ stopPropagation: () => {} } as React.MouseEvent)}
                    />
                  </>
                )}
              </div>
            )}
          </div>

          <div style={{ height: '1px', background: 'var(--border-subtle)', margin: '0 8px 16px' }} />

          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-tertiary)', letterSpacing: '0.05em', marginBottom: '8px', paddingLeft: '8px', fontWeight: 600 }}>Recent Threads</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {recentThreads.map(thread => (
                <SidebarItem 
                  key={thread.id}
                  icon={<MessageSquare size={14} />} 
                  label={thread.title} 
                  isSub={true} 
                  isActive={thread.id === activeThreadId}
                  onClick={() => onSelectThread(thread.id)}
                />
              ))}
            </div>
          </div>

          <div style={{ height: '1px', background: 'var(--border-subtle)', margin: '16px 8px' }} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <SidebarItem icon={<User size={18} />} label="Account" isActive={activeCanvasTab === 'account'} onClick={() => onSelectCanvasTab?.('account')} />
            <SidebarItem icon={<Settings size={18} />} label="Settings" isActive={activeCanvasTab === 'settings'} onClick={() => onSelectCanvasTab?.('settings')} />
            <SidebarItem icon={<HelpCircle size={18} />} label="Help" isActive={false} onClick={() => onSelectCanvasTab?.('learning')} />
          </div>
        </div>
      )}
    </div>
  );
};

const SidebarItem = ({ icon, label, badge, isSub = false, isActive = false, onClick }: { icon: React.ReactNode, label: string, badge?: string, isSub?: boolean, isActive?: boolean, onClick?: () => void }) => (
  <button type="button"
    onClick={onClick}
    className="sidebar-item"
    data-active={isActive ? 'true' : undefined}
  >
    <div className="row-flex-gap-12">
      <span style={{ color: isActive ? 'var(--accent-primary)' : isSub ? 'var(--text-tertiary)' : 'inherit', display: 'flex', alignItems: 'center', flexShrink: 0 }}>{icon}</span>
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>{label}</span>
    </div>
    {badge && (
      <span style={{
        background: 'var(--accent-primary)', color: 'white', fontSize: '0.75rem',
        fontWeight: 'bold', padding: '2px 6px', borderRadius: 'var(--radius-full)'
      }}>{badge}</span>
    )}
  </button>
);

export default Sidebar;
