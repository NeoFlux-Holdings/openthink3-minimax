import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Cloud, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { exchangeCode } from '../lib/githubApp';

const GithubCallback: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [status, setStatus] = useState<'working' | 'success' | 'error'>('working');
  const [message, setMessage] = useState('Exchanging code for access token…');

  useEffect(() => {
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');
    const errorDescription = params.get('error_description');
    if (error) {
      setStatus('error');
      setMessage(errorDescription || error);
      return;
    }
    if (!code) {
      setStatus('error');
      setMessage('No authorization code returned by GitHub.');
      return;
    }
    if (!state) {
      setStatus('error');
      setMessage('Missing state parameter.');
      return;
    }
    const expected = sessionStorage.getItem('openthink_gh_oauth_state');
    if (expected && expected !== state) {
      setStatus('error');
      setMessage('State mismatch — possible CSRF. Please retry.');
      return;
    }
    sessionStorage.removeItem('openthink_gh_oauth_state');
    const redirectUri = `${window.location.origin}/oauth/github/callback`;
    exchangeCode(code, redirectUri)
      .then((r) => {
        if (r.signedIn) {
          setStatus('success');
          setMessage(r.user ? `Signed in as ${r.user.login}` : 'Signed in to GitHub');
          setTimeout(() => navigate('/github?connected=1'), 1200);
        } else {
          setStatus('error');
          setMessage('Token exchange failed.');
        }
      })
      .catch((e: any) => {
        setStatus('error');
        setMessage(e?.message || String(e));
      });
  }, [params, navigate]);

  const color = status === 'success' ? '#10B981' : status === 'error' ? '#EF4444' : 'var(--accent-primary)';
  const Icon = status === 'success' ? CheckCircle : status === 'error' ? AlertCircle : Loader2;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div className="glass-card" style={{ maxWidth: '420px', width: '100%', textAlign: 'center' }}>
        <Icon size={32} color={color} className={status === 'working' ? 'spin' : ''} style={{ margin: '0 auto 12px' }} />
        <h2 style={{ fontSize: '1.1rem', margin: '0 0 8px', color: 'var(--text-primary)' }}>
          {status === 'working' ? 'Connecting GitHub' : status === 'success' ? 'Connected' : 'Connection Failed'}
        </h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', margin: 0, lineHeight: 1.5 }}>{message}</p>
        {status === 'error' && (
          <button type="button" className="btn btn-primary" onClick={() => navigate('/github')} style={{ marginTop: '16px' }}>
            <Cloud size={14} /> Back to GitHub
          </button>
        )}
      </div>
    </div>
  );
};

export default GithubCallback;
