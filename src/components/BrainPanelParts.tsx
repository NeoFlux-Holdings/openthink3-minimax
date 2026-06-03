import React, { useEffect, useRef } from 'react';
import {
  Brain, Search, Upload, Moon, RefreshCw, ToggleLeft, ToggleRight,
  AlertCircle, BookOpen, Cpu, ChevronDown, ChevronUp,
  Layers, Zap, FileText
} from 'lucide-react';
import type { BrainStatus, SearchResult } from './BrainPanel.types';
import { panel, skillCard } from './BrainPanel.types';

export const BrainStatusCard: React.FC<{
  status: BrainStatus;
  checking: boolean;
  onRefresh: () => void;
  showConfig: boolean;
  onToggleConfig: () => void;
  vmUrl: string;
  onVmUrlChange: (v: string) => void;
  savingConfig: boolean;
  onSaveConfig: () => void;
}> = ({ status, checking, onRefresh, showConfig, onToggleConfig, vmUrl, onVmUrlChange, savingConfig, onSaveConfig }) => (
  <div style={{
    ...panel,
    background: status.connected
      ? 'linear-gradient(135deg, rgba(139,92,246,0.07), rgba(139,92,246,0.02))'
      : 'rgba(255,255,255,0.02)',
    borderColor: status.connected ? 'rgba(139,92,246,0.25)' : 'var(--border-subtle)',
    transition: 'background ease 0.3s, color ease 0.3s, border-color ease 0.3s, transform ease 0.3s, opacity ease 0.3s, box-shadow ease 0.3s',
  }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: status.connected ? '12px' : 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <Brain size={18} color={status.connected ? '#8B5CF6' : 'var(--text-tertiary)'} />
        <div>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>GBrain Memory Engine</div>
          <div style={{ fontSize: '0.75rem', color: status.connected ? '#8B5CF6' : 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '5px' }}>
            {status.connected
              ? <><span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#8B5CF6', boxShadow: '0 0 6px #8B5CF6' }} /> CONNECTED · {status.engine} · v{status.version}</>
              : 'Persistent hybrid-search agent brain (gbrain)'
            }
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button type="button"
          onClick={onRefresh}
          disabled={checking}
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '5px 8px', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex' }}
        >
          <RefreshCw size={12} className={checking ? 'spin' : ''} />
        </button>
        <button type="button"
          onClick={onToggleConfig}
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: '0.75rem' }}
        >
          Config
        </button>
      </div>
    </div>

    {status.connected && (
      <div className="brain-3col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
        {[
          { label: 'Pages', value: status.pageCount.toLocaleString(), icon: <FileText size={11} /> },
          { label: 'Entities', value: status.entityCount.toLocaleString(), icon: <Layers size={11} /> },
          { label: 'Last Dream', value: status.lastDream || 'Never', icon: <Moon size={11} /> },
        ].map(m => (
          <div key={m.label} className="brain-stats">
            <div className="section-label--purple">
              {m.icon} {m.label}
            </div>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>{m.value}</div>
          </div>
        ))}
      </div>
    )}

    {!status.connected && (
      <div className="alert-warning">
        <AlertCircle size={13} color="#F59E0B" />
        GBrain needs a persistent VM (exe.dev). Configure endpoint above or see Plugins tab.
      </div>
    )}

    {showConfig && (
      <div className="stat-block">
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>GBrain VM Endpoint</div>
        <input
          value={vmUrl}
          onChange={e => onVmUrlChange(e.target.value)}
          placeholder="https://your-vm.exe.xyz (port 4000 — gbrain serve --http)"
          className="input-field"
          aria-label="GBrain VM Endpoint URL"
          style={{ fontSize: '0.78rem', padding: '7px 10px' }}
        />
        <button type="button"
          onClick={onSaveConfig}
          disabled={savingConfig}
          className="btn-solid btn-solid--purple-sm"
        >
          {savingConfig ? 'Saving...' : 'Save & Connect'}
        </button>
      </div>
    )}
  </div>
);

