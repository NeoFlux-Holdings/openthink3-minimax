import React, { useState, useEffect } from 'react';
import { Cpu, DollarSign, Activity, Shield, Brain, BarChart2, Puzzle, Dock } from 'lucide-react';
import BrainPanel from './BrainPanel';
import BenchmarkPanel from './BenchmarkPanel';
import PluginPanel from './PluginPanel';

interface HarnessPanelProps {
  isPoppedOut?: boolean;
  selectedModel?: string;
  onModelChange?: (model: string) => void;
}

type Tab = 'harness' | 'brain' | 'evals' | 'plugins';

const HARNESS_TABS: { id: Tab; label: string; icon: React.ReactNode; color?: string }[] = [
  { id: 'harness', label: 'Harness', icon: React.createElement(Cpu, { size: 13 }) },
  { id: 'brain', label: 'Brain', icon: React.createElement(Brain, { size: 13 }), color: '#8B5CF6' },
  { id: 'evals', label: 'Evals', icon: React.createElement(BarChart2, { size: 13 }), color: '#10B981' },
  { id: 'plugins', label: 'Plugins', icon: React.createElement(Puzzle, { size: 13 }), color: '#F59E0B' },
];

const premiumModels = [
  {
    id: '@cf/meta/llama-3.1-8b-instruct',
    name: 'Llama 3.1 8B',
    tag: 'Edge Default',
    desc: 'Sub-100ms edge inference via Cloudflare Workers AI. Balanced speed and quality for daily threads.',
    latency: '85ms',
    gradient: 'linear-gradient(135deg, rgba(249, 115, 22, 0.15), rgba(236, 72, 153, 0.15))'
  },
  {
    id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    name: 'Llama 3.3 70B',
    tag: 'Deep Logic',
    desc: 'Advanced reasoning, logic puzzles, and complex orchestrations.',
    latency: '158ms',
    gradient: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(147, 51, 234, 0.15))'
  },
  {
    id: '@cf/deepseek/deepseek-r1-distill-qwen-32b',
    name: 'DeepSeek R1 32B',
    tag: 'Reasoning Core',
    desc: 'Distilled algorithmic logic, advanced math, and structured coding.',
    latency: '184ms',
    gradient: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(59, 130, 246, 0.15))'
  },
  {
    id: '@cf/qwen/qwen1.5-110b-chat',
    name: 'Qwen 1.5 110B',
    tag: 'Ultra Intelligence',
    desc: 'Maximum context parameters for high fidelity multilingual pipelines.',
    latency: '228ms',
    gradient: 'linear-gradient(135deg, rgba(236, 72, 153, 0.15), rgba(249, 115, 22, 0.15))'
  }
];

