import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { BoardResponse, Task } from 'shared';
import { api } from './client';
import { queryKeys } from '../lib/query';

/**
 * 工作台 data hooks (P2 §4). Two personal read endpoints:
 * - `GET /me/review-queue` — pending_review tasks the caller can act on (初审 for
 *   leads/赛道经理/admins; admins additionally get first-approved ones awaiting 复核).
 * - `GET /me/rejected-tasks` — the caller's recently 驳回'd tasks.
 *
 * Both live under the `['workbench']` key prefix so the SSE layer (lib/sse.ts) and
 * the task mutations can refresh them with a single blanket invalidation.
 */

export const workbenchApi = {
  reviewQueue: (signal?: AbortSignal): Promise<BoardResponse> =>
    api.get<BoardResponse>('/me/review-queue', { signal }),
  rejectedTasks: (signal?: AbortSignal): Promise<BoardResponse> =>
    api.get<BoardResponse>('/me/rejected-tasks', { signal }),
};

/** Tasks awaiting the caller's review (P2 §4 GET /me/review-queue). */
export function useReviewQueue(): UseQueryResult<Task[]> {
  return useQuery<Task[]>({
    queryKey: queryKeys.reviewQueue(),
    queryFn: async ({ signal }) => {
      const res = await workbenchApi.reviewQueue(signal);
      return res.tasks;
    },
  });
}

/** The caller's recently rejected (被退回) tasks (P2 §4 GET /me/rejected-tasks). */
export function useRejectedTasks(): UseQueryResult<Task[]> {
  return useQuery<Task[]>({
    queryKey: queryKeys.rejectedTasks(),
    queryFn: async ({ signal }) => {
      const res = await workbenchApi.rejectedTasks(signal);
      return res.tasks;
    },
  });
}
