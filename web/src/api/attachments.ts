import type { Attachment, AttachmentsResponse } from 'shared';
import { ApiClientError, api, isApiClientError } from './client';

/**
 * Idea / comment attachment helpers. Mirrors the task-file conventions (§7.2):
 * multipart upload via a direct `fetch` (the shared client is JSON-only) with the
 * same cookie + CSRF-header + error-shape handling, and `?inline=1` preview URLs
 * that the server only honours for whitelisted mimes (images + PDF). Attachment
 * metadata is embedded in the idea/comment wire shapes (`files`), so there are no
 * list queries here — callers invalidate the owning idea/comment query instead.
 */

/** Which entity a file hangs off — maps 1:1 onto the API path prefix. */
export type AttachmentOwner = 'ideas' | 'comments';

/** Single-file upload cap mirrored on the client for a friendly pre-flight guard. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** URL of an attachment's download stream. */
export function attachmentUrl(owner: AttachmentOwner, ownerId: string, fileId: string): string {
  return `/api/${owner}/${ownerId}/files/${fileId}`;
}

/** URL that asks the server to serve the file INLINE (whitelisted mimes only). */
export function attachmentPreviewUrl(
  owner: AttachmentOwner,
  ownerId: string,
  fileId: string,
): string {
  return `${attachmentUrl(owner, ownerId, fileId)}?inline=1`;
}

/** Delete one attachment (uploader / lead — enforced server-side). */
export function deleteAttachment(
  owner: AttachmentOwner,
  ownerId: string,
  fileId: string,
): Promise<void> {
  return api.delete<void>(`/${owner}/${ownerId}/files/${fileId}`);
}

/**
 * Upload one file via multipart/form-data. Never sets a `Content-Type` header —
 * the browser adds the multipart boundary automatically.
 */
export async function uploadAttachment(
  owner: AttachmentOwner,
  ownerId: string,
  file: File,
): Promise<Attachment> {
  const form = new FormData();
  form.append('file', file, file.name);

  let response: Response;
  try {
    response = await fetch(`/api/${owner}/${ownerId}/files`, {
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

  // Guard the happy-path shape too: a 2xx with a mangled/empty body must fail
  // controlled (the server may still have stored the file — the refetch shows it).
  const created =
    payload && typeof payload === 'object' && Array.isArray((payload as AttachmentsResponse).files)
      ? (payload as AttachmentsResponse).files[0]
      : undefined;
  if (!created) {
    throw new Error('服务器未返回文件数据');
  }
  return created;
}

export interface UploadAttachmentsResult {
  uploaded: number;
  failed: number;
  /** Message of the first failure, for the composer's warning line. */
  firstError: string | null;
}

/**
 * Upload the composer's pending files one by one (the server takes a single file
 * per request). Never throws — the owning idea/comment was already created, so
 * partial failure is reported back for a warning instead of aborting the flow.
 */
export async function uploadAttachments(
  owner: AttachmentOwner,
  ownerId: string,
  files: readonly File[],
): Promise<UploadAttachmentsResult> {
  let uploaded = 0;
  let failed = 0;
  let firstError: string | null = null;
  for (const file of files) {
    try {
      await uploadAttachment(owner, ownerId, file);
      uploaded += 1;
    } catch (err) {
      failed += 1;
      if (!firstError) {
        firstError = isApiClientError(err) ? err.message : '上传失败，请稍后重试';
      }
    }
  }
  return { uploaded, failed, firstError };
}
