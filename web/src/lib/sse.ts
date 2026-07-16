import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { affectedQueryKeys } from 'client-core';
import type { RealtimeEntity, RealtimeEvent } from 'shared';
import { useAuth } from './auth-context';

/**
 * Realtime layer (§6.5). Opens an `EventSource` to `/api/stream` while the user
 * is authenticated and translates incoming events into TanStack Query
 * invalidations. The user's own writes use optimistic updates elsewhere; this
 * keeps other clients' views fresh. The browser's EventSource auto-reconnects on
 * transient drops.
 *
 * The server sends one named event per realtime entity (`event: task|comment|
 * activity|project`) whose `data` is the full {@link RealtimeEvent} JSON. We
 * listen on each named channel and invalidate the queries that depend on it.
 */

const STREAM_URL = '/api/stream';

/** All realtime entity channels the server may emit (mirrors §6.5). */
const ENTITY_CHANNELS: readonly RealtimeEntity[] = [
  'task',
  'comment',
  'activity',
  'project',
  'idea',
  'announcement',
  'org',
  'track',
  'asset',
  'notification',
];

function safeParse(raw: string): RealtimeEvent | null {
  try {
    const parsed = JSON.parse(raw) as Partial<RealtimeEvent>;
    if (
      parsed &&
      // §8: a no-project (pool) event carries projectId === null.
      (typeof parsed.projectId === 'string' || parsed.projectId === null) &&
      typeof parsed.entity === 'string'
    ) {
      return parsed as RealtimeEvent;
    }
  } catch {
    // Ignore malformed payloads — heartbeats/comments never reach handlers.
  }
  return null;
}

/**
 * Invalidate the queries affected by one realtime event. Uses loose, prefix-based
 * keys (e.g. `['projects', projectId, 'tasks']`) so a single event refreshes the
 * board, its task details, comments, activities, and recomputed stats.
 */
export function invalidateForEvent(queryClient: QueryClient, event: RealtimeEvent): void {
  for (const queryKey of affectedQueryKeys(event)) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

/**
 * Hook that maintains the SSE connection for the lifetime of an authenticated
 * session. Mount it once (via {@link RealtimeListener}) high in the tree.
 */
export function useRealtimeStream(): void {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isAuthenticated) return;

    const source = new EventSource(STREAM_URL, { withCredentials: true });

    const handler = (e: MessageEvent<string>): void => {
      const event = safeParse(e.data);
      if (event) {
        invalidateForEvent(queryClient, event);
      }
    };

    for (const channel of ENTITY_CHANNELS) {
      source.addEventListener(channel, handler as EventListener);
    }
    // Also handle unnamed `message` events as a fallback.
    source.addEventListener('message', handler as EventListener);

    return () => {
      for (const channel of ENTITY_CHANNELS) {
        source.removeEventListener(channel, handler as EventListener);
      }
      source.removeEventListener('message', handler as EventListener);
      source.close();
    };
  }, [isAuthenticated, queryClient]);
}

/**
 * Invisible component that activates the realtime stream. Render it inside the
 * authenticated app tree (App.tsx) so it mounts only when a session exists.
 */
export function RealtimeListener(): null {
  useRealtimeStream();
  return null;
}
