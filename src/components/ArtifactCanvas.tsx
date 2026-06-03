import {
  FileText, GitBranch, Cpu, ExternalLink, Dock, Brain, Zap, Settings,
  ToggleLeft, ToggleRight, Check, Save, User, Monitor, Library
} from 'lucide-react';
import PierrePanel from './PierrePanel';
import HarnessPanel from './HarnessPanel';
import CanvasPanel from './CanvasPanel';
import AccountHub from './AccountHub';
import DesktopRemotePanel from './DesktopRemotePanel';

import React, { useState, useEffect, useReducer } from 'react';

const DEFAULT_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const ACTIVE_MODEL_KEY = 'openthink_active_model';
const THEME_KEY = 'openthink_theme';

interface ArtifactCanvasProps {
  activeCanvasTab?: 'canvas' | 'pierre' | 'harness' | 'library' | 'learning' | 'skills' | 'settings' | 'account' | 'desktop';
  setActiveCanvasTab?: (tab: 'canvas' | 'pierre' | 'harness' | 'library' | 'learning' | 'skills' | 'settings' | 'account' | 'desktop') => void;
  isMobile?: boolean;
}

const ArtifactCanvas: React.FC<ArtifactCanvasProps> = ({ activeCanvasTab, setActiveCanvasTab, isMobile = false }) => {
  const [localActiveTab, setLocalActiveTab] = useState<'canvas' | 'pierre' | 'harness' | 'library' | 'learning' | 'skills' | 'settings' | 'account' | 'desktop'>('canvas');
  
  const activeTab = activeCanvasTab || localActiveTab;
  const setActiveTab = setActiveCanvasTab || setLocalActiveTab;

  // Track popped-out state
  const [poppedOutTabs, setPoppedOutTabs] = useState<Record<string, boolean>>({
    canvas: false,
    pierre: false,
    harness: false,
    library: false,
    learning: false,
    skills: false,
    settings: false,
    account: false,
    desktop: false
  });

  // Track the active model globally synced via localStorage
  const [selectedModel, setSelectedModel] = useState(() => {
    const stored = localStorage.getItem(ACTIVE_MODEL_KEY);
    if (!stored) localStorage.setItem(ACTIVE_MODEL_KEY, DEFAULT_MODEL);
    return stored || DEFAULT_MODEL;
  });

  useEffect(() => {
    if (!localStorage.getItem(ACTIVE_MODEL_KEY)) {
      localStorage.setItem(ACTIVE_MODEL_KEY, DEFAULT_MODEL);
      window.dispatchEvent(new Event('storage'));
    }

    // Sync popped out state from localStorage across windows
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'openthink_active_model' && e.newValue) {
        setSelectedModel(e.newValue);
      }
      if (e.key?.startsWith('openthink_popout_')) {
        const tab = e.key.replace('openthink_popout_', '');
        setPoppedOutTabs(prev => ({
          ...prev,
          [tab]: e.newValue === 'true'
        }));
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const handlePopOut = (tab: 'canvas' | 'pierre' | 'harness' | 'library' | 'learning' | 'skills' | 'settings' | 'account' | 'desktop') => {
    if (isMobile) {
      // On mobile, pop-out is just a no-op; the panel is already full-screen.
      // The user can use the in-app nav (tab bar / drawer) instead.
      return;
    }
    setPoppedOutTabs(prev => ({ ...prev, [tab]: true }));
    localStorage.setItem(`openthink_popout_${tab}`, 'true');

    // Open standalone popout window
    const popoutWindow = window.open(
      `/popout/${tab}`,
      `OpenThinkPopout_${tab}`,
      `width=450,height=750,menubar=no,status=no,toolbar=no`
    );

    // Watch for window close to automatically dock back
    if (popoutWindow) {
      const checkClosed = setInterval(() => {
        if (popoutWindow.closed) {
          clearInterval(checkClosed);
          handleDock(tab);
        }
      }, 1000);
    }
  };


  const handleDock = (tab: 'canvas' | 'pierre' | 'harness' | 'library' | 'learning' | 'skills' | 'settings' | 'account' | 'desktop') => {
    setPoppedOutTabs(prev => ({ ...prev, [tab]: false }));
    localStorage.setItem(`openthink_popout_${tab}`, 'false');
  };

  const handleModelChange = (model: string) => {
    setSelectedModel(model);
    localStorage.setItem(ACTIVE_MODEL_KEY, model);
    // Dispatches a storage event for popped out windows
    window.dispatchEvent(new Event('storage'));
  };

  return (
    <div className="artifact-canvas" style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
      
      {/* Canvas Top Bar - Tab Selectors */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: isMobile ? '12px' : '24px' }}>
        <div
          className="glass-panel"
          style={{
            display: 'flex',
            padding: '4px',
            gap: '2px',
            borderRadius: 'var(--radius-full)',
            flexWrap: 'wrap',
            justifyContent: 'center',
            maxWidth: '100%',
          }}
        >
          <IconButton icon={<FileText size={16} />} active={activeTab === 'canvas'} onClick={() => setActiveTab('canvas')} ariaLabel="Canvas" />
          <IconButton icon={<GitBranch size={16} />} active={activeTab === 'pierre'} onClick={() => setActiveTab('pierre')} ariaLabel="Git & Environment" />
          <IconButton icon={<Cpu size={16} />} active={activeTab === 'harness'} onClick={() => setActiveTab('harness')} ariaLabel="Model Harness" />
          <IconButton icon={<Library size={16} />} active={activeTab === 'library'} onClick={() => setActiveTab('library')} ariaLabel="Library" />
          <IconButton icon={<Brain size={16} />} active={activeTab === 'learning'} onClick={() => setActiveTab('learning')} ariaLabel="Learning" />
          <IconButton icon={<Zap size={16} />} active={activeTab === 'skills'} onClick={() => setActiveTab('skills')} ariaLabel="Skills" />
          <IconButton icon={<Monitor size={16} />} active={activeTab === 'desktop'} onClick={() => setActiveTab('desktop')} ariaLabel="Desktop Remote" />
          <IconButton icon={<Settings size={16} />} active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} ariaLabel="Settings" />
          <IconButton icon={<User size={16} />} active={activeTab === 'account'} onClick={() => setActiveTab('account')} ariaLabel="Account" />
        </div>
      </div>

      {/* Main Window */}
      <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', overflow: 'hidden', boxShadow: 'var(--shadow-md)' }}>
        
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <div className="row-flex-gap-12">
            {activeTab === 'canvas' && (
              <>
                <FileText size={16} color="var(--accent-secondary)" />
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Workspace Intel</span>
              </>
            )}
            {activeTab === 'pierre' && (
              <>
                <GitBranch size={16} color="var(--accent-primary)" />
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Git & Environment Manager</span>
              </>
            )}
            {activeTab === 'harness' && (
              <>
                <Cpu size={16} color="var(--accent-tertiary)" />
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Model Harness Settings</span>
              </>
            )}
            {activeTab === 'library' && (
              <>
                <FileText size={16} color="var(--accent-secondary)" />
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Workspace Prompt Library</span>
              </>
            )}
            {activeTab === 'learning' && (
              <>
                <Brain size={16} color="var(--accent-primary)" />
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Orange Academy Guides</span>
              </>
            )}
            {activeTab === 'skills' && (
              <>
                <Zap size={16} color="var(--accent-tertiary)" />
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Orchestrated Skills Manager</span>
              </>
            )}
            {activeTab === 'settings' && (
              <>
                <Settings size={16} color="var(--text-secondary)" />
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Harness Preferences</span>
              </>
            )}
            {activeTab === 'account' && (
              <>
                <User size={16} color="var(--accent-primary)" />
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Workspace Account Hub</span>
              </>
            )}
            {activeTab === 'desktop' && (
              <>
                <Monitor size={16} color="var(--accent-primary)" />
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Desktop Remote Workspace</span>
              </>
            )}
          </div>
          
          <div style={{ display: 'flex', gap: '8px' }}>
            {!poppedOutTabs[activeTab] && !isMobile && (
              <IconButton icon={<ExternalLink size={14} />} onClick={() => handlePopOut(activeTab)} ariaLabel="Pop out to window" />
            )}
          </div>
        </div>

        {/* Dynamic Content Panel */}
        <div style={{ padding: '24px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {poppedOutTabs[activeTab] ? (
            <div style={{ margin: 'auto', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
              <div className="artifact-icon-tile">
                <ExternalLink size={24} />
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                This panel is popped out to a separate window.
              </div>
              <button type="button" className="btn btn-primary" onClick={() => handleDock(activeTab)} style={{ gap: '8px', fontSize: '0.8rem', padding: '8px 16px', borderRadius: 'var(--radius-full)' }}>
                <Dock size={14} /> Dock Window Back
              </button>
            </div>
          ) : (
            <>
              {activeTab === 'canvas' && <CanvasPanel />}
              {activeTab === 'pierre' && <PierrePanel />}
              {activeTab === 'harness' && <HarnessPanel selectedModel={selectedModel} onModelChange={handleModelChange} />}
              {activeTab === 'library' && <LibraryPanel />}
              {activeTab === 'learning' && <LearningPanel />}
              {activeTab === 'skills' && <SkillsPanel />}
              {activeTab === 'settings' && <SettingsPanel />}
              {activeTab === 'account' && <AccountHub />}
              {activeTab === 'desktop' && <DesktopRemotePanel />}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const IconButton = ({ icon, active = false, onClick, ariaLabel }: { icon: React.ReactNode, active?: boolean, onClick?: () => void, ariaLabel?: string }) => (
  <button type="button"
    onClick={onClick}
    aria-label={ariaLabel}
    className="canvas-icon-btn"
    data-active={active}
  >
    {icon}
  </button>
);

/* ==========================================================================
   Library Subpanel - Prompt library that fills Chat box
   ========================================================================== */
const LIBRARY_PROMPTS = [
  {
    title: "Analyze stackedbranch diffs",
    text: "Compare feat/agent-orange-evolution staging with local worktree and identify uncommitted hotspots."
  },
  {
    title: "Configure Cloudflare Paid AI plans",
    text: "Explain how to set up the paid wrangler bindings and credential tokens for Workers AI routing."
  },
  {
    title: "Verify Convex internal tunnels",
    text: "Generate audit logs for convex.openthink.internal to verify sub-5ms latency configurations."
  }
];

function fillPromptIntoComposer(text: string) {
  const textarea = document.querySelector('textarea.input-field') as HTMLTextAreaElement | null;
  if (textarea) {
    textarea.value = text;
    const event = new Event('input', { bubbles: true });
    textarea.dispatchEvent(event);
    textarea.focus();
  } else {
    alert(`Prompt copied to clipboard:\n"${text}"`);
    navigator.clipboard.writeText(text);
  }
}

const LibraryPanel = () => {
  const prompts = LIBRARY_PROMPTS;
  const handleFill = fillPromptIntoComposer;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', color: 'var(--text-secondary)' }}>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', lineHeight: 1.4, margin: 0 }}>
        Select a preset workspace prompt template to fill your composer instantly:
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {prompts.map((p) => (
          <button
            type="button"
            key={p.title}
            onClick={() => handleFill(p.text)}
            className="glass-panel glass-card glass-card--clickable"
            onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent-secondary)'; e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
            onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.06)'; e.currentTarget.style.background = 'rgba(36,36,36,0.3)'; }}
            onMouseOver={e => { e.currentTarget.style.borderColor = 'var(--accent-secondary)'; e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
            onMouseOut={e => { e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.06)'; e.currentTarget.style.background = 'rgba(36,36,36,0.3)'; }}
          >
            <h5 style={{ margin: '0 0 6px', color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 600 }}>{p.title}</h5>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', margin: 0, lineHeight: 1.3 }}>"{p.text}"</p>
          </button>
        ))}
      </div>
    </div>
  );
};

/* ==========================================================================
   Learning Subpanel - Interactive Guide
   ========================================================================== */
const LEARNING_SLIDES = [
  {
    title: "Cloudflare Edge GPU Nodes",
    content: "Workers AI automatically routes requests to global edge clusters with GPUs geographically closest to you, reducing roundtrip latency from 300ms to sub-80ms."
  },
  {
    title: "SQLite in Durable Objects",
    content: "OpenThink anchors state directly in Durable Objects. DOs are transactional state-bound entities with standard high-performance SQLite engines running locally on the edge node."
  },
  {
    title: "Stacked branch structures",
    content: "By stacking commit structures instead of pushing raw branches directly to master, you maintain clean incremental staging environments where modifications stay isolated."
  }
];

const LearningPanel = () => {
  const [slide, setSlide] = useState(0);
  const slides = LEARNING_SLIDES;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', color: 'var(--text-secondary)' }}>
      <div className="glass-panel glass-card glass-card--tall">
        <div>
          <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--accent-primary)', fontWeight: 700 }}>Orange Academy • Slide {slide + 1}/3</span>
          <h4 style={{ margin: '8px 0 12px', color: 'var(--text-primary)', fontSize: '1rem' }}>{slides[slide].title}</h4>
          <p style={{ fontSize: '0.8rem', lineHeight: 1.5, color: 'var(--text-secondary)' }}>{slides[slide].content}</p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px', gap: '10px' }}>
          <button type="button"
            className="btn btn-ghost"
            disabled={slide === 0}
            onClick={() => setSlide(s => s - 1)}
            style={{ padding: '6px 12px', fontSize: '0.75rem', color: slide === 0 ? 'var(--text-tertiary)' : 'var(--text-primary)' }}
          >
            Previous
          </button>
          <button type="button"
            className="btn btn-primary"
            disabled={slide === slides.length - 1}
            onClick={() => setSlide(s => s + 1)}
            style={{ padding: '6px 16px', fontSize: '0.75rem', borderRadius: 'var(--radius-full)' }}
          >
            Next Lesson
          </button>
        </div>
      </div>
    </div>
  );
};

/* ==========================================================================
   Skills Subpanel - Registered MCP Tools
   ========================================================================== */
const SkillsPanel = () => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', color: 'var(--text-secondary)' }}>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', lineHeight: 1.4, margin: 0 }}>
        Active Model Context Protocol (MCP) clients and Cognitive skills consolidated by Agent Orange 0.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <SkillCard name="check_context" desc="Live orchestrator tool. Surfaces cross-thread context from KV (thread:* and memory:* keys)." status="live" />
        <SkillCard name="git_branch_stack" desc="Stacked branch environments. Registers a DO-backed git tool that tracks diff structures across feature stacks." status="planned" />
        <SkillCard name="eval_runner" desc="POST /api/eval/run streams scorecards from exe.dev gbrain-evals runner into KV." status="live" />
        <SkillCard name="plugin_registry" desc="Community plugins fetched from a URL and persisted in plugins:registry KV key." status="live" />
      </div>
    </div>
  );
};

