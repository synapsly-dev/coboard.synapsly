import { useRef, useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import { Button } from '../../components/ui';
import { MAX_ATTACHMENT_BYTES } from '../../api/attachments';
import { formatFileSize } from '../task/AttachmentSection';

/**
 * Pending-attachment picker for the idea/comment composers. Purely client-side:
 * a 附件 button (hidden multi-file input, each file pre-checked at ≤5MB) plus
 * removable chips of the files staged for upload. The composer owns the `files`
 * state and uploads them right after the idea/comment is created — so nothing is
 * sent (and nothing can be orphaned) until submit.
 */
export interface AttachmentPickerProps {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}

export function AttachmentPicker({ files, onChange, disabled }: AttachmentPickerProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function handlePick(e: React.ChangeEvent<HTMLInputElement>): void {
    setError(null);
    const picked = Array.from(e.target.files ?? []);
    // Allow re-selecting the same file later by clearing the input value.
    e.target.value = '';
    if (picked.length === 0) return;

    const accepted: File[] = [];
    for (const file of picked) {
      if (file.size === 0) {
        setError('文件为空');
        continue;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setError('文件过大，单个文件不能超过 5MB');
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length > 0) {
      onChange([...files, ...accepted]);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip className="h-3.5 w-3.5" aria-hidden />
          附件
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          aria-hidden
          onChange={handlePick}
        />

        {files.map((file, index) => (
          <span
            key={`${file.name}-${index}`}
            className="inline-flex max-w-[14rem] items-center gap-1 rounded-full bg-secondary py-0.5 pl-2.5 pr-1 text-xs text-secondary-foreground"
            title={file.name}
          >
            <span className="truncate">{file.name}</span>
            <span className="shrink-0 text-muted-foreground">{formatFileSize(file.size)}</span>
            <button
              type="button"
              aria-label={`移除 ${file.name}`}
              disabled={disabled}
              onClick={() => onChange(files.filter((_, i) => i !== index))}
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-50"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        ))}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
