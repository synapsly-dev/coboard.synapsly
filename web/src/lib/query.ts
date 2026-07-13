import { QueryClient } from '@tanstack/react-query';
import { isApiClientError } from '../api/client';

/**
 * Shared TanStack Query client (§3). Conservative defaults: realtime freshness is
 * driven primarily by SSE invalidation (§6.5), so we keep a short stale time and
 * avoid retrying genuine client errors (4xx) which won't succeed on retry.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Don't retry auth/permission/validation/not-found/conflict errors.
        if (isApiClientError(error) && error.status >= 400 && error.status < 500) {
          return false;
        }
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

/**
 * Centralized query-key factory so feature hooks and the SSE layer agree on keys.
 * Downstream agents extend this; keep keys structured (array form) for partial
 * invalidation (e.g. invalidate all of a project's tasks).
 */
export const queryKeys = {
  /** Public probe of which sign-in affordances the login page should show. */
  authConfig: () => ['auth', 'config'] as const,
  settings: () => ['settings'] as const,
  me: () => ['auth', 'me'] as const,
  users: () => ['users'] as const,
  projects: () => ['projects'] as const,
  projectDirectory: () => ['projects', 'directory'] as const,
  /** All 赛道 (tracks, P0 §2) visible to the current user. */
  tracks: () => ['tracks'] as const,
  /** Public-safe active users available to an authorized track roster editor. */
  trackMemberCandidates: (trackId: string) => ['tracks', trackId, 'member-candidates'] as const,
  project: (projectId: string) => ['projects', projectId] as const,
  projectMembers: (projectId: string) => ['projects', projectId, 'members'] as const,
  board: (projectId: string) => ['projects', projectId, 'tasks'] as const,
  /**
   * The "全部项目" board (§8 GET /tasks/all). Deliberately shares the
   * `board('all')` shape so the optimistic-update helpers (which key on a
   * `projectId`) operate on this cache when the board is in all-projects mode.
   */
  allTasks: () => ['projects', 'all', 'tasks'] as const,
  /** The global label catalog (task-labels feature). */
  labels: () => ['labels'] as const,
  task: (taskId: string) => ['tasks', taskId] as const,
  /** Structured 审核记录 for one task (P2 §2 GET /tasks/:id/reviews). */
  taskReviews: (taskId: string) => ['tasks', taskId, 'reviews'] as const,
  comments: (taskId: string) => ['tasks', taskId, 'comments'] as const,
  activities: (taskId: string) => ['tasks', taskId, 'activities'] as const,
  taskIdeas: (taskId: string) => ['tasks', taskId, 'ideas'] as const,
  taskFiles: (taskId: string) => ['tasks', taskId, 'files'] as const,
  /** A task's text deliverables (交付内容). */
  taskTexts: (taskId: string) => ['tasks', taskId, 'texts'] as const,
  ideas: (params: Record<string, string | undefined>) => ['ideas', params] as const,
  /** Admin-published 信息 notices. */
  announcements: () => ['announcements'] as const,
  /** The org tree (团队架构) for a scope ('all' or a project id). */
  orgTree: (scope: string) => ['org', scope] as const,
  /**
   * 岗位申报 (P1) for a scope. Deliberately nested under the `['org']` prefix so the
   * SSE layer's blanket `['org']` invalidation refreshes applications too. No key
   * collision with {@link orgTree}: a scope is only ever 'all' or a project uuid.
   */
  orgApplications: (scope: string) => ['org', 'applications', scope] as const,
  leaderboard: (params: Record<string, string | undefined>) =>
    ['stats', 'leaderboard', params] as const,
  myStats: (params: Record<string, string | undefined>) => ['stats', 'me', params] as const,
  trend: (params: Record<string, string | undefined>) => ['stats', 'trend', params] as const,
  /** Contribution rolled up by 赛道 (P0 §2 GET /stats/tracks). */
  trackStats: (params: Record<string, string | undefined>) => ['stats', 'tracks', params] as const,
  /**
   * 资产库 (P3 §1) listings, parameterized by the server-side filters. Nested
   * under the `['assets']` prefix so mutations and the SSE layer refresh every
   * filtered view with one blanket invalidation.
   */
  assets: (kind?: string, trackId?: string) => ['assets', kind ?? 'all', trackId ?? 'all'] as const,
  /** 工作台 (P2 §4): pending_review tasks the caller can act on. */
  reviewQueue: () => ['workbench', 'review-queue'] as const,
  /** 工作台 (P2 §4): the caller's recently rejected tasks. */
  rejectedTasks: () => ['workbench', 'rejected-tasks'] as const,
};
