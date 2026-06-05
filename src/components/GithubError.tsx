import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft } from 'lucide-react';

const GithubError: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const error = params.get('error') || 'unknown_error';
  const description = params.get('error_description') || params.get('error_uri') || 'No additional details provided.';

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div className="glass-card" style={{ maxWidth: '480px', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <AlertTriangle size={24} color="#EF4444" />
          <h2 style={{ fontSize: '1.1rem', margin: 0, color: 'var(--text-primary)' }}>GitHub Sign-in Failed</h2>
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', margin: '0 0 12px', lineHeight: 1.5 }}>
          {description}
        </p>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono, monospace)', background: 'rgba(239, 68, 68, 0.08)', padding: '8px 10px', borderRadius: '6px', marginBottom: '16px' }}>
          error: {error}
        </div>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/github')} style={{ width: '100%' }}>
          <ArrowLeft size={14} /> Back to GitHub
        </button>
      </div>
    </div>
  );
};

export default GithubError;
