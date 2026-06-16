import { EventEmitter } from 'node:events';
import type { RealtimeEvent } from 'shared';

/**
 * In-process typed pub/sub for realtime fan-out (§2, §6.5). A single Node process
 * means an EventEmitter is sufficient; if the app ever scales horizontally this is
 * the seam to swap for Redis pub/sub (§11). The SSE route subscribes per project
 * membership and forwards matching events to connected clients.
 */

const CHANNEL = 'event';

export type RealtimeHandler = (event: RealtimeEvent) => void;

export class RealtimeBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // SSE connections can be numerous; lift the default listener cap.
    this.emitter.setMaxListeners(0);
  }

  /** Broadcast an event to all subscribers. The SSE layer does project filtering. */
  publish(event: RealtimeEvent): void {
    this.emitter.emit(CHANNEL, event);
  }

  /**
   * Subscribe to events for a set of project ids. The handler is invoked for events
   * whose `projectId` is in `projectIds`, AND for every no-project event (§8): a
   * `projectId === null` event is on the global channel that all connected users
   * receive. Returns an unsubscribe function.
   */
  subscribe(projectIds: readonly string[], handler: RealtimeHandler): () => void {
    const allowed = new Set(projectIds);
    const listener = (event: RealtimeEvent): void => {
      // No-project events (§8) reach every subscriber; project events are filtered
      // to the subscriber's membership set.
      if (event.projectId === null || allowed.has(event.projectId)) {
        handler(event);
      }
    };
    this.emitter.on(CHANNEL, listener);
    return () => {
      this.emitter.off(CHANNEL, listener);
    };
  }

  /** Current number of active subscribers (useful for diagnostics/tests). */
  subscriberCount(): number {
    return this.emitter.listenerCount(CHANNEL);
  }
}

/** Process-wide singleton bus. */
export const bus = new RealtimeBus();
