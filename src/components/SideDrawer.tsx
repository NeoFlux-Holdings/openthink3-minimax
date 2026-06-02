import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface SideDrawerProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
}

export function SideDrawer({ open, onClose, children, ariaLabel = 'Menu' }: SideDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 900,
        background: 'rgba(0, 0, 0, 0.45)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        animation: 'drawer-fade-in 0.18s ease-out',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(320px, 88vw)',
          height: '100%',
          background: 'var(--bg-primary)',
          borderRight: '1px solid var(--border-subtle)',
          boxShadow: '4px 0 24px rgba(0, 0, 0, 0.45)',
          display: 'flex',
          flexDirection: 'column',
          animation: 'drawer-slide-in 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            padding: '8px 12px 0',
            flexShrink: 0,
          }}
        >
          <button type="button"
            onClick={onClose}
            aria-label="Close menu"
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              touchAction: 'manipulation',
            }}
          >
            <X size={20} />
          </button>
        </div>
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            WebkitOverflowScrolling: 'touch',
            padding: '0 12px calc(24px + env(safe-area-inset-bottom, 0px))',
          }}
        >
          {children}
        </div>
      </aside>
    </div>
  );
}
