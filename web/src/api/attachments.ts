import { MAX_UPLOAD_BYTES, type Attachment } from 'shared';
import { type AttachmentOwner } from 'client-core';
import { isApiClientError } from './client';
import { coboardClient } from '../platform/coboard-client';

/**
 * Idea / comment attachment helpers. Mirrors the task-file conventions (§7.2):
 * multipart upload via a direct `fetch` (the shared client is JSON-only) with the
 * same cookie + CSRF-header + error-shape handling, and `?inline=1` preview URLs
 * that the server only honours for whitelisted mimes (images + PDF). Attachment
 * metadata is embedded in the idea/comment wire shapes (`files`), so there are no
 * list queries here — callers invalidate the owning idea/comment query instead.
 */

/** Which entity a file hangs off — maps 1:1 onto the API path prefix. */
export type { AttachmentOwner } from 'client-core';

/** Single-file upload cap mirrored on the client for a friendly pre-flight guard. */
export const MAX_ATTACHMENT_BYTES = MAX_UPLOAD_BYTES;

/** URL of an attachment's download stream. */
export function attachmentUrl(owner: AttachmentOwner, ownerId: string, fileId: string): string {
  return coboardClient.files.attachment.url(owner, ownerId, fileId);
}

/** URL that asks the server to serve the file INLINE (whitelisted mimes only). */
export function attachmentPreviewUrl(
  owner: AttachmentOwner,
  ownerId: string,
  fileId: string,
): string {
  return coboardClient.files.attachment.url(owner, ownerId, fileId, true);
}

/** Delete one attachment (uploader / lead — enforced server-side). */
export function deleteAttachment(
  owner: AttachmentOwner,
  ownerId: string,
  fileId: string,
): Promise<void> {
  return coboardClient.files.attachment.remove(owner, ownerId, fileId);
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
  return coboardClient.files.attachment.upload(owner, ownerId, file);
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
