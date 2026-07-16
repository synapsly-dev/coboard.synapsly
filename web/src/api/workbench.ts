import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { Task } from 'shared';
import { queryKeys } from 'client-core';
import { coboardClient } from '../platform/coboard-client';

/**
 * 工作台 data hooks (P2 §4). Two personal read endpoints:
 * - `GET /me/review-queue` — pending_review tasks the caller can act on (初审 for
 *   leads/赛道经理/admins; admins additionally get first-approved ones awaiting 复核).
 * - `GET /me/rejected-tasks` — the caller's recently 驳回'd tasks.
 *
 * Both live under the `['workbench']` key prefix so the SSE layer (lib/sse.ts) and
 * the task mutations can refresh them with a single blanket invalidation.
 */

/** Tasks awaiting the caller's review (P2 §4 GET /me/review-queue). */
export function useReviewQueue(): UseQueryResult<Task[]> {
  return useQuery<Task[]>({
    queryKey: queryKeys.reviewQueue(),
    queryFn: async ({ signal }) => {
      const res = await coboardClient.workbench.reviewQueue(signal);
      return res.tasks;
    },
  });
}

/** The caller's recently rejected (被退回) tasks (P2 §4 GET /me/rejected-tasks). */
export function useRejectedTasks(): UseQueryResult<Task[]> {
  return useQuery<Task[]>({
    queryKey: queryKeys.rejectedTasks(),
    queryFn: async ({ signal }) => {
      const res = await coboardClient.workbench.rejectedTasks(signal);
      return res.tasks;
    },
  });
}
