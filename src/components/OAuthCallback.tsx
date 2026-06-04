import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle, RefreshCw, Cloud } from 'lucide-react';
import { handleCallback, CF_OAUTH_CONFIG } from '../lib/cfOAuth';

export default function OAuthCallback() {
  const [status, setStatus] = useState<'working' | 'success' | 'error'>('working');
  const [detail, setDetail] = useState<string>('');
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!CF_OAUTH_CONFIG.isConfigured()) {
        setStatus('error');
        setDetail('OAuth client is not configured. Set CF_OAUTH_CLIENT_ID in src/lib/cfOAuth.ts.');
        return;
      }
      const r = await handleCallback();
      if (cancelled) return;
      if (r.ok) {
        setStatus('success');
        setDetail('Connected to Cloudflare.');
        const target = r.redirectTo ?? '/app';
        setTimeout(() => {
          navigate(target, { replace: true });
        }, 600);
      } else {
        setStatus('error');
        setDetail(r.description || r.error || 'Unknown error');
      }
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      background: 'var(--bg-primary)',
    }}>
      <div className="glass-card" style={{
        maxWidth: '440px',
        width: '100%',
        padding: '32px',
        textAlign: 'center',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
          {status === 'working' && <Cloud size={36} color="var(--accent-secondary)" />}
          {status === 'success' && <CheckCircle2 size={36} color="#10B981" />}
          {status === 'error' && <XCircle size={36} color="#EF4444" />}
        </div>
        <h2 style={{ fontSize: '1.25rem', margin: '0 0 8px', color: 'var(--text-primary)' }}>
          {status === 'working' && 'Finishing Cloudflare sign-in…'}
          {status === 'success' && 'Connected'}
          {status === 'error' && 'Could not connect'}
        </h2>
        <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.9rem' }}>
          {status === 'working' && 'Exchanging authorization code for an access token.'}
          {status === 'success' && detail}
          {status === 'error' && detail}
        </p>
        {status === 'working' && (
          <div style={{ marginTop: '16px' }}>
            <RefreshCw size={20} className="spin" color="var(--accent-secondary)" />
          </div>
        )}
        {status === 'error' && (
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: '20px' }}
            onClick={() => navigate('/deploy', { replace: true })}
          >
            Back to Deploy
          </button>
        )}
        <style>{`
          .spin { animation: spin 1s linear infinite; }
          @keyframes spin { 100% { transform: rotate(360deg); } }
        `}</style>
      </div>
    </div>
  );
}
