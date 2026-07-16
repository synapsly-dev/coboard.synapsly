import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { CreateTaskTextInput, TaskText } from 'shared';
import { queryKeys } from 'client-core';
import { coboardClient } from '../platform/coboard-client';

/**
 * Task text-deliverable hooks (交付内容 §7.2). Text deliverables are listed in the
 * task detail drawer alongside attachments; any member with task visibility may
 * submit, and the author or a project lead/admin may delete. Mutations invalidate
 * the list, and SSE refreshes peers via the `task` channel (§6.5).
 */

/** A task's text deliverables (oldest first). */
export function useTaskTexts(taskId: string | undefined): UseQueryResult<TaskText[]> {
  return useQuery<TaskText[]>({
    queryKey: taskId ? queryKeys.taskTexts(taskId) : ['tasks', '__none__', 'texts'],
    queryFn: async ({ signal }) => (await coboardClient.taskTexts.list(taskId!, signal)).texts,
    enabled: taskId !== undefined,
  });
}

/** Submit a text deliverable; returns the created one and refreshes the list. */
export function useCreateTaskText(
  taskId: string,
): UseMutationResult<TaskText, Error, CreateTaskTextInput> {
  const queryClient = useQueryClient();
  return useMutation<TaskText, Error, CreateTaskTextInput>({
    mutationFn: async (input) => {
      const res = await coboardClient.taskTexts.create(taskId, input);
      const created = res.texts[0];
      if (!created) throw new Error('服务器未返回交付内容');
      return created;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskTexts(taskId) });
    },
  });
}

/** Delete a text deliverable; refreshes the list. */
export function useDeleteTaskText(taskId: string): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (textId) => coboardClient.taskTexts.remove(taskId, textId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskTexts(taskId) });
    },
  });
}