export const SkillsToggleCard: React.FC<{
  gbrainEnabled: boolean;
  gstackEnabled: boolean;
  onToggle: (key: 'gbrain' | 'gstack') => void;
}> = ({ gbrainEnabled, gstackEnabled, onToggle }) => (
  <div style={panel}>
    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
      Active Skills <span style={{ color: 'var(--accent-primary)', marginLeft: '4px' }}>ON by default</span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={skillCard(gbrainEnabled, '#8B5CF6')}>
        <Brain size={18} color={gbrainEnabled ? '#8B5CF6' : 'var(--text-tertiary)'} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>GBrain Memory</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', lineHeight: 1.3 }}>
            Enriches every prompt with synthesized brain context before sending to LLM
          </div>
        </div>
        <button type="button"
          onClick={() => onToggle('gbrain')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: gbrainEnabled ? '#8B5CF6' : 'var(--text-tertiary)', display: 'flex', flexShrink: 0 }}
        >
          {gbrainEnabled ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
        </button>
      </div>

      <div style={skillCard(gstackEnabled, '#F59E0B')}>
        <Zap size={18} color={gstackEnabled ? '#F59E0B' : 'var(--text-tertiary)'} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>GStack Discipline</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', lineHeight: 1.3 }}>
            Shapes agent responses with Think→Plan→Build→Review cadence (Garry Tan's gstack)
          </div>
        </div>
        <button type="button"
          onClick={() => onToggle('gstack')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: gstackEnabled ? '#F59E0B' : 'var(--text-tertiary)', display: 'flex', flexShrink: 0 }}
        >
          {gstackEnabled ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
        </button>
      </div>
    </div>
  </div>
);

export const MemorySearchCard: React.FC<{
  searchQuery: string;
  onQueryChange: (v: string) => void;
  onSearch: () => void;
  searching: boolean;
  searchResult: SearchResult | null;
}> = ({ searchQuery, onQueryChange, onSearch, searching, searchResult }) => (
  <div style={panel}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
      <Search size={14} color="var(--accent-secondary)" />
      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>Brain Memory Search</span>
    </div>
    <div style={{ display: 'flex', gap: '6px', marginBottom: searchResult ? '12px' : 0 }}>
      <input
        type="text"
        value={searchQuery}
        onChange={e => onQueryChange(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && onSearch()}
        placeholder="What do I need to know before my meeting with Alice?"
        className="input-field"
        aria-label="Brain memory search query"
        style={{ flex: 1, fontSize: '0.8rem', padding: '8px 10px' }}
      />
      <button type="button"
        onClick={onSearch}
        disabled={searching || !searchQuery.trim()}
        className="btn-solid btn-solid--secondary"
      >
        {searching ? <RefreshCw size={12} className="spin" /> : <Search size={12} />}
      </button>
    </div>

    {searchResult && (
      <div style={{ background: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.15)', borderRadius: '8px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-secondary)' }}>{searchResult.title}</div>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.6, whiteSpace: 'pre-line' }}>{searchResult.content}</div>
        {searchResult.citations.length > 0 && (
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: '4px', textTransform: 'uppercase' }}>Sources</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {searchResult.citations.map((c) => (
                <span key={c} style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', padding: '2px 7px', borderRadius: '4px', fontSize: '0.75rem', color: 'var(--accent-secondary)', fontFamily: 'monospace' }}>{c}</span>
              ))}
            </div>
          </div>
        )}
        {searchResult.gaps.length > 0 && (
          <div className="alert-warning--top">
            <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Brain gaps: {searchResult.gaps.join(' · ')}</span>
          </div>
        )}
      </div>
    )}
  </div>
);

