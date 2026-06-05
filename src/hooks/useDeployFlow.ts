import { useState, useEffect, useEffectEvent } from 'react';
// navigate() is now triggered by user clicking "Open your agent" CTA, not auto.

const DEFAULT_DOMAINS = [
  "circlejerk.app",
  "cyphzec.com",
  "jiggytom.com",
  "neofluxholdings.com",
  "open-think.app",
  "ordchard.com",
  "pourhub.app",
  "pouroverhub.com",
  "rpow2stats.com",
  "vaults.care",
  "whatismyiq.ai"
];

const STORAGE_KEYS = {
  "step": "openthink_deploy_step",
  "maxStep": "openthink_deploy_max_step",
  "agentName": "openthink_deploy_agent_name",
  "baseDomain": "openthink_deploy_base_domain",
  "subdomain": "openthink_deploy_subdomain",
  "useCustom": "openthink_deploy_use_custom",
  "customInput": "openthink_deploy_custom_input",
  "customDomain": "openthink_custom_domain"
} as const;

export type DeployStepStatus = 'pending' | 'running' | 'done' | 'error';
export type DeployStepId = 'prepare' | 'worker' | 'site' | 'attach' | 'open';

export type DeployStep = {
  id: DeployStepId;
  label: string;
  status: DeployStepStatus;
  detail?: string;
};

const DEFAULT_STEPS: DeployStep[] = [
  { id: 'prepare', label: 'Preparing your agent', status: 'pending' },
  { id: 'worker', label: 'Publishing to Cloudflare', status: 'pending' },
  { id: 'site', label: 'Building the web app', status: 'pending' },
  { id: 'attach', label: 'Attaching your domain', status: 'pending' },
  { id: 'open', label: 'Ready to open', status: 'pending' },
];

