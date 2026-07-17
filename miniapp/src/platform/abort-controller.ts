type AbortListener = (event: { type: 'abort'; target: MiniAbortSignal }) => void;

class MiniAbortSignal {
  aborted = false;
  reason: unknown;
  onabort: AbortListener | null = null;
  private listeners = new Map<AbortListener, boolean>();

  addEventListener(type: string, listener: AbortListener, options?: boolean | { once?: boolean }): void {
    if (type !== 'abort') return;
    this.listeners.set(listener, typeof options === 'object' && options.once === true);
  }

  removeEventListener(type: string, listener: AbortListener): void {
    if (type === 'abort') this.listeners.delete(listener);
  }

  throwIfAborted(): void {
    if (this.aborted) throw this.reason;
  }

  dispatchAbort(): void {
    if (this.aborted) return;
    this.aborted = true;
    this.reason = new Error('The operation was aborted');
    const event = { type: 'abort' as const, target: this };
    this.onabort?.(event);
    for (const [listener, once] of this.listeners) {
      listener(event);
      if (once) this.listeners.delete(listener);
    }
  }
}

class MiniAbortController {
  readonly signal = new MiniAbortSignal();

  abort(): void {
    this.signal.dispatchAbort();
  }
}

/** Install the small DOM API surface TanStack Query needs in the WeChat logic layer. */
export function ensureAbortController(): void {
  const runtime = globalThis as typeof globalThis & {
    AbortController?: typeof AbortController;
    AbortSignal?: typeof AbortSignal;
  };
  if (typeof runtime.AbortController === 'undefined') {
    runtime.AbortController = MiniAbortController as unknown as typeof AbortController;
  }
  if (typeof runtime.AbortSignal === 'undefined') {
    runtime.AbortSignal = MiniAbortSignal as unknown as typeof AbortSignal;
  }
}
