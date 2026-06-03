import { useEffect, useEffectEvent, type ReactNode, useRef } from 'react';
import { X } from 'lucide-react';

interface SideDrawerProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
}

export function SideDrawer({ open, onClose, children, ariaLabel = 'Menu' }: SideDrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseEvent = useEffectEvent(onClose);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseEvent(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open) return null;

  const onBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      onClick={onBackdropClick}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      role="presentation"
      className="drawer-backdrop"
    >
      <dialog
        ref={ref}
        open
        aria-label={ariaLabel}
        aria-modal="true"
        className="drawer-panel"
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
      </dialog>
    </div>
  );
}
