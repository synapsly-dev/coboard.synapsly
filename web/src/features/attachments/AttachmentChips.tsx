import { useRef, useState } from 'react';
import { Download, Paperclip, Plus, X } from 'lucide-react';
import type { Attachment } from 'shared';
import { isImageMime, isInlinePreviewable } from 'shared';
import { isApiClientError } from '../../api/client';
import {
  MAX_ATTACHMENT_BYTES,
  attachmentPreviewUrl,
  attachmentUrl,
  deleteAttachment,
  uploadAttachment,
  type AttachmentOwner,
} from '../../api/attachments';
import { formatFileSize } from '../task/AttachmentSection';
import { FilePreviewDialog } from './FilePreviewDialog';

/**
 * Attachment display for ideas / comments: image thumbnails (click → lightbox)
 * ahead of compact file chips (PDF chips preview, everything else downloads).
 * Only inline-whitelisted images get thumbnails — a .tif/.heic would neither be
 * served inline nor decode in an <img>, so those fall back to download chips.
 *
 * `canUpload` (the author, per the server rule) shows an 添加附件 button that
 * uploads immediately — the recovery path when a composer's post-create upload
 * partially failed, and the way to add files to an existing comment/idea.
 * Deletion is gated per file via `canDeleteFile`. Both report through
 * `onChanged` so the owning list query refetches. Clicks never bubble — cards
 * hosting this (e.g. 灵感区) are clickable.
 */
export interface AttachmentChipsProps {
  owner: AttachmentOwner;
  ownerId: string;
  files: Attachment[];
  /** Per-file delete gate; omit for a read-only display. */
  canDeleteFile?: (file: Attachment) => boolean;
  /** Show the 添加附件 upload affordance (server allows the author only). */
  canUpload?: boolean;
  /** Called after a successful upload/delete (invalidate the owning query). */
  onChanged?: () => void;
}

export function AttachmentChips({
  owner,
  ownerId,
  files,
  canDeleteFile,
  canUpload = false,
  onChanged,
}: AttachmentChipsProps): JSX.Element | null {
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  if (files.length === 0 && !canUpload) return null;

  // Thumbnails only for images the server will actually serve inline.
  const images = files.filter((f) => isImageMime(f.mime) && isInlinePreviewable(f.mime));
  const others = files.filter((f) => !images.includes(f));

  async function handleDelete(file: Attachment): Promise<void> {
    if (!window.confirm(`确定删除附件「${file.filename}」？`)) return;
    setError(null);
    setDeletingId(file.id);
    try {
      await deleteAttachment(owner, ownerId, file.id);
      onChanged?.();
    } catch (err) {
      setError(isApiClientError(err) ? err.message : '删除失败，请稍后重试');
    } finally {
      setDeletingId(null);
    }
  }

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    setError(null);
    const picked = Array.from(e.target.files ?? []);
    // Allow re-selecting the same file later by clearing the input value.
    e.target.value = '';
    if (picked.length === 0) return;

    const oversized = picked.find((f) => f.size > MAX_ATTACHMENT_BYTES || f.size === 0);
    if (oversized) {
      setError(oversized.size === 0 ? '文件为空' : '文件过大，单个文件不能超过 5MB');
      return;
    }

    setUploading(true);
    try {
      for (const file of picked) {
        await uploadAttachment(owner, ownerId, file);
      }
      onChanged?.();
    } catch (err) {
      setError(isApiClientError(err) ? err.message : '上传失败，请稍后重试');
      onChanged?.(); // earlier files in the batch may have landed
    } finally {
      setUploading(false);
    }
  }

  function deleteButton(file: Attachment): JSX.Element | null {
    if (!canDeleteFile?.(file)) return null;
    return (
      <button
        type="button"
        aria-label={`删除 ${file.filename}`}
        title="删除"
        disabled={deletingId === file.id}
        onClick={() => void handleDelete(file)}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-destructive disabled:opacity-50"
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    );
  }

  return (
    // Host cards (灵感区) are clickable — attachment interactions must not bubble.
    <div className="mt-2 flex min-w-0 flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
      {images.length > 0 && (
        <div className="flex flex-wrap items-start gap-1.5">
          {images.map((file) => (
            <span key={file.id} className="relative inline-flex">
              <button
                type="button"
                onClick={() => setPreview(file)}
                aria-label={`预览 ${file.filename}`}
                title={file.filename}
                className="overflow-hidden rounded-md border border-border bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <img
                  src={attachmentPreviewUrl(owner, ownerId, file.id)}
                  alt={file.filename}
                  loading="lazy"
                  className="h-16 w-16 object-cover"
                />
              </button>
              {canDeleteFile?.(file) && (
                <span className="absolute -right-1.5 -top-1.5 rounded-full bg-background shadow-sm">
                  {deleteButton(file)}
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      {(others.length > 0 || canUpload) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {others.map((file) => {
            const previewable = isInlinePreviewable(file.mime);
            const label = (
              <>
                <Paperclip className="h-3 w-3 shrink-0" aria-hidden />
                <span className="max-w-[12rem] truncate">{file.filename}</span>
                <span className="shrink-0 text-muted-foreground">
                  {formatFileSize(file.sizeBytes)}
                </span>
              </>
            );
            return (
              <span
                key={file.id}
                className="inline-flex items-center gap-1 rounded-full bg-secondary py-0.5 pl-2.5 pr-1.5 text-xs text-secondary-foreground"
              >
                {previewable ? (
                  <button
                    type="button"
                    onClick={() => setPreview(file)}
                    aria-label={`预览 ${file.filename}`}
                    title={file.filename}
                    className="inline-flex min-w-0 items-center gap-1 hover:text-foreground"
                  >
                    {label}
                  </button>
                ) : (
                  <a
                    href={attachmentUrl(owner, ownerId, file.id)}
                    download={file.filename}
                    aria-label={`下载 ${file.filename}`}
                    title={file.filename}
                    className="inline-flex min-w-0 items-center gap-1 hover:text-foreground"
                  >
                    {label}
                    <Download className="h-3 w-3 shrink-0" aria-hidden />
                  </a>
                )}
                {deleteButton(file)}
              </span>
            );
          })}

          {canUpload && (
            <>
              <button
                type="button"
                disabled={uploading}
                onClick={() => inputRef.current?.click()}
                aria-label="添加附件"
                title="添加附件"
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
              >
                <Plus className="h-3 w-3" aria-hidden />
                {uploading ? '上传中…' : '添加附件'}
              </button>
              <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                aria-hidden
                onChange={(e) => void handlePick(e)}
              />
            </>
          )}
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <FilePreviewDialog
        file={preview}
        previewSrc={preview ? attachmentPreviewUrl(owner, ownerId, preview.id) : ''}
        downloadUrl={preview ? attachmentUrl(owner, ownerId, preview.id) : ''}
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      />
    </div>
  );
}
