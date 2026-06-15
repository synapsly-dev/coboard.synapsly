import '@testing-library/react';

/**
 * Vitest + Testing Library setup (§10). jsdom lacks a few browser APIs that Radix
 * primitives touch; stub the minimum so component tests can mount dialogs/selects
 * without crashing. Feature agents extend this as their specs require.
 */

// matchMedia (used by some responsive logic).
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

// ResizeObserver (Radix Select/Popover + Recharts rely on it).
if (!('ResizeObserver' in window)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (window as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
    ResizeObserverStub;
}
