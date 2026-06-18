import { useRef, useState } from 'react';
import { Download, Eye, Paperclip, Trash2, Upload } from 'lucide-react';
import type { Task, TaskFile } from 'shared';
import { isImageMime, isInlinePreviewable } from 'shared';
import { Button, Spinner } from '../../components/ui';
import { isApiClientError } from '../../api/client';
import {
  MAX_TASK_FILE_BYTES,
  taskFilePreviewUrl,
  taskFileUrl,
  useDeleteTaskFile,
  useTaskFiles,
  useUploadTaskFile,
} from '../../api/task-files';
import type { TaskPermissionContext } from '../board/permissions';
import { isManager } from '../board/permissions';
import { FilePreviewDialog } from './FilePreviewDialog';

/**
 * Attachment section (§7.2) inside the task detail drawer — "用于交付一些文件内容".
 * An 上传文件 button (a hidden file input guarded client-side at ≤5MB before upload),
 * plus the file list (filename, human-readable size, uploader) with a 下载 link and a
 * 删除 action visible to the uploader or a project lead/admin. The server re-enforces
 * the cap + the delete permission.
 */

export interface AttachmentSectionProps {
  task: Task;
  permCtx: TaskPermissionContext;
}

/** Format a byte count into a compact human-readable size ("12.3 KB" / "1.2 MB"). */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

export function AttachmentSection({ task, permCtx }: AttachmentSectionProps): JSX.Element {
  const taskId = task.id;
  const { data: files, isLoading } = useTaskFiles(taskId);
  const uploadFile = useUploadTaskFile(taskId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  // The preview lightbox is shared across rows; `previewFile` is the open file.
  const [previewFile, setPreviewFile] = useState<TaskFile | null>(null);

  const manager = isManager(permCtx, task);
  const myId = permCtx.user?.id;

  function handlePick(e: React.ChangeEvent<HTMLInputElement>): void {
    setError(null);
    const file = e.target.files?.[0];
    // Allow re-selecting the same file later by clearing the input value.
    e.target.value = '';
    if (!file) return;

    if (file.size > MAX_TASK_FILE_BYTES) {
      setError('文件过大，单个文件不能超过 5MB');
      return;
    }
    if (file.size === 0) {
      setError('文件为空');
      return;
    }

    uploadFile.mutate(file, {
      onError: (err) =>
        setError(isApiClientError(err) ? err.message : '上传失败，请稍后重试'),
    });
  }

  return (
    <div className="grid min-w-0 gap-2 rounded-lg border border-border bg-secondary/30 p-3">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Paperclip className="h-3.5 w-3.5" aria-hidden />
          附件（用于交付文件内容，单个 ≤ 5MB）
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={uploadFile.isPending}
          onClick={() => inputRef.current?.click()}
        >
          {!uploadFile.isPending && <Upload className="h-3.5 w-3.5" aria-hidden />}
          上传文件
        </Button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          aria-hidden
          onChange={handlePick}
        />
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {isLoading ? (
        <div className="py-2 text-center">
          <Spinner label="加载附件" />
        </div>
      ) : !files || files.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">暂无附件</p>
      ) : (
        <ul className="flex min-w-0 flex-col divide-y divide-border/60">
          {files.map((file) => (
            <FileRow
              key={file.id}
              taskId={taskId}
              file={file}
              canDelete={manager || file.uploaderId === myId}
              onPreview={() => setPreviewFile(file)}
            />
          ))}
        </ul>
      )}

      <FilePreviewDialog
        taskId={taskId}
        file={previewFile}
        open={previewFile !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewFile(null);
        }}
      />
    </div>
  );
}

/**
 * Render a filename so it truncates without ever hiding the extension: the base
 * name ellipsizes while the extension (".pdf", ".xlsx", …) stays pinned at the end.
 */
function FileName({ name }: { name: string }): JSX.Element {
  const dot = name.lastIndexOf('.');
  const hasExt = dot > 0 && dot < name.length - 1 && name.length - dot <= 8;
  const base = hasExt ? name.slice(0, dot) : name;
  const ext = hasExt ? name.slice(dot) : '';
  return (
    <span className="flex min-w-0 max-w-full items-baseline text-sm text-foreground" title={name}>
      <span className="truncate">{base}</span>
      {ext && <span className="shrink-0">{ext}</span>}
    </span>
  );
}

function FileRow({
  taskId,
  file,
  canDelete,
  onPreview,
}: {
  taskId: string;
  file: TaskFile;
  canDelete: boolean;
  onPreview: () => void;
}): JSX.Element {
  const deleteFile = useDeleteTaskFile(taskId);
  const previewable = isInlinePreviewable(file.mime);
  const isImage = isImageMime(file.mime);

  return (
    <li className="flex min-w-0 items-center gap-2 py-2">
      {/* Leading: image thumbnail (click to preview) or a generic paperclip. */}
      {isImage ? (
        <button
          type="button"
          onClick={onPreview}
          className="shrink-0 overflow-hidden rounded border border-border bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`预览 ${file.filename}`}
        >
          <img
            src={taskFilePreviewUrl(taskId, file.id)}
            alt=""
            loading="lazy"
            className="h-9 w-9 object-cover"
          />
        </button>
      ) : (
        <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      )}

      {/* Name + size: the only flexible cell, so the actions never get pushed off. */}
      <button
        type="button"
        onClick={previewable ? onPreview : undefined}
        className={`min-w-0 flex-1 text-left ${previewable ? 'cursor-pointer' : 'cursor-default'}`}
        aria-label={previewable ? `预览 ${file.filename}` : file.filename}
        disabled={!previewable}
      >
        <FileName name={file.filename} />
        <span className="block truncate text-xs text-muted-foreground">
          {formatFileSize(file.sizeBytes)} · 由 {file.uploader.displayName} 上传
        </span>
      </button>

      {/* Actions — icon-only so a long filename can never crowd them out. */}
      {previewable && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={`预览 ${file.filename}`}
          title="预览"
          onClick={onPreview}
        >
          <Eye className="h-3.5 w-3.5" aria-hidden />
        </Button>
      )}
      <a
        href={taskFileUrl(taskId, file.id)}
        download={file.filename}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        aria-label={`下载 ${file.filename}`}
        title="下载"
      >
        <Download className="h-3.5 w-3.5" aria-hidden />
      </a>
      {canDelete && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
          aria-label={`删除 ${file.filename}`}
          title="删除"
          loading={deleteFile.isPending}
          onClick={() => {
            if (window.confirm(`确定删除附件「${file.filename}」？`)) {
              deleteFile.mutate(file.id);
            }
          }}
        >
          {!deleteFile.isPending && <Trash2 className="h-3.5 w-3.5" aria-hidden />}
        </Button>
      )}
    </li>
  );
}
