import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { MAX_UPLOAD_BYTES, type TaskFile } from 'shared';
import { queryKeys } from 'client-core';
import { coboardClient } from '../platform/coboard-client';

/**
 * Task file / attachment hooks (§7.2). A task's attachments are listed in the task
 * detail drawer; uploading sends a single file as multipart/form-data. The shared
 * api client only speaks JSON, so the upload uses a direct `fetch` that mirrors the
 * client's conventions (`credentials: 'include'` + the `X-Requested-With` CSRF
 * header) and parses the same `{ error: { code, message } }` shape into an
 * {@link ApiClientError}. Mutations invalidate the files query (and SSE refreshes
 * peers via the `task` channel, §6.5).
 */

/** Single-file upload cap mirrored on the client for a friendly pre-flight guard. */
export const MAX_TASK_FILE_BYTES = MAX_UPLOAD_BYTES;

/** URL of a task file's download stream (served by GET /api/tasks/:id/files/:fileId). */
export function taskFileUrl(taskId: string, fileId: string): string {
  return coboardClient.files.task.url(taskId, fileId);
}

/**
 * URL that asks the server to serve the file INLINE (Content-Disposition: inline)
 * for in-app preview — used as an <img>/<iframe> src. The server only honours this
 * for whitelisted mimes (images + PDF); everything else still downloads.
 */
export function taskFilePreviewUrl(taskId: string, fileId: string): string {
  return coboardClient.files.task.url(taskId, fileId, true);
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** A task's attachments (§7.2 GET /tasks/:id/files), oldest first. */
export function useTaskFiles(taskId: string | undefined): UseQueryResult<TaskFile[]> {
  return useQuery<TaskFile[]>({
    queryKey: taskId ? queryKeys.taskFiles(taskId) : ['tasks', '__none__', 'files'],
    queryFn: async ({ signal }) => {
      const res = await coboardClient.files.task.list(taskId!, signal);
      return res.files;
    },
    enabled: taskId !== undefined,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Upload a file to a task (§7.2 POST /tasks/:id/files). Refreshes the file list. */
export function useUploadTaskFile(taskId: string): UseMutationResult<TaskFile, Error, File> {
  const queryClient = useQueryClient();
  return useMutation<TaskFile, Error, File>({
    mutationFn: (file) => coboardClient.files.task.upload(taskId, file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskFiles(taskId) });
    },
  });
}

/** Delete a task file (§7.2 DELETE /tasks/:id/files/:fileId). Refreshes the list. */
export function useDeleteTaskFile(taskId: string): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (fileId) => coboardClient.files.task.remove(taskId, fileId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskFiles(taskId) });
    },
  });
}
