import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { TaskFile, TaskFilesResponse } from 'shared';
import { ApiClientError, api } from './client';
import { queryKeys } from '../lib/query';

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
export const MAX_TASK_FILE_BYTES = 5 * 1024 * 1024;

/** URL of a task file's download stream (served by GET /api/tasks/:id/files/:fileId). */
export function taskFileUrl(taskId: string, fileId: string): string {
  return `/api/tasks/${taskId}/files/${fileId}`;
}

/**
 * URL that asks the server to serve the file INLINE (Content-Disposition: inline)
 * for in-app preview — used as an <img>/<iframe> src. The server only honours this
 * for whitelisted mimes (images + PDF); everything else still downloads.
 */
export function taskFilePreviewUrl(taskId: string, fileId: string): string {
  return `${taskFileUrl(taskId, fileId)}?inline=1`;
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

export const taskFilesApi = {
  list: (taskId: string, signal?: AbortSignal): Promise<TaskFilesResponse> =>
    api.get<TaskFilesResponse>(`/tasks/${taskId}/files`, { signal }),
  remove: (taskId: string, fileId: string): Promise<void> =>
    api.delete<void>(`/tasks/${taskId}/files/${fileId}`),
};

/**
 * Upload one file to a task via multipart/form-data. Uses a direct `fetch` (the
 * shared client is JSON-only) but keeps the same cookie + CSRF-header + error-shape
 * conventions. Never sets a `Content-Type` header — the browser adds the multipart
 * boundary automatically. Returns the created file's metadata.
 */
async function uploadTaskFile(taskId: string, file: File): Promise<TaskFile> {
  const form = new FormData();
  form.append('file', file, file.name);

  let response: Response;
  try {
    response = await fetch(`/api/tasks/${taskId}/files`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        // CSRF guard (§8); the browser sets the multipart Content-Type itself.
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json',
      },
      body: form,
    });
  } catch {
    throw new ApiClientError(0, 'network_error', '网络连接失败，请检查网络后重试');
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const err =
      payload && typeof payload === 'object' && 'error' in payload
        ? (payload as { error: { code: string; message: string } }).error
        : null;
    throw new ApiClientError(
      response.status,
      err?.code ?? 'unexpected_error',
      err?.message ?? '上传失败，请稍后重试',
    );
  }

  const res = payload as TaskFilesResponse;
  const created = res.files[0];
  if (!created) {
    throw new Error('服务器未返回文件数据');
  }
  return created;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** A task's attachments (§7.2 GET /tasks/:id/files), oldest first. */
export function useTaskFiles(taskId: string | undefined): UseQueryResult<TaskFile[]> {
  return useQuery<TaskFile[]>({
    queryKey: taskId ? queryKeys.taskFiles(taskId) : ['tasks', '__none__', 'files'],
    queryFn: async ({ signal }) => {
      const res = await taskFilesApi.list(taskId!, signal);
      return res.files;
    },
    enabled: taskId !== undefined,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Upload a file to a task (§7.2 POST /tasks/:id/files). Refreshes the file list. */
export function useUploadTaskFile(
  taskId: string,
): UseMutationResult<TaskFile, Error, File> {
  const queryClient = useQueryClient();
  return useMutation<TaskFile, Error, File>({
    mutationFn: (file) => uploadTaskFile(taskId, file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskFiles(taskId) });
    },
  });
}

/** Delete a task file (§7.2 DELETE /tasks/:id/files/:fileId). Refreshes the list. */
export function useDeleteTaskFile(
  taskId: string,
): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (fileId) => taskFilesApi.remove(taskId, fileId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskFiles(taskId) });
    },
  });
}
