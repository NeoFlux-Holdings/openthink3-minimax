import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { Pin } from 'lucide-react';
import Sidebar from './components/Sidebar';
import HomeView from './components/HomeView';
import ThreadFeed from './components/ThreadFeed';
import ArtifactCanvas from './components/ArtifactCanvas';
import MarketingView from './components/MarketingView';
import DeployFlow from './components/DeployFlow';
import PierrePanel from './components/PierrePanel';
import HarnessPanel from './components/HarnessPanel';
import PinnedSummariesPanel from './components/PinnedSummariesPanel';
import CanvasPanel from './components/CanvasPanel';
import ErrorBoundary from './components/ErrorBoundary';
import AccountHub from './components/AccountHub';
import DesktopRemotePanel from './components/DesktopRemotePanel';
import { SideDrawer } from './components/SideDrawer';
import { BottomTabBar, type MobileTab } from './components/BottomTabBar';
import { MobileSheet } from './components/MobileSheet';
import { useBreakpoint } from './hooks/useMediaQuery';

export interface ThreadInfo {
  id: string;
  title: string;
  updatedAt: string;
}

export type CanvasTab = 'canvas' | 'pierre' | 'harness' | 'library' | 'learning' | 'skills' | 'settings' | 'account' | 'desktop';

const AppView = () => {
  const bp = useBreakpoint();
  const isMobile = bp === 'mobile';
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(() => {
    return localStorage.getItem('openthink_active_thread_id');
  });
  const [initialPrompt, setInitialPrompt] = useState<string | null>(null);
  const [activeCanvasTab, setActiveCanvasTab] = useState<CanvasTab>(() => {
    return (localStorage.getItem('openthink_active_canvas_tab') as CanvasTab) || 'canvas';
  });
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat');
  const [mobileSummariesOpen, setMobileSummariesOpen] = useState(false);

  const [recentThreads, setRecentThreads] = useState<ThreadInfo[]>(() => {
    try {
      const saved = localStorage.getItem('openthink_threads');
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object' && parsed.__v === 1 && Array.isArray(parsed.data)) {
        return parsed.data;
      }
      return [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem('openthink_threads', JSON.stringify({ __v: 1, data: recentThreads }));
  }, [recentThreads]);

  useEffect(() => {
    const savedTheme = localStorage.getItem('openthink_theme') || 'dark';
    document.body.className = `theme-${savedTheme}`;

    const handleThemeStorage = (e: StorageEvent) => {
      if (e.key === 'openthink_theme' && e.newValue) {
        document.body.className = `theme-${e.newValue}`;
      }
    };
    window.addEventListener('storage', handleThemeStorage);
    return () => window.removeEventListener('storage', handleThemeStorage);
  }, []);

  const toggleSidebar = () => setIsSidebarCollapsed(!isSidebarCollapsed);

  const handleStartThread = (prompt: string) => {
    const newId = 'thread-' + Date.now();
    setRecentThreads(prev => [{ id: newId, title: prompt.slice(0, 20) + '...', updatedAt: 'Just now' }, ...prev]);
    setInitialPrompt(prompt);
    setActiveThreadId(newId);
    setMobileTab('chat');
    localStorage.setItem('openthink_active_thread_id', newId);
  };

  const handleNewTask = () => {
    setActiveThreadId(null);
    setInitialPrompt(null);
    setMobileTab('chat');
    setMobileDrawerOpen(false);
    localStorage.removeItem('openthink_active_thread_id');
  };

  const handleSelectThread = (id: string) => {
    setActiveThreadId(id);
    setInitialPrompt(null);
    setMobileTab('chat');
    setMobileDrawerOpen(false);
    localStorage.setItem('openthink_active_thread_id', id);
  };

  const handleSelectTab = (tab: CanvasTab) => {
    setActiveCanvasTab(tab);
    localStorage.setItem('openthink_active_canvas_tab', tab);
    if (isMobile) {
      // Sync the mobile tab so the bottom-nav active state and fullscreen
      // pane switching (account/canvas) follow whatever the drawer picked.
      if (tab === 'account') {
        setMobileTab('account');
      } else if (tab === 'harness' || tab === 'pierre') {
        setMobileTab('tools');
      } else {
        setMobileTab('canvas');
      }
    }
  };

  const handleMobileTabChange = (tab: MobileTab) => {
    setMobileTab(tab);
    if (tab === 'canvas') {
      if (activeCanvasTab === 'account' || activeCanvasTab === 'settings') {
        setActiveCanvasTab('canvas');
        localStorage.setItem('openthink_active_canvas_tab', 'canvas');
      }
    } else if (tab === 'account') {
      setActiveCanvasTab('account');
      localStorage.setItem('openthink_active_canvas_tab', 'account');
    } else if (tab === 'tools') {
      setActiveCanvasTab('harness');
      localStorage.setItem('openthink_active_canvas_tab', 'harness');
    } else if (tab === 'chat') {
      // Just ensure thread view
      if (activeCanvasTab === 'account') {
        setActiveCanvasTab('canvas');
        localStorage.setItem('openthink_active_canvas_tab', 'canvas');
      }
    }
  };

  // Derive the root className for CSS pane switching on mobile
  let rootClass = 'app-container';
  if (isMobile && !activeThreadId) {
    rootClass += ' app-mobile-home-open';
  } else if (isMobile && (activeCanvasTab === 'account' || mobileTab === 'account')) {
    rootClass += ' app-mobile-account-open';
  } else if (isMobile && (mobileTab === 'canvas' || mobileTab === 'tools')) {
    rootClass += ' app-mobile-canvas-open';
  }

  const sidebarProps = {
    isCollapsed: isSidebarCollapsed,
    toggleSidebar,
    onNewTask: handleNewTask,
    recentThreads,
    onSelectThread: handleSelectThread,
    activeThreadId,
    activeCanvasTab,
    onSelectCanvasTab: handleSelectTab,
  };

  return (
    <>
      <div className={rootClass}>
        {!isMobile && (
          <Sidebar {...sidebarProps} />
        )}

        {activeThreadId ? (
          <>
            <ErrorBoundary fallbackName="Chat Thread Feed">
              <ThreadFeed
                key={activeThreadId}
                threadId={activeThreadId}
                initialPrompt={initialPrompt}
                threadTitle={recentThreads.find(t => t.id === activeThreadId)?.title}
                onOpenMenu={() => setMobileDrawerOpen(true)}
                isMobile={isMobile}
              />
            </ErrorBoundary>
            <ErrorBoundary fallbackName="Intel Artifact Canvas">
              <ArtifactCanvas
                activeCanvasTab={activeCanvasTab}
                setActiveCanvasTab={handleSelectTab}
                isMobile={isMobile}
              />
            </ErrorBoundary>
          </>
        ) : (
          <HomeView
            onStartThread={handleStartThread}
            recentThreads={recentThreads}
            onSelectThread={handleSelectThread}
            onOpenMenu={() => setMobileDrawerOpen(true)}
            isMobile={isMobile}
          />
        )}
      </div>

      {isMobile && (
        <BottomTabBar
          active={mobileTab}
          onChange={handleMobileTabChange}
          onNewThread={handleNewTask}
          onOpenMenu={() => setMobileDrawerOpen(true)}
        />
      )}

      {isMobile && (
        <SideDrawer
          open={mobileDrawerOpen}
          onClose={() => setMobileDrawerOpen(false)}
          ariaLabel="Workspace navigation"
        >
          <Sidebar
            {...sidebarProps}
            isMobileDrawer
            onCloseDrawer={() => setMobileDrawerOpen(false)}
            onOpenPinnedSummaries={() => {
              setMobileDrawerOpen(false);
              setMobileSummariesOpen(true);
            }}
          />
        </SideDrawer>
      )}

      {isMobile && (
        <MobileSheet
          open={mobileSummariesOpen}
          onClose={() => setMobileSummariesOpen(false)}
          title="Pinned Summaries"
          icon={<Pin size={20} color="white" />}
        >
          <PinnedSummariesPanel onClose={() => setMobileSummariesOpen(false)} />
        </MobileSheet>
      )}

      {/* Mobile-only fullscreen panes (sibling of .app-container so they
          bypass the CSS rules that hide .thread-feed and .artifact-canvas
          when an .app-mobile-*-open modifier is active). */}
      {isMobile && mobileTab === 'account' && (
        <div
          className="mobile-fullscreen-pane"
          style={{
            position: 'fixed', inset: 0, zIndex: 150,
            background: 'var(--bg-primary)',
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'calc(var(--mobile-bottom-bar) + env(safe-area-inset-bottom))',
            overflowY: 'auto', WebkitOverflowScrolling: 'touch',
          }}
        >
          <AccountHub isStandalone />
        </div>
      )}
    </>
  );
};

const PopoutContainer = () => {
  const { tab } = useParams<{ tab: string }>();

  switch (tab) {
    case 'canvas':
      return <CanvasPanel isPoppedOut={true} />;
    case 'pierre':
      return <PierrePanel isPoppedOut={true} />;
    case 'harness':
      return <HarnessPanel isPoppedOut={true} />;
    case 'summaries':
      return <PinnedSummariesPanel isPoppedOut={true} />;
    case 'account':
      return <AccountHub />;
    case 'desktop':
      return <div style={{ background: 'var(--bg-primary)', minHeight: '100vh', padding: '24px', overflowY: 'auto' }}><DesktopRemotePanel /></div>;
    default:
      return (
        <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', background: 'var(--bg-primary)' }}>
          Invalid Popout Window Session.
        </div>
      );
  }
};

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<MarketingView />} />
        <Route path="/deploy" element={<DeployFlow />} />
        <Route path="/app" element={<AppView />} />
        <Route path="/app-account" element={<AccountHub isStandalone={true} />} />
        <Route path="/popout/:tab" element={<PopoutContainer />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
