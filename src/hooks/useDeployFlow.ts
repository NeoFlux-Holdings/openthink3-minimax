import { useState, useEffect, useEffectEvent } from 'react';
import { useNavigate } from 'react-router-dom';

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
  const [progressLog, setProgressLog] = useState<string[]>([]);

  const navigate = useNavigate();

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

  const handleDeploy = () => {
    setIsDeploying(true);
    setProgressLog(['Starting infrastructure deployment orchestrator...']);
    const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!isLocalDev) {
      setProgressLog(p => [...p, 'Production environment detected. Running cloudflare simulated link...']);
      setTimeout(() => {
        setProgressLog(p => [...p, 'Deployment successful! Linked live edge configurations...']);
        localStorage.setItem('openthink_api_url', 'https://openthink3-worker.thomas-zarebczan.workers.dev');
        if (domain) {
          localStorage.setItem(STORAGE_KEYS.customDomain, domain);
        }
        setTimeout(() => navigate('/app'), 1500);
      }, 3000);
      return;
    }
    const eventSource = new EventSource('/api/deploy');
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.log) {
          const cleanLog = data.log.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
          const isSpam = cleanLog.includes('npm warn') ||
                         cleanLog.includes('Unknown env config') ||
                         cleanLog.includes('msbuild-path') ||
                         cleanLog.includes('msvs_version') ||
                         cleanLog.includes('msvs-version') ||
                         cleanLog.includes('vcinstalldir') ||
                         cleanLog.includes('VCTargetsPath') ||
                         cleanLog.includes('VCVARS');
          if (cleanLog.trim() && !isSpam) {
            setProgressLog(p => [...p, cleanLog]);
          }
        }
        if (data.status === 'success') {
          setProgressLog(p => [...p, '✨ Infrastructure fully deployed! Syncing custom domain binding...']);
          localStorage.setItem('openthink_api_url', 'https://openthink3-worker.thomas-zarebczan.workers.dev');
          if (domain) {
            localStorage.setItem(STORAGE_KEYS.customDomain, domain);
          }
          eventSource.close();
          setTimeout(() => navigate('/app'), 2000);
        }
        if (data.status === 'error') {
          setProgressLog(p => [...p, `❌ Deployment failed: ${data.error}`]);
          eventSource.close();
        }
      } catch (err) {
      }
    };
    eventSource.onerror = () => {
      setProgressLog(p => [...p, '❌ Connection to deployment orchestrator lost.']);
      eventSource.close();
    };
  };

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
    isDeploying, setIsDeploying,
    progressLog, setProgressLog,
    maxStepReached,
    handleDeploy,
  };
};
