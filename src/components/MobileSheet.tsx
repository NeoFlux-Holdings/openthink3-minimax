import { useEffect, useEffectEvent, type ReactNode, useRef } from 'react';
import { X } from 'lucide-react';

interface MobileSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Optional icon shown next to the title. */
  icon?: ReactNode;
  /** Color for the icon / accent. */
  accentColor?: string;
}

export function MobileSheet({ open, onClose, title, children, icon }: MobileSheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseEvent = useEffectEvent(onClose);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseEvent();
    };
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
      className="sheet-backdrop"
      style={{ zIndex: 50, paddingTop: 'max(48px, env(safe-area-inset-top, 0px))', paddingLeft: 'env(safe-area-inset-left, 0px)', paddingRight: 'env(safe-area-inset-right, 0px)' }}
    >
      <dialog
        ref={ref}
        open
        aria-label={title}
        aria-modal="true"
        className="sheet-panel"
        style={{ maxHeight: 'calc(100dvh - 64px)', height: 'min(90dvh, 760px)' }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-elevated)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            {icon && (
              <div
                className="icon-badge"
              >
                {icon}
              </div>
            )}
            <h2
              style={{
                margin: 0,
                fontSize: '1rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {title}
            </h2>
          </div>
          <button type="button"
            onClick={onClose}
            aria-label="Close"
            className="icon-btn-circle icon-btn-circle--36"
          >
            <X size={18} />
          </button>
        </div>
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            WebkitOverflowScrolling: 'touch',
            padding: '20px',
            paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
          }}
        >
          {children}
        </div>
      </dialog>
    </div>
  );
}
