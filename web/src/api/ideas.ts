import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  AdoptIdeaInput,
  CreateIdeaInput,
  CreateStandaloneIdeaInput,
  Idea,
  IdeaStatus,
  IdeaWithContext,
} from 'shared';
import { queryKeys } from 'client-core';
import { coboardClient } from '../platform/coboard-client';

/**
 * Idea / inspiration hooks (§7.1). Two listing surfaces:
 * - a single task's ideas (rendered in the task detail drawer), and
 * - the cross-project 灵感区 listing (the /ideas page) with an optional status filter.
 *
 * Mutations (post / adopt / reject) invalidate BOTH the idea queries and the stats
 * queries — adopting an idea credits the author's contribution points (§7.1). SSE
 * also refreshes peers via the `idea`/`task` channels (§6.5).
 */

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

/**
 * Unwrap the single-element `{ ideas: [...] }` create response to the lone Idea
 * (mirrors the comments hook's unwrap convention).
 */
// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Ideas posted against a task (§7.1 GET /tasks/:id/ideas), newest first. */
export function useTaskIdeas(taskId: string | undefined): UseQueryResult<Idea[]> {
  return useQuery<Idea[]>({
    queryKey: taskId ? queryKeys.taskIdeas(taskId) : ['tasks', '__none__', 'ideas'],
    queryFn: async ({ signal }) => {
      const res = await coboardClient.ideas.forTask(taskId!, signal);
      return res.ideas;
    },
    enabled: taskId !== undefined,
  });
}

export interface AllIdeasParams {
  status?: IdeaStatus;
}

/** All ideas across the caller's visible projects (§7.1 GET /ideas). */
export function useAllIdeas(params: AllIdeasParams): UseQueryResult<IdeaWithContext[]> {
  return useQuery<IdeaWithContext[]>({
    queryKey: queryKeys.ideas({ status: params.status }),
    queryFn: async ({ signal }) => {
      const res = await coboardClient.ideas.all(params, signal);
      return res.ideas;
    },
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Invalidate every idea listing + the stats queries after an idea mutation. */
function invalidateIdeas(queryClient: ReturnType<typeof useQueryClient>, taskId?: string): void {
  if (taskId) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.taskIdeas(taskId) });
  }
  // Loose prefix: refresh the 灵感区 across every status filter.
  void queryClient.invalidateQueries({ queryKey: ['ideas'] });
  // Adopting/rejecting shifts contribution points (§7.1).
  void queryClient.invalidateQueries({ queryKey: ['stats'] });
}

/** Post an idea on a task (§7.1 POST /tasks/:id/ideas). */
export function useCreateIdea(taskId: string): UseMutationResult<Idea, Error, CreateIdeaInput> {
  const queryClient = useQueryClient();
  return useMutation<Idea, Error, CreateIdeaInput>({
    mutationFn: (body) => coboardClient.ideas.create(taskId, body),
    onSuccess: () => invalidateIdeas(queryClient, taskId),
  });
}

/**
 * Post a STANDALONE idea in the 灵感区 (§7.1 POST /ideas; any logged-in user). No
 * task is involved, so only the cross-project idea list + stats are invalidated.
 */
export function useCreateStandaloneIdea(): UseMutationResult<
  Idea,
  Error,
  CreateStandaloneIdeaInput
> {
  const queryClient = useQueryClient();
  return useMutation<Idea, Error, CreateStandaloneIdeaInput>({
    mutationFn: (body) => coboardClient.ideas.createStandalone(body),
    onSuccess: () => invalidateIdeas(queryClient),
  });
}

export interface AdoptIdeaVars {
  ideaId: string;
  input: AdoptIdeaInput;
  /** Owning task id, so the task's idea list can be invalidated. */
  taskId?: string;
}

/** Adopt an idea + grant reward points (§7.1 POST /ideas/:id/adopt; lead/admin). */
export function useAdoptIdea(): UseMutationResult<Idea, Error, AdoptIdeaVars> {
  const queryClient = useQueryClient();
  return useMutation<Idea, Error, AdoptIdeaVars>({
    mutationFn: ({ ideaId, input }) => coboardClient.ideas.adopt(ideaId, input),
    onSuccess: (_idea, { taskId }) => invalidateIdeas(queryClient, taskId),
  });
}

export interface RejectIdeaVars {
  ideaId: string;
  /** Optional 驳回理由 shown to the author; omit/empty to reject without one. */
  reason?: string;
  /** Owning task id, so the task's idea list can be invalidated. */
  taskId?: string;
}

/** Reject an idea (§7.1 POST /ideas/:id/reject; lead/admin). */
export function useRejectIdea(): UseMutationResult<Idea, Error, RejectIdeaVars> {
  const queryClient = useQueryClient();
  return useMutation<Idea, Error, RejectIdeaVars>({
    mutationFn: ({ ideaId, reason }) =>
      coboardClient.ideas.reject(
        ideaId,
        reason && reason.trim() ? { reason: reason.trim() } : undefined,
      ),
    onSuccess: (_idea, { taskId }) => invalidateIdeas(queryClient, taskId),
  });
}

export interface DeleteIdeaVars {
  ideaId: string;
  /** Owning task id, so the task's idea list can be invalidated. */
  taskId?: string;
}

/**
 * Delete an idea (§7.1 DELETE /ideas/:id; global admin / author / task project
 * lead). Invalidates the task's ideas + the cross-project 灵感区 listing + stats
 * (deleting an adopted idea removes its reward points from the author's total).
 */
export function useDeleteIdea(): UseMutationResult<void, Error, DeleteIdeaVars> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, DeleteIdeaVars>({
    mutationFn: ({ ideaId }) => coboardClient.ideas.remove(ideaId),
    onSuccess: (_void, { taskId }) => invalidateIdeas(queryClient, taskId),
  });
}