export const IngestCard: React.FC<{
  showIngest: boolean;
  onToggleIngest: () => void;
  ingestTitle: string;
  onTitleChange: (v: string) => void;
  ingestText: string;
  onTextChange: (v: string) => void;
  ingesting: boolean;
  ingestMsg: string | null;
  onIngest: () => void;
}> = ({ showIngest, onToggleIngest, ingestTitle, onTitleChange, ingestText, onTextChange, ingesting, ingestMsg, onIngest }) => (
  <div style={panel}>
    <button type="button"
      onClick={onToggleIngest}
      className="collapse-toggle"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Upload size={14} color="var(--text-tertiary)" />
        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>Ingest into Brain</span>
      </div>
      {showIngest ? <ChevronUp size={13} color="var(--text-tertiary)" /> : <ChevronDown size={13} color="var(--text-tertiary)" />}
    </button>

    {showIngest && (
      <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <input
          value={ingestTitle}
          onChange={e => onTitleChange(e.target.value)}
          placeholder="Page title (e.g. meeting/2026-06-02-alice)"
          className="input-field"
          aria-label="Ingest page title"
          style={{ fontSize: '0.78rem', padding: '7px 10px' }}
        />
        <textarea
          value={ingestText}
          onChange={e => onTextChange(e.target.value)}
          placeholder="Paste markdown content, meeting notes, ideas, or any knowledge to add to the brain..."
          className="input-field"
          aria-label="Ingest markdown content"
          style={{ fontSize: '0.78rem', padding: '8px 10px', minHeight: '90px', resize: 'vertical' }}
        />
        {ingestMsg && (
          <div style={{ fontSize: '0.75rem', color: ingestMsg.startsWith('✅') ? '#10B981' : '#F59E0B', padding: '6px 10px', borderRadius: '5px', background: ingestMsg.startsWith('✅') ? 'rgba(16,185,129,0.06)' : 'rgba(245,158,11,0.06)', border: `1px solid ${ingestMsg.startsWith('✅') ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.1)'}` }}>
            {ingestMsg}
          </div>
        )}
        <button type="button"
          onClick={onIngest}
          disabled={ingesting || !ingestText.trim() || !ingestTitle.trim()}
          className="btn-solid btn-solid--purple"
        >
          {ingesting ? <RefreshCw size={12} className="spin" /> : <BookOpen size={12} />}
          {ingesting ? 'Ingesting...' : 'Ingest Page'}
        </button>
      </div>
    )}
  </div>
);

export const DreamCycleCard: React.FC<{
  lastDream: string | null;
  dreamRunning: boolean;
  dreamLog: string[];
  onRunDream: () => void;
}> = ({ lastDream, dreamRunning, dreamLog, onRunDream }) => {
  const dreamLogRef = useRef<HTMLDivElement>(null);
  useEffect(() => { dreamLogRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [dreamLog]);

  return (
    <div style={panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: dreamLog.length > 0 ? '10px' : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Moon size={14} color="#8B5CF6" />
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>Dream Cycle</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
            {lastDream ? `Last: ${lastDream}` : 'Never run'}
          </span>
        </div>
        <button type="button"
          onClick={onRunDream}
          disabled={dreamRunning}
          className="btn-solid" style={{ background: dreamRunning ? 'rgba(139,92,246,0.1)' : '#8B5CF6', padding: '6px 12px', fontSize: '0.75rem', gap: '5px' }}
        >
          {dreamRunning ? <RefreshCw size={11} className="spin" /> : <Moon size={11} />}
          {dreamRunning ? 'Running...' : 'Run Now'}
        </button>
      </div>

      {dreamLog.length > 0 && (
        <div className="code-log code-log--tall">
          {dreamLog.map((l) => (
            <div key={`dream-${l.slice(0, 20)}`} style={{ color: l.includes('✅') ? '#10B981' : l.includes('⚠️') ? '#F59E0B' : '#A1A1AA' }}>{l}</div>
          ))}
          <div ref={dreamLogRef} />
        </div>
      )}
    </div>
  );
};

export const GstackReferenceCard: React.FC = () => (
  <div style={panel}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
      <Cpu size={14} color="#F59E0B" />
      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>GStack Workflow Personas</span>
      <span style={{ fontSize: '0.75rem', background: 'rgba(245,158,11,0.1)', color: '#F59E0B', padding: '1px 5px', borderRadius: '3px', fontWeight: 700 }}>23 skills</span>
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
      {[
        { label: '/office-hours', color: '#F59E0B', desc: 'CEO review' },
        { label: '/plan', color: '#3B82F6', desc: 'Scope & plan' },
        { label: '/build', color: '#10B981', desc: 'Engineering' },
        { label: '/qa', color: '#8B5CF6', desc: 'Quality check' },
        { label: '/ship', color: '#EF4444', desc: 'Deploy gate' },
        { label: '/review', color: '#EC4899', desc: 'Code review' },
      ].map(s => (
        <div key={s.label} style={{ background: `${s.color}08`, border: `1px solid ${s.color}25`, padding: '4px 8px', borderRadius: '5px', display: 'flex', alignItems: 'center', gap: '5px' }}>
          <code style={{ fontSize: '0.75rem', color: s.color, fontFamily: 'monospace', fontWeight: 700 }}>{s.label}</code>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{s.desc}</span>
        </div>
      ))}
    </div>
    <div style={{ marginTop: '8px', fontSize: '0.75rem', color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
      Install in your terminal: <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 6px', borderRadius: '3px', fontFamily: 'monospace' }}>git clone https://github.com/garrytan/gstack ~/.claude/skills/gstack</code>
    </div>
  </div>
);