const HarnessPanel: React.FC<HarnessPanelProps> = ({ isPoppedOut = false, selectedModel: propsModel, onModelChange }) => {
  const [activeTab, setActiveTab] = useState<Tab>('harness');
  const [localModel, setLocalModel] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('openthink_active_model');
      if (saved && saved !== '@cf/meta/llama-3.1-8b-instruct') {
        return saved;
      }
      localStorage.setItem('openthink_active_model', '@cf/meta/llama-3.1-8b-instruct');
      return '@cf/meta/llama-3.1-8b-instruct';
    } catch {
      return '@cf/meta/llama-3.1-8b-instruct';
    }
  });

  // Use state synced with parent if provided
  const activeModel = propsModel ?? localModel;
  const handleModelChange = (model: string) => {
    if (onModelChange) {
      onModelChange(model);
    } else {
      setLocalModel(model);
      try {
        localStorage.setItem('openthink_active_model', model);
      } catch {
        // localStorage may be unavailable in private mode
      }
      // Fire storage event to sync windows
      window.dispatchEvent(new Event('storage'));
    }
  };

  // Live mock metric generators
  const [latency, setLatency] = useState(140);
  const [speed, setSpeed] = useState(38.5);
  const [cost] = useState(0.0024);

  useEffect(() => {
    const interval = setInterval(() => {
      // Simulate real-time minor jitter
      setLatency(prev => Math.max(120, Math.min(220, prev + (Math.random() * 20 - 10))));
      setSpeed(prev => Math.max(30, Math.min(48, prev + (Math.random() * 4 - 2))));
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const tabs = HARNESS_TABS;

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: isPoppedOut ? 'var(--bg-primary)' : 'transparent',
      padding: isPoppedOut ? '24px' : '0',
      color: 'var(--text-primary)',
      fontFamily: "'Inter', sans-serif"
    }}>
      {isPoppedOut && (
        <div className="row-flex-between-gap-10">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Cpu size={16} color="white" />
            </div>
            <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: '1.15rem', fontWeight: 700 }}>Agent Intelligence</span>
          </div>
          <button type="button"
            className="btn btn-ghost row-flex-gap-6"
            onClick={() => {
              localStorage.setItem('openthink_popout_harness', 'false');
              window.dispatchEvent(new Event('storage'));
              window.close();
            }}
            aria-label="Dock back"
          >
            <Dock size={14} /> Dock Back
          </button>
        </div>
      )}

      {/* Tab Bar */}
      <div style={{ display: 'flex', gap: '2px', marginBottom: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '3px', border: '1px solid var(--border-subtle)' }}>
        {tabs.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button type="button"
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
                padding: '6px 4px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                fontSize: '0.75rem', fontWeight: isActive ? 700 : 500,
                transition: 'background ease 0.15s, color ease 0.15s, border-color ease 0.15s, transform ease 0.15s, opacity ease 0.15s, box-shadow ease 0.15s',
                background: isActive ? (tab.color ? `${tab.color}15` : 'rgba(255,255,255,0.07)') : 'transparent',
                color: isActive ? (tab.color || 'var(--text-primary)') : 'var(--text-tertiary)',
                boxShadow: isActive ? `inset 0 0 0 1px ${tab.color ? `${tab.color}30` : 'rgba(255,255,255,0.1)'}` : 'none',
              }}
            >
              {tab.icon}
              {tab.label}
              {tab.id === 'brain' && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#8B5CF6', boxShadow: '0 0 4px #8B5CF6', flexShrink: 0 }} />}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab !== 'harness' ? (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {activeTab === 'brain' && <BrainPanel />}
          {activeTab === 'evals' && <BenchmarkPanel />}
          {activeTab === 'plugins' && <PluginPanel />}
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto' }}>

      {/* Model Selection Card - State-of-the-Art Grid */}
      <div className="glass-panel" style={{ padding: '16px', borderRadius: 'var(--radius-md)', background: 'rgba(36,36,36,0.3)', marginBottom: '16px' }}>
        <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-tertiary)', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '16px' }}>Cloudflare Premium Model Switcher</div>
        
        <div className="harness-model-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
          {premiumModels.map(model => {
            const isSelected = activeModel === model.id;
            return (
              <button
                type="button"
                key={model.id}
                aria-pressed={isSelected}
                onClick={() => handleModelChange(model.id)}
                onFocus={e => {
                  if (!isSelected) {
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                  }
                }}
                onBlur={e => {
                  if (!isSelected) {
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.06)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }
                }}
                style={{
                  padding: '14px',
                  borderRadius: '8px',
                  background: isSelected ? 'rgba(255, 255, 255, 0.04)' : 'rgba(255, 255, 255, 0.01)',
                  border: isSelected ? '1.5px solid var(--accent-primary)' : '1px solid rgba(255, 255, 255, 0.06)',
                  cursor: 'pointer',
                  transition: 'background cubic-bezier(0.4, 0, 0.2, 1) 0.2s, color cubic-bezier(0.4, 0, 0.2, 1) 0.2s, border-color cubic-bezier(0.4, 0, 0.2, 1) 0.2s, transform cubic-bezier(0.4, 0, 0.2, 1) 0.2s, opacity cubic-bezier(0.4, 0, 0.2, 1) 0.2s, box-shadow cubic-bezier(0.4, 0, 0.2, 1) 0.2s',
                  boxShadow: isSelected ? '0 0 16px rgba(249, 115, 22, 0.15)' : 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  position: 'relative',
                  overflow: 'hidden',
                  textAlign: 'left',
                  color: 'inherit',
                  font: 'inherit'
                }}
                onMouseOver={e => {
                  if (!isSelected) {
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                  }
                }}
                onMouseOut={e => {
                  if (!isSelected) {
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.06)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }
                }}
              >
                {/* Custom Card Gradient Overlay */}
                <div style={{
                  position: 'absolute',
                  top: 0, left: 0, right: 0, bottom: 0,
                  background: model.gradient,
                  opacity: isSelected ? 0.8 : 0.2,
                  zIndex: 0,
                  pointerEvents: 'none'
                }} />

                <div style={{ zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: 700, color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                    {model.name}
                  </span>
                  
                  {isSelected && (
                    <span style={{
                      background: 'var(--accent-primary)',
                      color: 'white',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: '4px',
                      textTransform: 'uppercase'
                    }}>
                      Active
                    </span>
                  )}
                </div>

                <span style={{ zIndex: 1, fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 600 }}>
                  {model.tag}
                </span>

                <p style={{ zIndex: 1, fontSize: '0.75rem', color: 'var(--text-tertiary)', margin: '4px 0 0', lineHeight: 1.4, flex: 1 }}>
                  {model.desc}
                </p>

                <div style={{ zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>Ping Latency</span>
                  <div className="row-flex-gap-6">
                    <div style={{
                      width: '6px', height: '6px', borderRadius: '50%',
                      background: '#10B981',
                      boxShadow: '0 0 6px #10B981',
                      animation: 'pulse 0.9s infinite'
                    }} />
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{model.latency}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        
        <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '14px', textAlign: 'center' }}>
          Native Cloudflare Workers AI. Llama, DeepSeek, and Qwen routed to the closest GPU region.
        </div>
      </div>

      {/* Live Inference Metrics */}
      <div className="glass-panel" style={{ padding: '16px', borderRadius: 'var(--radius-md)', background: 'rgba(36,36,36,0.3)', marginBottom: '16px' }}>
        <div className="section-header" style={{ marginBottom: '16px' }}>
          <span>Live Inference Metrics</span>
          <Activity size={14} color="var(--accent-tertiary)" />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Latency Meter */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '6px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Prompt Eval Latency</span>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{latency.toFixed(0)} ms</span>
            </div>
            <div style={{ width: '100%', height: '6px', background: 'var(--bg-tertiary)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ width: '100%', height: '100%', background: 'linear-gradient(to right, var(--accent-secondary), var(--accent-primary))', borderRadius: '3px', transform: `scaleX(${Math.min(latency / 300, 1)})`, transformOrigin: 'left center', transition: 'transform 0.5s ease-out' }} />
            </div>
          </div>

          {/* Speed Meter */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '6px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Token Generation Speed</span>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{speed.toFixed(1)} tok/sec</span>
            </div>
            <div style={{ width: '100%', height: '6px', background: 'var(--bg-tertiary)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ width: '100%', height: '100%', background: 'linear-gradient(to right, var(--accent-primary), var(--accent-tertiary))', borderRadius: '3px', transform: `scaleX(${Math.min(speed / 60, 1)})`, transformOrigin: 'left center', transition: 'transform 0.5s ease-out' }} />
            </div>
          </div>

          {/* Cost Tracker */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-elevated)', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <DollarSign size={16} color="#10B981" />
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Estimated Cost (convo)</span>
            </div>
            <span style={{ fontSize: '1rem', fontWeight: 700, color: '#10B981' }}>${cost.toFixed(4)}</span>
          </div>
        </div>
      </div>

      {/* Agent Orange 0 Core Profile */}
      <div className="glass-panel" style={{ flex: 1, padding: '16px', borderRadius: 'var(--radius-md)', background: 'rgba(36,36,36,0.3)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-tertiary)', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '12px' }}>Agent Orange 0 Profile</div>
        
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.8125rem' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', background: 'var(--bg-elevated)', padding: '8px 12px', borderRadius: '6px' }}>
            <Shield size={14} color="var(--accent-primary)" />
            <span style={{ color: 'var(--text-secondary)' }}>Identity:</span>
            <span style={{ fontWeight: 600 }}>Cognitive Core A0</span>
          </div>

          <div style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            I am Agent Orange 0, your first self-evolving AI orchestrator agent. I run inside Cloudflare's Durable Object thread context with synchronous SQLite state and MCP clients for real-time tool calling.
          </div>

          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 600, marginTop: '8px' }}>ACTIVE COGNITIVE CAPABILITIES:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            <CapabilityChip label="Persistent Memory" />
            <CapabilityChip label="SQLite Engine" />
            <CapabilityChip label="Multi-Model Testing" />
            <CapabilityChip label="Harness Optimizations" />
            <CapabilityChip label="MCP Tool Invoker" />
            <CapabilityChip label="Cross-Thread Learning" />
          </div>
        </div>
      </div>
        </div>
      )}
    </div>
  );
};

const CapabilityChip = ({ label }: { label: string }) => (
  <span style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '4px', padding: '3px 8px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
    {label}
  </span>
);

export default HarnessPanel;
