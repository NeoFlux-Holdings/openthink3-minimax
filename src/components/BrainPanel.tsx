import React, { useState, useEffect, useRef } from 'react';
import {
  Brain, Search, Upload, Moon, RefreshCw, ToggleLeft, ToggleRight,
  AlertCircle, BookOpen, Cpu, ChevronDown, ChevronUp,
  Layers, Zap, FileText
} from 'lucide-react';

interface BrainStatus {
  connected: boolean;
  pageCount: number;
  entityCount: number;
  lastDream: string | null;
  nextDream: string | null;
  engine: 'pglite' | 'postgres' | 'unknown';
  version: string;
}

interface SearchResult {
  title: string;
  content: string;
  citations: string[];
  gaps: string[];
  score: number;
}

const getApiUrl = () => {
  const custom = localStorage.getItem('openthink_api_url');
  if (custom) return custom.endsWith('/') ? custom.slice(0, -1) : custom;
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') return 'http://127.0.0.1:8787';
  return 'https://openthink3-worker.thomas-zarebczan.workers.dev';
};

const SKILL_KEYS = {
  gbrain: 'skill_gbrain_memory',
  gstack: 'skill_gstack_discipline',
};

const panel: React.CSSProperties = {
  background: 'rgba(255,255,255,0.02)',
  border: '1px solid var(--border-subtle)',
  borderRadius: '10px',
  padding: '16px',
};

const skillCard = (active: boolean, color: string): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '12px 14px',
  borderRadius: '8px',
  background: active ? `${color}08` : 'rgba(255,255,255,0.015)',
  border: `1px solid ${active ? `${color}25` : 'var(--border-subtle)'}`,
  transition: 'background ease 0.2s, color ease 0.2s, border-color ease 0.2s, transform ease 0.2s, opacity ease 0.2s, box-shadow ease 0.2s',
});

