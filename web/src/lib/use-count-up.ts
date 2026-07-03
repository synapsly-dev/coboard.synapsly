import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './use-media-query';

/**
 * Animate a number from its last displayed value up to `target` with an ease-out
 * curve. This is the app's one deliberate "count-up" — reserved for the stats
 * hero numbers, not scattered around — so a live/loaded contribution reads as a
 * change rather than a silent value flip.
 *
 * Honors prefers-reduced-motion (and SSR / no rAF): resolves straight to `target`
 * with no animation. Pair with `tabular-nums` at the call site so the width never
 * jitters, and `Math.round` the result for integer display.
 */
export function useCountUp(target: number, durationMs = 600): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduced || typeof requestAnimationFrame !== 'function') {
      fromRef.current = target;
      setValue(target);
      return;
    }
    const from = fromRef.current;
    if (from === target) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const current = from + (target - from) * eased;
      fromRef.current = current;
      setValue(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = target;
        setValue(target);
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs, reduced]);

  return value;
}
