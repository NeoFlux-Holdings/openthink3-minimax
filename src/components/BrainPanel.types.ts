import type React from 'react';

export interface BrainStatus {
  connected: boolean;
  pageCount: number;
  entityCount: number;
  lastDream: string | null;
  nextDream: string | null;
  engine: 'pglite' | 'postgres' | 'unknown';
  version: string;
}

export interface SearchResult {
  title: string;
  content: string;
  citations: string[];
  gaps: string[];
  score: number;
}

export const panel: React.CSSProperties = {
  background: 'rgba(255,255,255,0.02)',
  border: '1px solid var(--border-subtle)',
  borderRadius: '10px',
  padding: '16px',
};

export const skillCard = (active: boolean, color: string): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '12px 14px',
  borderRadius: '8px',
  background: active ? `${color}08` : 'rgba(255,255,255,0.015)',
  border: `1px solid ${active ? `${color}25` : 'var(--border-subtle)'}`,
  transition: 'background ease 0.2s, color ease 0.2s, border-color ease 0.2s, transform ease 0.2s, opacity ease 0.2s, box-shadow ease 0.2s',
});
