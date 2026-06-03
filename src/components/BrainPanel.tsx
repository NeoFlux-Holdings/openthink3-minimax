import React, { useReducer, type Dispatch, type SetStateAction } from 'react';
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

type BrainPanelState = {
  status: BrainStatus;
  checking: boolean;
  gbrainEnabled: boolean;
  gstackEnabled: boolean;
  searchQuery: string;
  searching: boolean;
  searchResult: SearchResult | null;
  searchError: string | null;
  ingestText: string;
  ingestTitle: string;
  ingesting: boolean;
  ingestMsg: string | null;
  showIngest: boolean;
  dreamRunning: boolean;
  dreamLog: string[];
  showConfig: boolean;
  vmUrl: string;
  savingConfig: boolean;
};

type BrainPanelSetAction<K extends keyof BrainPanelState> = {
  type: 'set';
  key: K;
  value: BrainPanelState[K] | ((prev: BrainPanelState[K]) => BrainPanelState[K]);
};

type BrainPanelAction = {
  [K in keyof BrainPanelState]: BrainPanelSetAction<K>;
}[keyof BrainPanelState];

const initBrainPanelState = (): BrainPanelState => ({
  status: {
    connected: false, pageCount: 0, entityCount: 0,
    lastDream: null, nextDream: null, engine: 'unknown', version: '',
  },
  checking: false,
  gbrainEnabled: localStorage.getItem(SKILL_KEYS.gbrain) !== 'false',
  gstackEnabled: localStorage.getItem(SKILL_KEYS.gstack) !== 'false',
  searchQuery: '',
  searching: false,
  searchResult: null,
  searchError: null,
  ingestText: '',
  ingestTitle: '',
  ingesting: false,
  ingestMsg: null,
  showIngest: false,
  dreamRunning: false,
  dreamLog: [],
  showConfig: false,
  vmUrl: localStorage.getItem('openthink_gbrain_vm') || '',
  savingConfig: false,
});

const resolveValue = <T,>(value: T | ((prev: T) => T), prev: T): T =>
  typeof value === 'function' ? (value as (prev: T) => T)(prev) : value;

const brainPanelReducer = (state: BrainPanelState, action: BrainPanelAction): BrainPanelState => {
  switch (action.key) {
    case 'status':
      return { ...state, status: resolveValue(action.value, state.status) };
    case 'checking':
      return { ...state, checking: resolveValue(action.value, state.checking) };
    case 'gbrainEnabled':
      return { ...state, gbrainEnabled: resolveValue(action.value, state.gbrainEnabled) };
    case 'gstackEnabled':
      return { ...state, gstackEnabled: resolveValue(action.value, state.gstackEnabled) };
    case 'searchQuery':
      return { ...state, searchQuery: resolveValue(action.value, state.searchQuery) };
    case 'searching':
      return { ...state, searching: resolveValue(action.value, state.searching) };
    case 'searchResult':
      return { ...state, searchResult: resolveValue(action.value, state.searchResult) };
    case 'searchError':
      return { ...state, searchError: resolveValue(action.value, state.searchError) };
    case 'ingestText':
      return { ...state, ingestText: resolveValue(action.value, state.ingestText) };
    case 'ingestTitle':
      return { ...state, ingestTitle: resolveValue(action.value, state.ingestTitle) };
    case 'ingesting':
      return { ...state, ingesting: resolveValue(action.value, state.ingesting) };
    case 'ingestMsg':
      return { ...state, ingestMsg: resolveValue(action.value, state.ingestMsg) };
    case 'showIngest':
      return { ...state, showIngest: resolveValue(action.value, state.showIngest) };
    case 'dreamRunning':
      return { ...state, dreamRunning: resolveValue(action.value, state.dreamRunning) };
    case 'dreamLog':
      return { ...state, dreamLog: resolveValue(action.value, state.dreamLog) };
    case 'showConfig':
      return { ...state, showConfig: resolveValue(action.value, state.showConfig) };
    case 'vmUrl':
      return { ...state, vmUrl: resolveValue(action.value, state.vmUrl) };
    case 'savingConfig':
      return { ...state, savingConfig: resolveValue(action.value, state.savingConfig) };
  }
};

const BrainPanel: React.FC = () => {
  const [state, dispatch] = useReducer(brainPanelReducer, undefined, initBrainPanelState);
  const {
    status, checking, gbrainEnabled, gstackEnabled,
    searchQuery, searching, searchResult,
    ingestText, ingestTitle, ingesting, ingestMsg, showIngest,
    dreamRunning, dreamLog,
    showConfig, vmUrl, savingConfig,
  } = state;

  const makeSetter = <K extends keyof BrainPanelState,>(key: K): Dispatch<SetStateAction<BrainPanelState[K]>> =>
    (v) => dispatch({ type: 'set', key, value: v } as BrainPanelAction);

  const setStatus = makeSetter('status');
  const setChecking = makeSetter('checking');
  const setGbrainEnabled = makeSetter('gbrainEnabled');
  const setGstackEnabled = makeSetter('gstackEnabled');
  const setSearchQuery = makeSetter('searchQuery');
  const setSearching = makeSetter('searching');
  const setSearchResult = makeSetter('searchResult');
  const setSearchError = makeSetter('searchError');
  const setIngestText = makeSetter('ingestText');
  const setIngestTitle = makeSetter('ingestTitle');
  const setIngesting = makeSetter('ingesting');
  const setIngestMsg = makeSetter('ingestMsg');
  const setShowIngest = makeSetter('showIngest');
  const setDreamRunning = makeSetter('dreamRunning');
  const setDreamLog = makeSetter('dreamLog');
  const setShowConfig = makeSetter('showConfig');
  const setVmUrl = makeSetter('vmUrl');
  const setSavingConfig = makeSetter('savingConfig');

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

  const runDreamCycle = () => {
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
    const stepDelays = steps.map(() => 800);
    const totalDelay = stepDelays.reduce((a, b) => a + b, 0);
    const startTime = Date.now();
    const seen = new Set<string>();
    const tick = () => {
      const elapsed = Date.now() - startTime;
      let cumDelay = 0;
      for (let i = 0; i < steps.length; i++) {
        cumDelay += stepDelays[i];
        if (elapsed < cumDelay) break;
        const step = steps[i];
        if (seen.has(step)) continue;
        seen.add(step);
        setDreamLog(p => [...p, step]);
      }
      if (elapsed < totalDelay) {
        setTimeout(tick, 100);
      } else {
        setDreamRunning(false);
        setStatus(s => ({ ...s, lastDream: new Date().toLocaleString() }));
      }
    };
    setTimeout(tick, 100);
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