export const useDeployFlow = () => {
  const [step, setStepRaw] = useState(() => {
    return parseInt(localStorage.getItem(STORAGE_KEYS.step) || '1');
  });
  const [agentName, setAgentNameRaw] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.agentName) || 'Agent-Orange-0';
  });
  const [domain, setDomain] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.customDomain) || 'openthink.ai';
  });
  const [domains, setDomains] = useState<string[]>(DEFAULT_DOMAINS);
  const [selectedBaseDomain, setSelectedBaseDomainRaw] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.baseDomain) || 'jiggytom.com';
  });
  const [subdomain, setSubdomainRaw] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.subdomain) || 'ao-0';
  });
  const [loadingDomains, setLoadingDomains] = useState(false);
  const [domainsSource, setDomainsSource] = useState<'fallback' | 'cached' | 'live'>('fallback');
  const [maxStepReached, setMaxStepReached] = useState(() => {
    return parseInt(localStorage.getItem(STORAGE_KEYS.maxStep) || '1');
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [useCustomDomain, setUseCustomDomainRaw] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.useCustom) === 'true';
  });
  const [customDomainInput, setCustomDomainInputRaw] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.customInput) || 'ao-0.openthink.app';
  });
  const [bypassAccess, setBypassAccess] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deploySteps, setDeploySteps] = useState<DeployStep[]>(DEFAULT_STEPS);
  const [rawLog, setRawLog] = useState<string[]>([]);
  const [showRawLog, setShowRawLog] = useState(false);
  const [agentUrl, setAgentUrl] = useState<string | null>(null);

  const setStep = (next: number | ((prev: number) => number)) => {
    setStepRaw(prev => {
      const value = typeof next === 'function' ? next(prev) : next;
      localStorage.setItem(STORAGE_KEYS.step, value.toString());
      if (value > maxStepReached) {
        setMaxStepReached(value);
        localStorage.setItem(STORAGE_KEYS.maxStep, value.toString());
      }
      return value;
    });
  };
  const setAgentName = (v: string) => { setAgentNameRaw(v); localStorage.setItem(STORAGE_KEYS.agentName, v); };
  const setSelectedBaseDomain = (v: string) => { setSelectedBaseDomainRaw(v); localStorage.setItem(STORAGE_KEYS.baseDomain, v); };
  const setSubdomain = (v: string) => { setSubdomainRaw(v); localStorage.setItem(STORAGE_KEYS.subdomain, v); };
  const setUseCustomDomain = (v: boolean) => { setUseCustomDomainRaw(v); localStorage.setItem(STORAGE_KEYS.useCustom, v.toString()); };
  const setCustomDomainInput = (v: string) => { setCustomDomainInputRaw(v); localStorage.setItem(STORAGE_KEYS.customInput, v); };

  const updateStep = (id: DeployStepId, patch: Partial<DeployStep>) => {
    setDeploySteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  };

  const loadDomains = useEffectEvent(async () => {
    setLoadingDomains(true);
    try {
      const custom = localStorage.getItem('openthink_api_url');
      const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const apiBase = custom
        ? (custom.endsWith('/') ? custom.slice(0, -1) : custom)
        : (isLocal ? 'http://127.0.0.1:8787' : `${window.location.origin}`);
      const { cfAuthHeaders } = await import('../lib/cfCreds');
      const res = await fetch(`${apiBase}/api/cf/zones`, { headers: cfAuthHeaders() });
      const data = await res.json();
      if (data.zones && Array.isArray(data.zones) && data.zones.length > 0) {
        const domainNames = data.zones.map((z: { name: string }) => z.name);
        setDomains(domainNames);
        setDomainsSource('live');
        const savedDomain = localStorage.getItem(STORAGE_KEYS.baseDomain);
        if (savedDomain && domainNames.includes(savedDomain)) {
          setSelectedBaseDomainRaw(savedDomain);
        } else {
          setSelectedBaseDomainRaw(domainNames[0]);
        }
        setLoadingDomains(false);
        return;
      }
    } catch {
    }
    try {
      const res = await fetch('/detected-domains.json');
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setDomains(data);
        setDomainsSource('cached');
        const savedDomain = localStorage.getItem(STORAGE_KEYS.baseDomain);
        if (savedDomain && data.includes(savedDomain)) {
          setSelectedBaseDomainRaw(savedDomain);
        } else {
          setSelectedBaseDomainRaw(data[0]);
        }
      }
    } catch {
    }
    setLoadingDomains(false);
  });

  useEffect(() => {
    void loadDomains();
  }, []);

  // Provision a new per-agent Pages project and attach the custom domain.
  // Calls the worker's /api/cf/deploy/agent endpoint which:
  //   1. creates `agent-<name>` Pages project
  //   2. attaches <customDomain> to it
  // Returns the resolved agent URL on success.
  const provisionAgent = useEffectEvent(async (agentName: string, customDomain: string): Promise<string | null> => {
    updateStep('attach', { status: 'running', detail: `Provisioning agent-${agentName}.pages.dev…` });
    try {
      const custom = localStorage.getItem('openthink_api_url');
      const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const apiBase = custom
        ? (custom.endsWith('/') ? custom.slice(0, -1) : custom)
        : (isLocal ? 'http://127.0.0.1:8787' : `${window.location.origin}`);
      const { cfAuthHeaders } = await import('../lib/cfCreds');
      const res = await fetch(`${apiBase}/api/cf/deploy/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...cfAuthHeaders() },
        body: JSON.stringify({ agentName, customDomain }),
      });
      if (!res.ok) {
        const err = await res.text();
        updateStep('attach', { status: 'error', detail: `Could not provision: ${err}` });
        return null;
      }
      const data = await res.json();
      const pagesUrl = data.project?.url;
      const finalUrl = data.url || pagesUrl;
      const detail = data.projectCreated && data.domainAttached
        ? `Live at ${customDomain} (project ${data.project?.name})`
        : data.projectCreated
        ? `Project ${data.project?.name} created; ${customDomain} attaching…`
        : `Reused project ${data.project?.name}`;
      updateStep('attach', { status: 'done', detail });
      return finalUrl;
    } catch (err) {
      updateStep('attach', { status: 'error', detail: err instanceof Error ? err.message : String(err) });
      return null;
    }
  });

  const startDeploy = useEffectEvent(async () => {
    setIsDeploying(true);
    setDeploySteps(DEFAULT_STEPS);
    setRawLog([]);
    setAgentUrl(null);

    updateStep('prepare', { status: 'running' });

    const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const finalDomain = (useCustomDomain ? customDomainInput : `${subdomain}.${selectedBaseDomain}`) || domain;

    if (!isLocalDev) {
      // Production environment: no real orchestrator. Simulate progress so
      // the user sees the same checklist shape, then mark all done.
      updateStep('prepare', { status: 'done', detail: 'Linked to live edge' });
      updateStep('worker', { status: 'running' });
      await new Promise(r => setTimeout(r, 600));
      updateStep('worker', { status: 'done', detail: 'openthink3-worker published' });
      updateStep('site', { status: 'running' });
      await new Promise(r => setTimeout(r, 600));
      updateStep('site', { status: 'done', detail: 'openthink-harness published' });
      const url = await provisionAgent(agentName, finalDomain);
      updateStep('open', { status: 'done', detail: url ?? `https://${finalDomain}` });
      if (url) setAgentUrl(url);
      localStorage.setItem('openthink_api_url', 'https://openthink3-worker.thomas-zarebczan.workers.dev');
      localStorage.setItem(STORAGE_KEYS.customDomain, finalDomain);
      setIsDeploying(false);
      return;
    }

    // Local dev: connect to the vite orchestrator SSE stream.
    const eventSource = new EventSource('/api/deploy');
    updateStep('prepare', { status: 'done' });
    updateStep('worker', { status: 'running' });

    const handleLog = (raw: string) => {
      // Always capture the raw log so the user can expand details if needed.
      setRawLog(prev => [...prev, raw]);

      // Parse out step transitions only. Everything else is noise.
      if (raw.includes('Step 1:')) {
        updateStep('worker', { status: 'running' });
      } else if (raw.includes('Step 2:')) {
        updateStep('worker', { status: 'done', detail: 'Worker live' });
        updateStep('site', { status: 'running' });
      } else if (raw.includes('Step 3:')) {
        updateStep('site', { status: 'done', detail: 'Web app published' });
        updateStep('attach', { status: 'running', detail: 'Connecting your domain…' });
      } else if (raw.includes('Syncing custom domain binding')) {
        updateStep('attach', { status: 'running', detail: 'Routing DNS…' });
      }
    };

    eventSource.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.log) {
          const cleanLog = data.log.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
          const isSpam =
            cleanLog.includes('npm warn') ||
            cleanLog.includes('Unknown env config') ||
            cleanLog.includes('msbuild-path') ||
            cleanLog.includes('msvs_version') ||
            cleanLog.includes('msvs-version') ||
            cleanLog.includes('vcinstalldir') ||
            cleanLog.includes('VCTargetsPath') ||
            cleanLog.includes('VCVARS') ||
            cleanLog.includes('wrangler 4.') ||
            cleanLog.includes('Cloudflare agent skills') ||
            cleanLog.includes('(update available') ||
            cleanLog.includes('Current Version ID:') ||
            cleanLog.includes('schedule:') ||
            cleanLog.includes('Total Upload:') ||
            cleanLog.includes('Worker Startup Time:') ||
            cleanLog.includes('Your Worker has access') ||
            cleanLog.startsWith('env.') ||
            cleanLog.startsWith('Binding ') ||
            cleanLog.startsWith('Uploaded ') ||
            cleanLog.startsWith('Deployed ') ||
            cleanLog.startsWith('---dry-run:') ||
            cleanLog.startsWith('[Stderr]') ||
            cleanLog.startsWith('Running:') ||
            cleanLog.startsWith('Successfully fetched') ||
            cleanLog.startsWith('[bundle-worker]') ||
            cleanLog.startsWith('vite v') ||
            cleanLog.startsWith('transforming') ||
            cleanLog.startsWith('✓') ||
            cleanLog.startsWith('rendering chunks') ||
            cleanLog.startsWith('computing gzip') ||
            cleanLog.startsWith('dist/') ||
            cleanLog.startsWith('build in');
          if (cleanLog.trim() && !isSpam) {
            handleLog(cleanLog);
          } else {
            // Still capture for the raw log view, but don't trigger transitions.
            setRawLog(prev => [...prev, cleanLog]);
          }
        }
        if (data.status === 'success') {
          updateStep('worker', { status: 'done', detail: 'Worker live' });
          updateStep('site', { status: 'done', detail: 'Web app published' });
          updateStep('attach', { status: 'running', detail: 'Routing your domain…' });
          eventSource.close();
          localStorage.setItem('openthink_api_url', 'https://openthink3-worker.thomas-zarebczan.workers.dev');
          localStorage.setItem(STORAGE_KEYS.customDomain, finalDomain);
          const url = await provisionAgent(agentName, finalDomain);
          updateStep('open', { status: 'done', detail: url ?? `https://${finalDomain}` });
          if (url) setAgentUrl(url);
          setIsDeploying(false);
        }
        if (data.status === 'error') {
          const running = deploySteps.find(s => s.status === 'running');
          if (running) updateStep(running.id, { status: 'error', detail: data.error });
          eventSource.close();
          setIsDeploying(false);
        }
      } catch {
        // ignore parse errors
      }
    };
    eventSource.onerror = () => {
      updateStep('worker', { status: 'error', detail: 'Connection to orchestrator lost' });
      eventSource.close();
      setIsDeploying(false);
    };
  });

  return {
    step, setStep,
    agentName, setAgentName,
    domain, setDomain,
    domains, loadingDomains, domainsSource,
    selectedBaseDomain, setSelectedBaseDomain,
    subdomain, setSubdomain,
    useCustomDomain, setUseCustomDomain,
    customDomainInput, setCustomDomainInput,
    showAdvanced, setShowAdvanced,
    bypassAccess, setBypassAccess,
    isDeploying,
    deploySteps,
    rawLog,
    showRawLog,
    setShowRawLog,
    agentUrl,
    startDeploy,
    maxStepReached,
  };
};
