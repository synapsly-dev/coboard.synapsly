import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Pan/zoom state for the org chart canvas (图谱). The viewport is a dedicated,
 * overflow-hidden pane; the world layer inside it is moved with
 * `translate(x,y) scale(k)`. Gestures:
 *
 * - wheel / trackpad → zoom toward the cursor (preventDefault: no page scroll leak)
 * - primary-button drag on empty canvas → pan (grab/grabbing cursor)
 * - two-pointer pinch → zoom toward the midpoint (touch-action:none on the viewport)
 * - double-click on empty canvas → fit (or the caller's override, see
 *   {@link UseCanvasOptions}); keyboard `+`/`=`/`-`/`0` on the focused viewport
 *
 * Button steps (zoomIn/zoomOut/fitTo/reset) animate over ~150ms; gestures never do.
 * The first non-empty layout auto-fits once; afterwards the user's viewport is
 * preserved across data refreshes.
 */

export interface CanvasBounds {
  width: number;
  height: number;
}

export interface CanvasTransform {
  x: number;
  y: number;
  scale: number;
}

export interface FitOptions {
  padding?: number;
  maxScale?: number;
}

export interface UseCanvasOptions {
  /**
   * Replaces the default double-click-on-empty-canvas action (fit). The planet
   * canvas (星系模式) uses this for "up one level"; omit for the default fit.
   */
  onDoubleClick?: () => void;
}

export interface UseCanvasResult {
  viewportRef: React.RefObject<HTMLDivElement>;
  transform: CanvasTransform;
  /** True while a pan/pinch pointer is down (drives the grabbing cursor). */
  dragging: boolean;
  /** True right after a button step — the world layer may transition its transform. */
  animated: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  fitTo: (bounds?: CanvasBounds, options?: FitOptions) => void;
  /** Back to 100%, diagram centered in the viewport. */
  reset: () => void;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 2;
/** Button zoom step (× per click). */
const BUTTON_STEP = 1.25;
/** Multiplicative wheel base: scale ×= WHEEL_BASE^(-deltaY). */
const WHEEL_BASE = 1.0015;
const FIT_PADDING = 48;
/** Slightly past the 150ms transition so the flag never lingers. */
const ANIMATION_RESET_MS = 200;

const clampScale = (scale: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

/** Buttons/menus/inputs own their pointer — never start a pan or fit from them. */
function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('button, a, input, textarea, select, [role="menu"], [role="menuitem"]') !== null
  );
}

function isCardTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-org-card]') !== null;
}

