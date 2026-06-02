import React from 'react';
import { Link } from 'react-router-dom';
import { Bot, Zap, Cloud, Shield, ArrowRight } from 'lucide-react';

const MarketingView = () => {
  return (
    <div style={{ minHeight: '100dvh', overflowY: 'auto', background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column' }}>

      {/* Navbar */}
      <nav style={{
        padding: 'max(16px, env(safe-area-inset-top)) 20px 16px',
        paddingTop: 'max(16px, env(safe-area-inset-top))',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'rgba(10, 10, 10, 0.8)',
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        position: 'sticky', top: 0, zIndex: 50, gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-tertiary))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Bot size={20} color="white" />
          </div>
          <span style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em' }}>OpenThink</span>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <a href="#features" className="btn btn-ghost marketing-nav-link" style={{ fontSize: '0.875rem', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>Features</a>
          <a href="#docs" className="btn btn-ghost marketing-nav-link" style={{ fontSize: '0.875rem', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>Docs</a>
          <Link to="/app" className="btn btn-ghost marketing-nav-link" style={{ fontSize: '0.875rem', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>Go to App</Link>
          <Link to="/deploy" className="btn btn-primary marketing-cta" style={{ borderRadius: 'var(--radius-full)', padding: '10px 20px', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>
            Deploy
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="marketing-hero" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px', position: 'relative' }}>

        {/* Background glow */}
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 'min(600px, 90vw)', height: 'min(600px, 90vw)', background: 'radial-gradient(circle, rgba(139, 92, 246, 0.15) 0%, transparent 70%)', zIndex: 0, pointerEvents: 'none' }} />

        <div style={{ zIndex: 1, maxWidth: '800px', width: '100%' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'rgba(59, 130, 246, 0.1)', color: '#3B82F6', padding: '6px 16px', borderRadius: 'var(--radius-full)', fontSize: '0.875rem', fontWeight: 600, marginBottom: '20px' }}>
            <Zap size={14} fill="currentColor" /> Powered by Cloudflare Workers AI
          </div>
          <h1 className="marketing-h1" style={{ lineHeight: 1.1, marginBottom: '20px', background: 'linear-gradient(to right, #fff, #A1A1AA)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Your personal AI agent,<br/>running on the edge.
          </h1>
          <p className="marketing-p" style={{ color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: '600px', margin: '0 auto 32px' }}>
            OpenThink is an open-source, self-hosted orchestrator that lives entirely on Cloudflare.
            Costs pennies to run, maintains permanent memory, and sets up in one click.
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/deploy" className="btn btn-primary" style={{ borderRadius: 'var(--radius-full)', padding: '14px 24px', fontSize: '1rem', minHeight: 48 }}>
              Deploy in 1-Click <ArrowRight size={18} />
            </Link>
            <a href="https://github.com/NeoFlux-Holdings/openthink3-minimax" target="_blank" rel="noreferrer" className="btn glass-panel" style={{ borderRadius: 'var(--radius-full)', padding: '14px 24px', fontSize: '1rem', color: 'var(--text-primary)', minHeight: 48, touchAction: 'manipulation' }}>
              View Source
            </a>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="marketing-features" style={{ padding: '64px 24px', background: 'var(--bg-secondary)', zIndex: 1 }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <h2 className="marketing-h2" style={{ textAlign: 'center', marginBottom: '48px' }}>Why OpenThink?</h2>
          <div className="marketing-feature-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px' }}>

            <FeatureCard
              icon={<Cloud size={32} color="var(--accent-secondary)" />}
              title="Serverless & Zero Cold Starts"
              desc="Built purely on Cloudflare Workers and Durable Objects. Your agent wakes up instantly when needed and costs nothing when idle."
            />

            <FeatureCard
              icon={<Shield size={32} color="var(--accent-primary)" />}
              title="Your Data, Your Account"
              desc="You own the infrastructure. The agent runs in your Cloudflare account, ensuring ultimate privacy and control over your data."
            />

            <FeatureCard
              icon={<Bot size={32} color="var(--accent-tertiary)" />}
              title="Self-Evolving Architecture"
              desc="Equipped with a learning mode that saves past successes into a Vector database, actively improving its skills over time."
            />

          </div>
        </div>
      </section>
    </div>
  );
};

const FeatureCard = ({ icon, title, desc }: { icon: React.ReactNode, title: string, desc: string }) => (
  <div className="feature-card glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', transition: 'transform 0.2s', cursor: 'default' }}>
    <div style={{ width: '56px', height: '56px', borderRadius: '14px', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {icon}
    </div>
    <h3 style={{ fontSize: '1.125rem', margin: 0 }}>{title}</h3>
    <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>{desc}</p>
  </div>
);

export default MarketingView;
