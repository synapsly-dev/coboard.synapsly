import { useSyncExternalStore } from 'react';

/**
 * Reactively track a CSS media query. Unlike a one-shot `matchMedia().matches`
 * read, this re-renders when the match state flips (e.g. the viewport crosses a
 * breakpoint on resize / device rotation). SSR- and test-safe: when there is no
 * `window`/`matchMedia` it falls back to `defaultMatches` (default: desktop).
 */
export function useMediaQuery(query: string, defaultMatches = true): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return () => {};
      }
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () =>
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(query).matches
        : defaultMatches,
    () => defaultMatches,
  );
}

/**
 * True when the user has asked the OS to reduce motion. The global CSS guard in
 * index.css already neutralizes CSS animations/transitions; use this for the
 * handful of JS-driven motions the CSS can't reach (count-up, chart tweens), so
 * they resolve straight to their final value instead of animating.
 */
export function useReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)', false);
}
