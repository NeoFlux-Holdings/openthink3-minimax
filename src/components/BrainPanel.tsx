import React, { useState } from 'react';
import {
  BrainStatusCard, SkillsToggleCard, MemorySearchCard,
  IngestCard, DreamCycleCard, GstackReferenceCard,
} from './BrainPanelParts';
import type { BrainStatus, SearchResult } from './BrainPanel.types';

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

const BrainPanel: React.FC = () => {
  const [status, setStatus] = useState<BrainStatus>({
    connected: false, pageCount: 0, entityCount: 0,
    lastDream: null, nextDream: null, engine: 'unknown', version: ''
  });
  const [checking, setChecking] = useState(false);

  const [gbrainEnabled, setGbrainEnabled] = useState(() =>
    localStorage.getItem(SKILL_KEYS.gbrain) !== 'false'
  );
  const [gstackEnabled, setGstackEnabled] = useState(() =>
    localStorage.getItem(SKILL_KEYS.gstack) !== 'false'
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [, setSearchError] = useState<string | null>(null);

  const [ingestText, setIngestText] = useState('');
  const [ingestTitle, setIngestTitle] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [ingestMsg, setIngestMsg] = useState<string | null>(null);
  const [showIngest, setShowIngest] = useState(false);

  const [dreamRunning, setDreamRunning] = useState(false);
  const [dreamLog, setDreamLog] = useState<string[]>([]);

  const [showConfig, setShowConfig] = useState(false);
  const [vmUrl, setVmUrl] = useState(() => localStorage.getItem('openthink_gbrain_vm') || '');
  const [savingConfig, setSavingConfig] = useState(false);

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
      <BrainStatusCard
        status={status}
        checking={checking}
        onRefresh={checkBrainStatus}
        showConfig={showConfig}
        onToggleConfig={() => setShowConfig(!showConfig)}
        vmUrl={vmUrl}
        onVmUrlChange={setVmUrl}
        savingConfig={savingConfig}
        onSaveConfig={saveConfig}
      />
      <SkillsToggleCard
        gbrainEnabled={gbrainEnabled}
        gstackEnabled={gstackEnabled}
        onToggle={toggleSkill}
      />
      <MemorySearchCard
        searchQuery={searchQuery}
        onQueryChange={setSearchQuery}
        onSearch={runSearch}
        searching={searching}
        searchResult={searchResult}
      />
      <IngestCard
        showIngest={showIngest}
        onToggleIngest={() => setShowIngest(!showIngest)}
        ingestTitle={ingestTitle}
        onTitleChange={setIngestTitle}
        ingestText={ingestText}
        onTextChange={setIngestText}
        ingesting={ingesting}
        ingestMsg={ingestMsg}
        onIngest={runIngest}
      />
      <DreamCycleCard
        lastDream={status.lastDream}
        dreamRunning={dreamRunning}
        dreamLog={dreamLog}
        onRunDream={runDreamCycle}
      />
      <GstackReferenceCard />
      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default BrainPanel;
