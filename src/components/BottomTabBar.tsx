import { MessageSquare, LayoutGrid, Wrench, User as UserIcon, Plus } from 'lucide-react';

export type MobileTab = 'chat' | 'canvas' | 'tools' | 'account';

interface BottomTabBarProps {
  active: MobileTab;
  onChange: (tab: MobileTab) => void;
  onNewThread: () => void;
  onOpenMenu: () => void;
}

const TABS: { id: MobileTab; label: string; icon: typeof MessageSquare }[] = [
  { id: 'chat',    label: 'Chat',    icon: MessageSquare },
  { id: 'canvas',  label: 'Canvas',  icon: LayoutGrid },
  { id: 'tools',   label: 'Tools',   icon: Wrench },
  { id: 'account', label: 'Account', icon: UserIcon },
];

export function BottomTabBar({ active, onChange, onNewThread, onOpenMenu }: BottomTabBarProps) {
  return (
    <nav
      aria-label="Primary"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 200,
        background: 'var(--bg-elevated)',
        borderTop: '1px solid var(--border-subtle)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        boxShadow: '0 -2px 16px rgba(0, 0, 0, 0.3)',
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'space-around',
      }}
    >
      <TabButton
        label="Menu"
        onClick={onOpenMenu}
        isActive={false}
        leadingDots
      />
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.id;
        return (
          <TabButton
            key={tab.id}
            label={tab.label}
            onClick={() => onChange(tab.id)}
            isActive={isActive}
          >
            <Icon
              size={22}
              strokeWidth={isActive ? 2.4 : 1.8}
              color={isActive ? 'var(--accent-primary)' : 'var(--text-tertiary)'}
            />
          </TabButton>
        );
      })}
      <TabButton
        label="New"
        onClick={onNewThread}
        isActive={false}
        accent
      >
        <Plus size={24} strokeWidth={2.2} color="white" />
      </TabButton>
    </nav>
  );
}

interface TabButtonProps {
  label: string;
  onClick: () => void;
  isActive: boolean;
  children?: React.ReactNode;
  leadingDots?: boolean;
  accent?: boolean;
}

function TabButton({ label, onClick, isActive, children, leadingDots, accent }: TabButtonProps) {
  return (
    <button type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={isActive ? 'page' : undefined}
      style={{
        flex: 1,
        minHeight: 56,
        background: 'transparent',
        border: 'none',
        color: isActive ? 'var(--accent-primary)' : 'var(--text-tertiary)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        cursor: 'pointer',
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
        padding: '6px 0',
        position: 'relative',
      }}
    >
      {leadingDots ? (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
          <span style={{ width: 18, height: 2, borderRadius: 1, background: 'var(--text-tertiary)' }} />
          <span style={{ width: 18, height: 2, borderRadius: 1, background: 'var(--text-tertiary)' }} />
          <span style={{ width: 18, height: 2, borderRadius: 1, background: 'var(--text-tertiary)' }} />
        </span>
      ) : accent ? (
        <span
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.35)',
            marginTop: -8,
          }}
        >
          {children}
        </span>
      ) : (
        children
      )}
      <span
        style={{
          fontSize: '0.75rem',
          fontWeight: isActive ? 700 : 500,
          letterSpacing: '0.01em',
          color: isActive ? 'var(--accent-primary)' : 'var(--text-tertiary)',
        }}
      >
        {label}
      </span>
      {isActive && !leadingDots && !accent && (
        <span
          style={{
            position: 'absolute',
            top: 4,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 18,
            height: 2,
            borderRadius: 1,
            background: 'var(--accent-primary)',
          }}
        />
      )}
    </button>
  );
}
