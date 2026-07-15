import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
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
function invalidateForEvent(queryClient: QueryClient, event: RealtimeEvent): void {
  const { projectId, entity, payload } = event;
  const taskId = typeof payload['taskId'] === 'string' ? payload['taskId'] : undefined;

  switch (entity) {
    case 'task': {
      // Board for the project (when scoped) + the "全部项目" board (§8), which
      // aggregates project tasks AND no-project pool tasks (projectId === null).
      if (projectId) {
        void queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'tasks'] });
      }
      void queryClient.invalidateQueries({ queryKey: ['projects', 'all', 'tasks'] });
      if (taskId) {
        void queryClient.invalidateQueries({ queryKey: ['tasks', taskId] });
        // A task event also carries delivery-content changes (§7.2): file
        // attachments and text deliverables.
        void queryClient.invalidateQueries({ queryKey: ['tasks', taskId, 'files'] });
        void queryClient.invalidateQueries({ queryKey: ['tasks', taskId, 'texts'] });
      }
      // Completing/reopening a task changes contribution stats.
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      // 工作台 lists (P2 §4: review queue / rejected) mirror task state.
      void queryClient.invalidateQueries({ queryKey: ['workbench'] });
      break;
    }
    case 'comment': {
      if (taskId) {
        void queryClient.invalidateQueries({ queryKey: ['tasks', taskId, 'comments'] });
        void queryClient.invalidateQueries({ queryKey: ['tasks', taskId, 'activities'] });
      }
      break;
    }
    case 'activity': {
      if (taskId) {
        void queryClient.invalidateQueries({ queryKey: ['tasks', taskId, 'activities'] });
      }
      break;
    }
    case 'project': {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      break;
    }
    case 'idea': {
      // Refresh the task's idea list, the cross-project 灵感区, and the recomputed
      // stats (adopting an idea credits the author's contribution points, §7.1).
      if (taskId) {
        void queryClient.invalidateQueries({ queryKey: ['tasks', taskId, 'ideas'] });
      }
      void queryClient.invalidateQueries({ queryKey: ['ideas'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      break;
    }
    case 'announcement': {
      // An admin published/edited/removed a 信息 notice — refresh the list.
      void queryClient.invalidateQueries({ queryKey: ['announcements'] });
      break;
    }
    case 'org': {
      // An editor changed the team org tree (团队架构), or an application (岗位申报,
      // P1) was created / withdrawn / decided. Refresh every scope's tree AND the
      // applications lists — both live under the `['org']` prefix (`['org', scope]`
      // and `['org', 'applications', scope]`) — since the payload's scope is enough
      // context and both datasets are small.
      void queryClient.invalidateQueries({ queryKey: ['org'] });
      break;
    }
    case 'asset': {
      // Someone created/edited/deleted a 资产 (P3 §1) — refresh every filtered
      // listing under the `['assets']` prefix.
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      break;
    }
    case 'track': {
      // An admin created/edited/deleted a 赛道 or reassigned a project's track (P0
      // §2). Refresh the track list, the projects list (grouping + projectCount),
      // and the per-track stats rollup.
      void queryClient.invalidateQueries({ queryKey: ['tracks'] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['stats', 'tracks'] });
      void queryClient.invalidateQueries({ queryKey: ['org'] });
      break;
    }
    case 'notification': {
      // Private notification events have already been recipient-filtered by the
      // SSE endpoint. Refresh both the bell badge and every open list/filter.
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      break;
    }
    default: {
      // Exhaustiveness guard — unreachable for known entities.
      const _never: never = entity;
      void _never;
    }
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