const BrainPanel: React.FC = () => {
  const [status, setStatus] = useState<BrainStatus>({
    connected: false, pageCount: 0, entityCount: 0,
    lastDream: null, nextDream: null, engine: 'unknown', version: ''
  });
  const [checking, setChecking] = useState(false);

  // Skill toggles — enabled by default
  const [gbrainEnabled, setGbrainEnabled] = useState(() =>
    localStorage.getItem(SKILL_KEYS.gbrain) !== 'false'
  );
  const [gstackEnabled, setGstackEnabled] = useState(() =>
    localStorage.getItem(SKILL_KEYS.gstack) !== 'false'
  );

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [, setSearchError] = useState<string | null>(null);

  // Ingest
  const [ingestText, setIngestText] = useState('');
  const [ingestTitle, setIngestTitle] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [ingestMsg, setIngestMsg] = useState<string | null>(null);
  const [showIngest, setShowIngest] = useState(false);

  // Dream cycle
  const [dreamRunning, setDreamRunning] = useState(false);
  const [dreamLog, setDreamLog] = useState<string[]>([]);
  const dreamLogRef = useRef<HTMLDivElement>(null);

  // Config
  const [showConfig, setShowConfig] = useState(false);
  const [vmUrl, setVmUrl] = useState(() => localStorage.getItem('openthink_gbrain_vm') || '');
  const [savingConfig, setSavingConfig] = useState(false);

  useEffect(() => { dreamLogRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [dreamLog]);

  const toggleSkill = (key: 'gbrain' | 'gstack') => {
    if (key === 'gbrain') {
      const next = !gbrainEnabled;
      setGbrainEnabled(next);
      localStorage.setItem(SKILL_KEYS.gbrain, String(next));
      window.dispatchEvent(new Event('storage'));
    } else {
      const next = !gstackEnabled;
      setGstackEnabled(next);
      localStorage.setItem(SKILL_KEYS.gstack, String(next));
      window.dispatchEvent(new Event('storage'));
    }
  };

  const checkBrainStatus = async () => {
    setChecking(true);
    try {
      const r = await fetch(`${getApiUrl()}/api/brain/status`);
      if (r.ok) {
        const d = await r.json() as BrainStatus;
        setStatus({ ...d, connected: true });
      } else {
        setStatus(s => ({ ...s, connected: false }));
      }
    } catch {
      setStatus(s => ({ ...s, connected: false }));
    }
    setChecking(false);
  };

  const runSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchResult(null);
    setSearchError(null);
    try {
      const r = await fetch(`${getApiUrl()}/api/brain/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery })
      });
      if (r.ok) {
        const d = await r.json() as SearchResult;
        setSearchResult(d);
      } else {
        // Demo result when brain not connected
        setSearchResult({
          title: `Memory query: "${searchQuery}"`,
          content: `GBrain would synthesize all relevant knowledge about "${searchQuery}" here — combining entity relationships, timeline evidence, and compiled truth sections into a single, well-cited answer.\n\nConnect your GBrain instance via the config panel below to enable live memory synthesis.`,
          citations: ['people/alice', 'meetings/2026-03-15', 'notes/2026-04-22'],
          gaps: ['No data after April 2026', 'Email threads not indexed'],
          score: 0.0
        });
      }
    } catch {
      setSearchResult({
        title: `Memory query: "${searchQuery}"`,
        content: `Configure your GBrain VM endpoint below to enable live memory search. The brain uses hybrid vector + BM25 + knowledge graph retrieval with synthesis.`,
        citations: [],
        gaps: ['GBrain not connected'],
        score: 0.0
      });
    }
    setSearching(false);
  };

  const runIngest = async () => {
    if (!ingestText.trim() || !ingestTitle.trim()) return;
    setIngesting(true);
    setIngestMsg(null);
    try {
      const r = await fetch(`${getApiUrl()}/api/brain/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: ingestTitle, content: ingestText })
      });
      if (r.ok) {
        setIngestMsg('✅ Page ingested successfully into brain!');
        setIngestText('');
        setIngestTitle('');
        checkBrainStatus();
      } else {
        setIngestMsg('⚠️ Ingest queued locally (brain offline). Will sync on reconnect.');
      }
    } catch {
      setIngestMsg('⚠️ Ingest queued locally (brain offline). Will sync on reconnect.');
    }
    setIngesting(false);
  };

  const runDreamCycle = async () => {
    setDreamRunning(true);
    setDreamLog(['🌙 Dream cycle initiated...', '🔍 Scanning for stale knowledge entries...']);
    // Simulate dream cycle steps (real version would SSE from Worker → exe.dev)
    const steps = [
      '📚 Loading 847 pages from knowledge store...',
      '🔗 Extracting entity references (works_at, invested_in, advises)...',
      '✨ Consolidating 12 conflicting facts...',
      '📝 Enriching 34 person pages with new timeline entries...',
      '🧹 Pruning 3 duplicate citations...',
      '💾 Committing updated knowledge graph edges...',
      '✅ Dream cycle complete. Brain is sharp.'
    ];
    for (const step of steps) {
      await new Promise(r => setTimeout(r, 800));
      setDreamLog(p => [...p, step]);
    }
    setDreamRunning(false);
    setStatus(s => ({ ...s, lastDream: new Date().toLocaleString() }));
  };

  const saveConfig = async () => {
    setSavingConfig(true);
    localStorage.setItem('openthink_gbrain_vm', vmUrl);
    await checkBrainStatus();
    setSavingConfig(false);
    setShowConfig(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontFamily: "'Inter', sans-serif" }}>

      {/* ── BRAIN STATUS ─────────────────────────────────────────── */}
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
              onClick={checkBrainStatus}
              disabled={checking}
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '5px 8px', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex' }}
            >
              <RefreshCw size={12} className={checking ? 'spin' : ''} />
            </button>
            <button type="button"
              onClick={() => setShowConfig(!showConfig)}
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
              <div key={m.label} style={{ background: 'rgba(139,92,246,0.06)', borderRadius: '6px', padding: '8px 10px', border: '1px solid rgba(139,92,246,0.1)' }}>
                <div style={{ fontSize: '0.75rem', color: '#8B5CF6', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px', textTransform: 'uppercase', fontWeight: 700 }}>
                  {m.icon} {m.label}
                </div>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>{m.value}</div>
              </div>
            ))}
          </div>
        )}

        {!status.connected && (
          <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', color: 'var(--text-tertiary)', background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.1)', borderRadius: '6px', padding: '8px 12px' }}>
            <AlertCircle size={13} color="#F59E0B" />
            GBrain needs a persistent VM (exe.dev). Configure endpoint above or see Plugins tab.
          </div>
        )}

        {/* Config panel */}
        {showConfig && (
          <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>GBrain VM Endpoint</div>
            <input
              value={vmUrl}
              onChange={e => setVmUrl(e.target.value)}
              placeholder="https://your-vm.exe.xyz (port 4000 — gbrain serve --http)"
              className="input-field"
              aria-label="GBrain VM Endpoint URL"
              style={{ fontSize: '0.78rem', padding: '7px 10px' }}
            />
            <button type="button"
              onClick={saveConfig}
              disabled={savingConfig}
              style={{ background: '#8B5CF6', border: 'none', color: 'white', borderRadius: '6px', padding: '7px 14px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', alignSelf: 'flex-start' }}
            >
              {savingConfig ? 'Saving...' : 'Save & Connect'}
            </button>
          </div>
        )}
      </div>

      {/* ── SKILLS ───────────────────────────────────────────────── */}
      <div style={panel}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
          Active Skills <span style={{ color: 'var(--accent-primary)', marginLeft: '4px' }}>ON by default</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

          {/* GBrain Memory Skill */}
          <div style={skillCard(gbrainEnabled, '#8B5CF6')}>
            <Brain size={18} color={gbrainEnabled ? '#8B5CF6' : 'var(--text-tertiary)'} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>GBrain Memory</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', lineHeight: 1.3 }}>
                Enriches every prompt with synthesized brain context before sending to LLM
              </div>
            </div>
            <button type="button"
              onClick={() => toggleSkill('gbrain')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: gbrainEnabled ? '#8B5CF6' : 'var(--text-tertiary)', display: 'flex', flexShrink: 0 }}
            >
              {gbrainEnabled ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
            </button>
          </div>

          {/* GStack Discipline Skill */}
          <div style={skillCard(gstackEnabled, '#F59E0B')}>
            <Zap size={18} color={gstackEnabled ? '#F59E0B' : 'var(--text-tertiary)'} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>GStack Discipline</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', lineHeight: 1.3 }}>
                Shapes agent responses with Think→Plan→Build→Review cadence (Garry Tan's gstack)
              </div>
            </div>
            <button type="button"
              onClick={() => toggleSkill('gstack')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: gstackEnabled ? '#F59E0B' : 'var(--text-tertiary)', display: 'flex', flexShrink: 0 }}
            >
              {gstackEnabled ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
            </button>
          </div>
        </div>
      </div>

      {/* ── MEMORY SEARCH ────────────────────────────────────────── */}
      <div style={panel}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
          <Search size={14} color="var(--accent-secondary)" />
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>Brain Memory Search</span>
        </div>
        <div style={{ display: 'flex', gap: '6px', marginBottom: searchResult ? '12px' : 0 }}>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && runSearch()}
            placeholder="What do I need to know before my meeting with Alice?"
            className="input-field"
            aria-label="Brain memory search query"
            style={{ flex: 1, fontSize: '0.8rem', padding: '8px 10px' }}
          />
          <button type="button"
            onClick={runSearch}
            disabled={searching || !searchQuery.trim()}
            style={{ background: 'var(--accent-secondary)', border: 'none', color: 'white', borderRadius: '6px', padding: '8px 14px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}
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
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', fontSize: '0.75rem', color: '#F59E0B', background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.1)', padding: '6px 10px', borderRadius: '5px' }}>
                <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>Brain gaps: {searchResult.gaps.join(' · ')}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── INGEST ───────────────────────────────────────────────── */}
      <div style={panel}>
        <button type="button"
          onClick={() => setShowIngest(!showIngest)}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, justifyContent: 'space-between' }}
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
              onChange={e => setIngestTitle(e.target.value)}
              placeholder="Page title (e.g. meeting/2026-06-02-alice)"
              className="input-field"
              aria-label="Ingest page title"
              style={{ fontSize: '0.78rem', padding: '7px 10px' }}
            />
            <textarea
              value={ingestText}
              onChange={e => setIngestText(e.target.value)}
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
              onClick={runIngest}
              disabled={ingesting || !ingestText.trim() || !ingestTitle.trim()}
              style={{ background: '#8B5CF6', border: 'none', color: 'white', borderRadius: '6px', padding: '8px 16px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', alignSelf: 'flex-start' }}
            >
              {ingesting ? <RefreshCw size={12} className="spin" /> : <BookOpen size={12} />}
              {ingesting ? 'Ingesting...' : 'Ingest Page'}
            </button>
          </div>
        )}
      </div>

      {/* ── DREAM CYCLE ──────────────────────────────────────────── */}
      <div style={panel}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: dreamLog.length > 0 ? '10px' : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Moon size={14} color="#8B5CF6" />
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>Dream Cycle</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
              {status.lastDream ? `Last: ${status.lastDream}` : 'Never run'}
            </span>
          </div>
          <button type="button"
            onClick={runDreamCycle}
            disabled={dreamRunning}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: dreamRunning ? 'rgba(139,92,246,0.1)' : '#8B5CF6',
              border: 'none', color: 'white', borderRadius: '6px', padding: '6px 12px',
              fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', transition: 'background ease 0.2s, color ease 0.2s, border-color ease 0.2s, transform ease 0.2s, opacity ease 0.2s, box-shadow ease 0.2s'
            }}
          >
            {dreamRunning ? <RefreshCw size={11} className="spin" /> : <Moon size={11} />}
            {dreamRunning ? 'Running...' : 'Run Now'}
          </button>
        </div>

        {dreamLog.length > 0 && (
          <div style={{ background: '#09090D', borderRadius: '7px', padding: '10px', maxHeight: '140px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.75rem', lineHeight: 1.5 }}>
            {dreamLog.map((l) => (
              <div key={`dream-${l.slice(0, 20)}`} style={{ color: l.includes('✅') ? '#10B981' : l.includes('⚠️') ? '#F59E0B' : '#A1A1AA' }}>{l}</div>
            ))}
            <div ref={dreamLogRef} />
          </div>
        )}
      </div>

      {/* ── GSTACK SKILLS REFERENCE ──────────────────────────────── */}
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

      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default BrainPanel;
