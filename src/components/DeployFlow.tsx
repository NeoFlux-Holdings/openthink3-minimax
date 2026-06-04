import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Server, Globe } from 'lucide-react';
import {
  ProgressStepper,
  DomainPicker,
  SubdomainInput,
  BindingPreview,
  AdvancedSettings,
  Step0CloudflareConnect,
  Step1NameAgent,
  Step2CloudflareAccess,
  Step4Review,
  DeployProgress,
} from './DeployFlowParts';
import { useDeployFlow } from '../hooks/useDeployFlow';
import { getCfCreds, type CfCreds } from '../lib/cfCreds';

const DeployFlow = () => {
  const [creds, setCreds] = useState<CfCreds | null>(() => getCfCreds());
  const {
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
  } = useDeployFlow();

  if (!creds) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '64px 24px' }}>
        <Link to="/" className="back-link">
          <Server size={20} color="var(--accent-primary)" /> OpenThink Deploy
        </Link>
        <div style={{ maxWidth: '600px', width: '100%', marginTop: '40px' }}>
          <div className="glass-panel" style={{ padding: '40px', borderRadius: 'var(--radius-lg)' }}>
            <Step0CloudflareConnect onConnected={setCreds} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '64px 24px' }}>

      <Link to="/" className="back-link">
        <Server size={20} color="var(--accent-primary)" /> OpenThink Deploy
      </Link>

      <div style={{ maxWidth: '600px', width: '100%', marginTop: '40px' }}>

        <ProgressStepper step={step} maxStepReached={maxStepReached} onStepSelect={setStep} />

        <div className="glass-panel" style={{ padding: '40px', borderRadius: 'var(--radius-lg)' }}>

          {step === 1 && (
            <Step1NameAgent
              agentName={agentName}
              onAgentNameChange={setAgentName}
              onContinue={() => setStep(2)}
            />
          )}

          {step === 2 && (
            <Step2CloudflareAccess
              onBack={() => setStep(1)}
              onContinue={() => setStep(3)}
            />
          )}

          {step === 3 && (
            <div className="fade-in">
              <div className="row-flex-gap-12">
                <Globe color="var(--accent-tertiary)" />
                <h2 style={{ fontSize: '1.5rem', margin: 0 }}>Domain Setup</h2>
              </div>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '0.9rem', lineHeight: 1.4 }}>
                Attach a custom domain or subdomain to access your agent securely. Cloudflare Access will automatically lock this down to your email.
              </p>

              <DomainPicker
                domains={domains}
                loadingDomains={loadingDomains}
                domainsSource={domainsSource}
                useCustomDomain={useCustomDomain}
                selectedBaseDomain={selectedBaseDomain}
                onSelectDomain={value => {
                  if (value === 'custom') {
                    setUseCustomDomain(true);
                  } else {
                    setUseCustomDomain(false);
                    setSelectedBaseDomain(value);
                  }
                }}
              />

              <SubdomainInput
                useCustomDomain={useCustomDomain}
                subdomain={subdomain}
                selectedBaseDomain={selectedBaseDomain}
                customDomainInput={customDomainInput}
                onSubdomainChange={setSubdomain}
                onCustomDomainChange={setCustomDomainInput}
              />

              <BindingPreview
                useCustomDomain={useCustomDomain}
                subdomain={subdomain}
                selectedBaseDomain={selectedBaseDomain}
                customDomainInput={customDomainInput}
              />

              <AdvancedSettings
                showAdvanced={showAdvanced}
                onToggle={() => setShowAdvanced(!showAdvanced)}
                bypassAccess={bypassAccess}
                onBypassAccessChange={setBypassAccess}
              />

              <div style={{ display: 'flex', gap: '12px' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setStep(2)}>Back</button>
                <button type="button"
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  onClick={() => {
                    setDomain(!useCustomDomain ? `${subdomain}.${selectedBaseDomain}` : customDomainInput);
                    setStep(4);
                  }}
                  disabled={!useCustomDomain ? !subdomain.trim() : !customDomainInput.trim()}
                >
                  Continue Setup
                </button>
              </div>
            </div>
          )}

          {step === 4 && !isDeploying && (
            <Step4Review
              agentName={agentName}
              domain={domain}
              onBack={() => setStep(3)}
              onDeploy={startDeploy}
            />
          )}

          {isDeploying && (
            <DeployProgress
              agentName={agentName}
              steps={deploySteps}
              rawLog={rawLog}
              showRawLog={showRawLog}
              setShowRawLog={setShowRawLog}
              agentUrl={agentUrl}
            />
          )}

        </div>
      </div>

      <style>{`
        .fade-in { animation: fadeIn 0.3s ease-in; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default DeployFlow;
