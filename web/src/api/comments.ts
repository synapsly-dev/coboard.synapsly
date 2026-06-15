import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  ActivitiesResponse,
  ActivityWithActor,
  CommentsResponse,
  CommentWithAuthor,
  CreateCommentInput,
  UpdateCommentInput,
} from 'shared';
import { api } from './client';
import { queryKeys } from '../lib/query';

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
async function unwrapComment(promise: Promise<CommentsResponse>): Promise<CommentWithAuthor> {
  const res = await promise;
  const comment = res.comments[0];
  if (!comment) {
    throw new Error('服务器未返回评论数据');
  }
  return comment;
}

export const commentsApi = {
  list: (taskId: string, signal?: AbortSignal): Promise<CommentsResponse> =>
    api.get<CommentsResponse>(`/tasks/${taskId}/comments`, { signal }),
  create: (taskId: string, body: CreateCommentInput): Promise<CommentWithAuthor> =>
    unwrapComment(api.post<CommentsResponse>(`/tasks/${taskId}/comments`, body)),
  update: (commentId: string, body: UpdateCommentInput): Promise<CommentWithAuthor> =>
    unwrapComment(api.patch<CommentsResponse>(`/comments/${commentId}`, body)),
  remove: (commentId: string): Promise<void> => api.delete<void>(`/comments/${commentId}`),
  activities: (taskId: string, signal?: AbortSignal): Promise<ActivitiesResponse> =>
    api.get<ActivitiesResponse>(`/tasks/${taskId}/activities`, { signal }),
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Comments for a task (§7 GET /tasks/:id/comments). */
export function useComments(taskId: string | undefined): UseQueryResult<CommentWithAuthor[]> {
  return useQuery<CommentWithAuthor[]>({
    queryKey: taskId ? queryKeys.comments(taskId) : ['tasks', '__none__', 'comments'],
    queryFn: async ({ signal }) => {
      const res = await commentsApi.list(taskId!, signal);
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
      const res = await commentsApi.activities(taskId!, signal);
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
    mutationFn: (body) => commentsApi.create(taskId, body),
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
    mutationFn: ({ commentId, body }) => commentsApi.update(commentId, body),
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
    mutationFn: (commentId) => commentsApi.remove(commentId),
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
