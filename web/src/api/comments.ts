import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  ActivityWithActor,
  CommentWithAuthor,
  CreateCommentInput,
  UpdateCommentInput,
} from 'shared';
import { queryKeys } from 'client-core';
import { coboardClient } from '../platform/coboard-client';

/**
 * Comment + activity hooks (§7). Comments and the activity timeline are scoped to
 * a single task and rendered in the task detail drawer. Posting a comment uses an
 * optimistic insert so it appears instantly; the activity timeline reconciles via
 * invalidation (and SSE for other clients, §6.5).
 */

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

/**
 * The server returns the §5/§7 `CommentsResponse` shape (`{ comments: [...] }`)
 * for create/update — a single-element array holding the affected comment. We
 * unwrap it to the lone `CommentWithAuthor` for ergonomic call sites.
 */
// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Comments for a task (§7 GET /tasks/:id/comments). */
export function useComments(taskId: string | undefined): UseQueryResult<CommentWithAuthor[]> {
  return useQuery<CommentWithAuthor[]>({
    queryKey: taskId ? queryKeys.comments(taskId) : ['tasks', '__none__', 'comments'],
    queryFn: async ({ signal }) => {
      const res = await coboardClient.comments.list(taskId!, signal);
      return res.comments;
    },
    enabled: taskId !== undefined,
  });
}

/** Activity timeline for a task (§7 GET /tasks/:id/activities). */
export function useActivities(taskId: string | undefined): UseQueryResult<ActivityWithActor[]> {
  return useQuery<ActivityWithActor[]>({
    queryKey: taskId ? queryKeys.activities(taskId) : ['tasks', '__none__', 'activities'],
    queryFn: async ({ signal }) => {
      const res = await coboardClient.comments.activities(taskId!, signal);
      return res.activities;
    },
    enabled: taskId !== undefined,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Post a comment (§7 POST /tasks/:id/comments). No optimistic insert without a
 * full author object on hand; instead we refetch comments and the activity
 * timeline (a `commented` activity is recorded) on success.
 */
export function useCreateComment(
  taskId: string,
): UseMutationResult<CommentWithAuthor, Error, CreateCommentInput> {
  const queryClient = useQueryClient();
  return useMutation<CommentWithAuthor, Error, CreateCommentInput>({
    mutationFn: (body) => coboardClient.comments.create(taskId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.comments(taskId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.activities(taskId) });
    },
  });
}

export interface UpdateCommentVars {
  commentId: string;
  body: UpdateCommentInput;
}

/** Edit a comment (§7 PATCH /comments/:id). */
export function useUpdateComment(
  taskId: string,
): UseMutationResult<CommentWithAuthor, Error, UpdateCommentVars> {
  const queryClient = useQueryClient();
  return useMutation<CommentWithAuthor, Error, UpdateCommentVars>({
    mutationFn: ({ commentId, body }) => coboardClient.comments.update(commentId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.comments(taskId) });
    },
  });
}

/** Delete a comment (§7 DELETE /comments/:id). Optimistically removes it. */
export function useDeleteComment(
  taskId: string,
): UseMutationResult<void, Error, string, { previous: CommentWithAuthor[] | undefined }> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string, { previous: CommentWithAuthor[] | undefined }>({
    mutationFn: (commentId) => coboardClient.comments.remove(commentId),
    onMutate: async (commentId) => {
      const key = queryKeys.comments(taskId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<CommentWithAuthor[]>(key);
      if (previous) {
        queryClient.setQueryData<CommentWithAuthor[]>(
          key,
          previous.filter((c) => c.id !== commentId),
        );
      }
      return { previous };
    },
    onError: (_err, _commentId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.comments(taskId), context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.comments(taskId) });
    },
  });
}
