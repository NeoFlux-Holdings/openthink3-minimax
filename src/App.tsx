import { useEffect, useReducer, useState, type Dispatch, type SetStateAction } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useParams } from 'react-router-dom';
import OAuthCallback from './components/OAuthCallback';
import { Cloud, ShieldCheck, Loader2 } from 'lucide-react';
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
import BenchmarksView from './pages/BenchmarksView';
import TunnelBridgePanel from './components/TunnelBridgePanel';
import GitHubAppPanel from './components/GitHubAppPanel';
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

type AppViewState = {
  isSidebarCollapsed: boolean;
  activeThreadId: string | null;
  initialPrompt: string | null;
  activeCanvasTab: CanvasTab;
  mobileDrawerOpen: boolean;
  mobileTab: MobileTab;
  mobileSummariesOpen: boolean;
  recentThreads: ThreadInfo[];
};

type AppViewAction =
  | { type: 'setIsSidebarCollapsed'; value: boolean | ((prev: boolean) => boolean) }
  | { type: 'setActiveThreadId'; value: string | null | ((prev: string | null) => string | null) }
  | { type: 'setInitialPrompt'; value: string | null | ((prev: string | null) => string | null) }
  | { type: 'setActiveCanvasTab'; value: CanvasTab | ((prev: CanvasTab) => CanvasTab) }
  | { type: 'setMobileDrawerOpen'; value: boolean | ((prev: boolean) => boolean) }
  | { type: 'setMobileTab'; value: MobileTab | ((prev: MobileTab) => MobileTab) }
  | { type: 'setMobileSummariesOpen'; value: boolean | ((prev: boolean) => boolean) }
  | { type: 'setRecentThreads'; value: ThreadInfo[] | ((prev: ThreadInfo[]) => ThreadInfo[]) };

const initAppViewState = (): AppViewState => ({
  isSidebarCollapsed: false,
  activeThreadId: localStorage.getItem('openthink_active_thread_id'),
  initialPrompt: null,
  activeCanvasTab: (localStorage.getItem('openthink_active_canvas_tab') as CanvasTab) || 'canvas',
  mobileDrawerOpen: false,
  mobileTab: 'chat',
  mobileSummariesOpen: false,
  recentThreads: (() => {
    try {
      const saved = localStorage.getItem('openthink_threads:v1');
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed;
      return [];
    } catch {
      return [];
    }
  })(),
});

const appViewReducer = (state: AppViewState, action: AppViewAction): AppViewState => {
  switch (action.type) {
    case 'setIsSidebarCollapsed':
      return {
        ...state,
        isSidebarCollapsed:
          typeof action.value === 'function' ? action.value(state.isSidebarCollapsed) : action.value,
      };
    case 'setActiveThreadId':
      return {
        ...state,
        activeThreadId:
          typeof action.value === 'function' ? action.value(state.activeThreadId) : action.value,
      };
    case 'setInitialPrompt':
      return {
        ...state,
        initialPrompt:
          typeof action.value === 'function' ? action.value(state.initialPrompt) : action.value,
      };
    case 'setActiveCanvasTab':
      return {
        ...state,
        activeCanvasTab:
          typeof action.value === 'function' ? action.value(state.activeCanvasTab) : action.value,
      };
    case 'setMobileDrawerOpen':
      return {
        ...state,
        mobileDrawerOpen:
          typeof action.value === 'function' ? action.value(state.mobileDrawerOpen) : action.value,
      };
    case 'setMobileTab':
      return {
        ...state,
        mobileTab:
          typeof action.value === 'function' ? action.value(state.mobileTab) : action.value,
      };
    case 'setMobileSummariesOpen':
      return {
        ...state,
        mobileSummariesOpen:
          typeof action.value === 'function' ? action.value(state.mobileSummariesOpen) : action.value,
      };
    case 'setRecentThreads':
      return {
        ...state,
        recentThreads:
          typeof action.value === 'function' ? action.value(state.recentThreads) : action.value,
      };
  }
};

const LoginGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const apiBase = typeof window !== 'undefined'
    ? (localStorage.getItem('openthink_api_url') || window.location.origin)
    : '';
  const [state, setState] = useState<'checking' | 'unauthenticated' | 'authenticated' | 'disabled'>('checking');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${apiBase}/api/auth/status`, { credentials: 'include' });
        if (cancelled) return;
        if (r.status === 404 || r.status === 405) {
          setState('disabled');
          return;
        }
        if (r.ok) {
          const j = await r.json();
          setState(j.authenticated ? 'authenticated' : 'unauthenticated');
        } else {
          setState('unauthenticated');
        }
      } catch {
        if (!cancelled) setState('unauthenticated');
      }
    })();
    return () => { cancelled = true; };
  }, [apiBase]);

  useEffect(() => {
    if (state !== 'unauthenticated') return;
    const onFocus = () => {
      fetch(`${apiBase}/api/auth/status`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : null)
        .then(j => { if (j?.authenticated) setState('authenticated'); })
        .catch(() => null);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [state, apiBase]);

  if (state === 'checking') {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-secondary)' }}>
          <Loader2 size={18} className="spin" /> Loading…
          <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }
  if (state === 'authenticated' || state === 'disabled') {
    return <>{children}</>;
  }

  const next = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/app';

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      background: 'var(--bg-primary)',
    }}>
      <div className="glass-card" style={{ maxWidth: '440px', width: '100%', padding: '32px', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
          <Cloud size={36} color="var(--accent-secondary)" />
        </div>
        <h2 style={{ fontSize: '1.5rem', margin: '0 0 8px', color: 'var(--text-primary)' }}>
          Sign in to continue
        </h2>
        <p style={{ color: 'var(--text-secondary)', margin: '0 0 24px', fontSize: '0.9rem' }}>
          This agent is private. Sign in with your Cloudflare account to access it.
        </p>
        <a
          href={`${apiBase}/auth/login?next=${encodeURIComponent(next)}`}
          className="btn btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '14px 24px', fontSize: '1rem', textDecoration: 'none' }}
        >
          <ShieldCheck size={18} /> Sign in with Cloudflare
        </a>
        <p style={{ marginTop: '20px', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
          You'll be redirected to dash.cloudflare.com to grant access.
        </p>
      </div>
    </div>
  );
};

const AppView = () => {
  const bp = useBreakpoint();
  const isMobile = bp === 'mobile';
  const [state, dispatch] = useReducer(appViewReducer, undefined, initAppViewState);
  const {
    isSidebarCollapsed,
    activeThreadId,
    initialPrompt,
    activeCanvasTab,
    mobileDrawerOpen,
    mobileTab,
    mobileSummariesOpen,
    recentThreads,
  } = state;

  const setIsSidebarCollapsed: Dispatch<SetStateAction<boolean>> = (v) =>
    dispatch({ type: 'setIsSidebarCollapsed', value: v });
  const setActiveThreadId: Dispatch<SetStateAction<string | null>> = (v) =>
    dispatch({ type: 'setActiveThreadId', value: v });
  const setInitialPrompt: Dispatch<SetStateAction<string | null>> = (v) =>
    dispatch({ type: 'setInitialPrompt', value: v });
  const setActiveCanvasTab: Dispatch<SetStateAction<CanvasTab>> = (v) =>
    dispatch({ type: 'setActiveCanvasTab', value: v });
  const setMobileDrawerOpen: Dispatch<SetStateAction<boolean>> = (v) =>
    dispatch({ type: 'setMobileDrawerOpen', value: v });
  const setMobileTab: Dispatch<SetStateAction<MobileTab>> = (v) =>
    dispatch({ type: 'setMobileTab', value: v });
  const setMobileSummariesOpen: Dispatch<SetStateAction<boolean>> = (v) =>
    dispatch({ type: 'setMobileSummariesOpen', value: v });
  const setRecentThreads: Dispatch<SetStateAction<ThreadInfo[]>> = (v) =>
    dispatch({ type: 'setRecentThreads', value: v });

  useEffect(() => {
    localStorage.setItem('openthink_threads:v1', JSON.stringify(recentThreads));
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
    <LoginGate>
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
        >
          <AccountHub isStandalone />
        </div>
      )}
    </LoginGate>
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
        <Route path="/oauth/callback" element={<OAuthCallback />} />
        <Route path="/app-account" element={<AccountHub isStandalone={true} />} />
        <Route path="/benchmarks" element={<BenchmarksView />} />
        <Route path="/bridge" element={<TunnelBridgePanel />} />
        <Route path="/github" element={<GitHubAppPanel />} />
        <Route path="/popout/:tab" element={<PopoutContainer />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
