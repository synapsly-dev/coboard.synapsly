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
