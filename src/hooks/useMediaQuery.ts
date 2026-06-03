import { useEffect, useState } from 'react';

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

const QUERIES: Record<Exclude<Breakpoint, 'desktop'>, string> = {
  mobile: '(max-width: 767.98px)',
  tablet: '(min-width: 768px) and (max-width: 1023.98px)',
};

const STORAGE_KEY = 'openthink:breakpoint';

function detectBreakpoint(): Breakpoint {
  if (typeof window === 'undefined') return 'desktop';
  if (window.matchMedia(QUERIES.mobile).matches) return 'mobile';
  if (window.matchMedia(QUERIES.tablet).matches) return 'tablet';
  return 'desktop';
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(() => {
    if (typeof window === 'undefined') return 'desktop';
    try {
      const saved = window.sessionStorage.getItem(STORAGE_KEY) as Breakpoint | null;
      if (saved === 'mobile' || saved === 'tablet' || saved === 'desktop') return saved;
    } catch { /* SSR / privacy mode */ }
    return detectBreakpoint();
  });

  useEffect(() => {
    const update = () => {
      const next = detectBreakpoint();
      setBp((prev) => {
        if (prev !== next) {
          try { window.sessionStorage.setItem(STORAGE_KEY, next); } catch { /* noop */ }
        }
        return next;
      });
    };
    const mqlMobile = window.matchMedia(QUERIES.mobile);
    const mqlTablet = window.matchMedia(QUERIES.tablet);
    mqlMobile.addEventListener('change', update);
    mqlTablet.addEventListener('change', update);
    return () => {
      mqlMobile.removeEventListener('change', update);
      mqlTablet.removeEventListener('change', update);
    };
  }, []);

  return bp;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);

  return matches;
}

export function useIsMobile(): boolean {
  return useBreakpoint() === 'mobile';
}

export function useIsTouchDevice(): boolean {
  const [isTouch, setIsTouch] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  });
  useEffect(() => {
    const update = () => {
      setIsTouch('ontouchstart' in window || navigator.maxTouchPoints > 0);
    };
    window.addEventListener('touchstart', update, { once: true, passive: true });
    return () => window.removeEventListener('touchstart', update);
  }, []);
  return isTouch;
}