export function useCanvas(bounds: CanvasBounds, options?: UseCanvasOptions): UseCanvasResult {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState<CanvasTransform>({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = useState(false);
  const [animated, setAnimated] = useState(false);

  const transformRef = useRef(transform);
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  // Ref so a changing callback identity never re-wires the gesture listeners.
  const onDoubleClickRef = useRef(options?.onDoubleClick);
  onDoubleClickRef.current = options?.onDoubleClick;
  const didFitRef = useRef(false);
  const animationTimerRef = useRef<number | null>(null);

  const apply = useCallback((next: CanvasTransform, animate: boolean): void => {
    if (animationTimerRef.current != null) {
      window.clearTimeout(animationTimerRef.current);
      animationTimerRef.current = null;
    }
    transformRef.current = next;
    setTransform(next);
    setAnimated(animate);
    if (animate) {
      animationTimerRef.current = window.setTimeout(() => setAnimated(false), ANIMATION_RESET_MS);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (animationTimerRef.current != null) window.clearTimeout(animationTimerRef.current);
    };
  }, []);

  /** Zoom by `factor` keeping the viewport point (px,py) fixed over the world. */
  const zoomAt = useCallback(
    (px: number, py: number, factor: number, animate: boolean): void => {
      const { x, y, scale } = transformRef.current;
      const next = clampScale(scale * factor);
      if (next === scale) return;
      apply(
        {
          scale: next,
          x: px - ((px - x) * next) / scale,
          y: py - ((py - y) * next) / scale,
        },
        animate,
      );
    },
    [apply],
  );

  const zoomStep = useCallback(
    (factor: number): void => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, factor, true);
    },
    [zoomAt],
  );

  const zoomIn = useCallback((): void => zoomStep(BUTTON_STEP), [zoomStep]);
  const zoomOut = useCallback((): void => zoomStep(1 / BUTTON_STEP), [zoomStep]);

  const computeFit = useCallback(
    (target: CanvasBounds, padding: number, maxScale: number): CanvasTransform | null => {
      const viewport = viewportRef.current;
      if (!viewport || target.width <= 0 || target.height <= 0) return null;
      const vw = viewport.clientWidth;
      const vh = viewport.clientHeight;
      const scale = Math.max(
        0.05, // never collapse to zero on degenerate viewports
        Math.min((vw - padding * 2) / target.width, (vh - padding * 2) / target.height, maxScale),
      );
      return {
        scale,
        x: (vw - target.width * scale) / 2,
        y: (vh - target.height * scale) / 2,
      };
    },
    [],
  );

  const fitTo = useCallback(
    (target?: CanvasBounds, options?: FitOptions): void => {
      const next = computeFit(
        target ?? boundsRef.current,
        options?.padding ?? FIT_PADDING,
        options?.maxScale ?? 1,
      );
      if (next) apply(next, true);
    },
    [apply, computeFit],
  );

  const reset = useCallback((): void => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const { width, height } = boundsRef.current;
    apply(
      {
        scale: 1,
        x: (viewport.clientWidth - width) / 2,
        y: (viewport.clientHeight - height) / 2,
      },
      true,
    );
  }, [apply]);

  // Fit once on the FIRST non-empty layout (before paint, no animation); later
  // data refreshes leave the user's viewport alone.
  useLayoutEffect(() => {
    if (didFitRef.current || bounds.width <= 0 || bounds.height <= 0) return;
    didFitRef.current = true;
    const next = computeFit(bounds, FIT_PADDING, 1);
    if (next) apply(next, false);
  }, [bounds, apply, computeFit]);

  // Gesture wiring. Native listeners: wheel must be non-passive (React registers
  // it passively, so preventDefault would be ignored) and pointer capture keeps
  // pans alive outside the pane.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    /** Live pointers (clientX/Y); 1 = pan, 2 = pinch. */
    const pointers = new Map<number, { x: number; y: number }>();

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      zoomAt(
        event.clientX - rect.left,
        event.clientY - rect.top,
        Math.pow(WHEEL_BASE, -delta),
        false,
      );
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (isInteractiveTarget(event.target)) return;
      viewport.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) setDragging(true);
    };

    const onPointerMove = (event: PointerEvent): void => {
      const prev = pointers.get(event.pointerId);
      if (!prev) return;
      const current = { x: event.clientX, y: event.clientY };

      if (pointers.size === 2) {
        // Pinch: zoom by the distance ratio toward the (moving) midpoint.
        const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
        if (other) {
          const rect = viewport.getBoundingClientRect();
          const prevMidX = (prev.x + other.x) / 2 - rect.left;
          const prevMidY = (prev.y + other.y) / 2 - rect.top;
          const nextMidX = (current.x + other.x) / 2 - rect.left;
          const nextMidY = (current.y + other.y) / 2 - rect.top;
          const prevDist = Math.hypot(prev.x - other.x, prev.y - other.y);
          const nextDist = Math.hypot(current.x - other.x, current.y - other.y);

          const { x, y, scale } = transformRef.current;
          const nextScale = prevDist > 0 ? clampScale(scale * (nextDist / prevDist)) : scale;
          apply(
            {
              scale: nextScale,
              x: nextMidX - ((prevMidX - x) * nextScale) / scale,
              y: nextMidY - ((prevMidY - y) * nextScale) / scale,
            },
            false,
          );
        }
      } else {
        const { x, y, scale } = transformRef.current;
        apply({ scale, x: x + current.x - prev.x, y: y + current.y - prev.y }, false);
      }

      pointers.set(event.pointerId, current);
    };

    const onPointerEnd = (event: PointerEvent): void => {
      if (!pointers.delete(event.pointerId)) return;
      if (viewport.hasPointerCapture(event.pointerId)) {
        viewport.releasePointerCapture(event.pointerId);
      }
      if (pointers.size === 0) setDragging(false);
    };

    const onDoubleClick = (event: MouseEvent): void => {
      if (isInteractiveTarget(event.target) || isCardTarget(event.target)) return;
      event.preventDefault();
      const override = onDoubleClickRef.current;
      if (override) override();
      else fitTo();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.target !== viewport) return; // only the focused viewport itself
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoomIn();
      } else if (event.key === '-') {
        event.preventDefault();
        zoomOut();
      } else if (event.key === '0') {
        event.preventDefault();
        fitTo();
      }
    };

    viewport.addEventListener('wheel', onWheel, { passive: false });
    viewport.addEventListener('pointerdown', onPointerDown);
    viewport.addEventListener('pointermove', onPointerMove);
    viewport.addEventListener('pointerup', onPointerEnd);
    viewport.addEventListener('pointercancel', onPointerEnd);
    viewport.addEventListener('dblclick', onDoubleClick);
    viewport.addEventListener('keydown', onKeyDown);
    return () => {
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('pointerdown', onPointerDown);
      viewport.removeEventListener('pointermove', onPointerMove);
      viewport.removeEventListener('pointerup', onPointerEnd);
      viewport.removeEventListener('pointercancel', onPointerEnd);
      viewport.removeEventListener('dblclick', onDoubleClick);
      viewport.removeEventListener('keydown', onKeyDown);
    };
  }, [apply, fitTo, zoomAt, zoomIn, zoomOut]);

  return { viewportRef, transform, dragging, animated, zoomIn, zoomOut, fitTo, reset };
}