const SkillCard = ({ name, desc, status = 'live' }: { name: string, desc: string, status?: 'live' | 'planned' }) => (
  <div className="glass-panel glass-card glass-card--md">
    <div style={{ flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>{name}</span>
        <span style={{ background: 'rgba(16,185,129,0.1)', color: '#10B981', padding: '2px 6px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>mcp</span>
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', lineHeight: 1.3 }}>{desc}</div>
    </div>
    <div className="row-flex-gap-6">
      <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: status === 'live' ? '#10B981' : 'var(--text-tertiary)', boxShadow: status === 'live' ? '0 0 6px #10B981' : 'none' }} />
      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{status === 'live' ? 'Live' : 'Planned'}</span>
    </div>
  </div>
);

/* ==========================================================================
   Settings Subpanel - HUD switches & Credentials
   ========================================================================== */
type SettingsState = {
  hudActive: boolean;
  premiumActive: boolean;
  theme: string;
  token: string;
  saved: boolean;
};

type SettingsAction =
  | { type: 'SET_HUD_ACTIVE'; value: boolean }
  | { type: 'SET_PREMIUM_ACTIVE'; value: boolean }
  | { type: 'SET_THEME'; value: string }
  | { type: 'SET_TOKEN'; value: string }
  | { type: 'SET_SAVED'; value: boolean };

function settingsReducer(state: SettingsState, action: SettingsAction): SettingsState {
  switch (action.type) {
    case 'SET_HUD_ACTIVE':
      return { ...state, hudActive: action.value };
    case 'SET_PREMIUM_ACTIVE':
      return { ...state, premiumActive: action.value };
    case 'SET_THEME':
      return { ...state, theme: action.value };
    case 'SET_TOKEN':
      return { ...state, token: action.value };
    case 'SET_SAVED':
      return { ...state, saved: action.value };
  }
}

const SettingsPanel = () => {
  const [state, dispatch] = useReducer(settingsReducer, undefined, () => ({
    hudActive: true,
    premiumActive: true,
    theme: localStorage.getItem(THEME_KEY) || 'dark',
    token: 'cf_ai_••••••••••••••••••••••••',
    saved: false,
  }));
  const { hudActive, premiumActive, theme, token, saved } = state;
  const setHudActive     = (value: boolean) => dispatch({ type: 'SET_HUD_ACTIVE', value });
  const setPremiumActive = (value: boolean) => dispatch({ type: 'SET_PREMIUM_ACTIVE', value });
  const setTheme         = (value: string) => dispatch({ type: 'SET_THEME', value });
  const setToken         = (value: string) => dispatch({ type: 'SET_TOKEN', value });
  const setSaved         = (value: boolean) => dispatch({ type: 'SET_SAVED', value });

  const handleSave = () => {
    localStorage.setItem(THEME_KEY, theme);
    document.body.className = `theme-${theme}`;
    window.dispatchEvent(new Event('storage'));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', color: 'var(--text-secondary)' }}>
      <div className="glass-panel" style={{ padding: '16px', borderRadius: '8px', background: 'rgba(36,36,36,0.3)' }}>
        <h4 style={{ margin: '0 0 12px', color: 'var(--text-primary)', fontSize: '0.95rem' }}>Cloudflare Credentials</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <label htmlFor="cf-api-token" style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>Cloudflare Paid API Token</label>
          <input 
            id="cf-api-token"
            type="password" 
            value={token} 
            onChange={e => setToken(e.target.value)} 
            className="input-field" 
            style={{ fontSize: '0.8rem', padding: '8px 10px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }} 
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px' }}>
            <span style={{ fontSize: '0.8rem' }}>Enable Premium Workers AI Routing</span>
            <button type="button" onClick={() => setPremiumActive(!premiumActive)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: premiumActive ? 'var(--accent-primary)' : 'var(--text-tertiary)', display: 'flex', alignItems: 'center' }}>
              {premiumActive ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
            </button>
          </div>
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '16px', borderRadius: '8px', background: 'rgba(36,36,36,0.3)' }}>
        <h4 style={{ margin: '0 0 12px', color: 'var(--text-primary)', fontSize: '0.95rem' }}>Workspace Preferences</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.8rem' }}>Interactive HUD Latency Overlay</span>
            <button type="button" onClick={() => setHudActive(!hudActive)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: hudActive ? 'var(--accent-primary)' : 'var(--text-tertiary)', display: 'flex', alignItems: 'center' }}>
              {hudActive ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
            </button>
          </div>
          <div className="row-flex-between-gap-12">
            <span style={{ fontSize: '0.8rem', flex: 1 }}>Selected Color Theme</span>
            <select
              value={theme}
              onChange={e => setTheme(e.target.value)}
              style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)', borderRadius: '4px', padding: '4px 8px', color: 'var(--text-primary)', fontSize: '0.8rem' }}
            >
              <option value="dark">Solar Obsidian Dark</option>
              <option value="neon">Neon Cyberpunk Blur</option>
              <option value="light">Crisp Luxury Editorial</option>
              <option value="accessible">Stark Accessible High-Contrast</option>
            </select>
          </div>
        </div>
      </div>

      <button type="button" className="btn btn-primary" onClick={handleSave} style={{ width: '100%', padding: '10px', fontSize: '0.85rem', borderRadius: '6px', gap: '8px' }}>
        {saved ? <Check size={14} color="#10B981" /> : <Save size={14} />}
        {saved ? 'Settings Saved Successfully' : 'Save Harness Settings'}
      </button>
    </div>
  );
};

export default ArtifactCanvas;
