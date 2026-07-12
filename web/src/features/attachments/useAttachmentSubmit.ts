import { useRef, useState } from 'react';
import { isApiClientError } from '../../api/client';
import { uploadAttachments, type AttachmentOwner } from '../../api/attachments';

/**
 * Shared create-then-upload submit flow for the idea/comment composers. Owns the
 * upload-after-create sequence (§ attachments: nothing is sent until the owning
 * entity exists, so a cancelled draft can't orphan files) and the double-submit
 * guard — the whole flow can take seconds with several 5MB files in flight, and
 * Cmd/Ctrl+Enter must not create a second entity meanwhile.
 */

export interface AttachmentSubmitParams {
  /** Create the owning entity (usually a mutateAsync closure); returns its id. */
  create: () => Promise<{ id: string }>;
  /** The composer's staged files; uploaded to the new entity one by one. */
  files: readonly File[];
  /** Refetch the owning list so the embedded `files` show up. */
  invalidate: () => void;
  /** Success clause for the partial-failure warning, e.g. "评论已发送". */
  createdLabel: string;
}

export type AttachmentSubmitResult =
  /** Everything landed. */
  | { status: 'done' }
  /** Entity created but some uploads failed — warn; files are re-addable via 添加附件. */
  | { status: 'partial'; message: string }
  /** The create itself failed — nothing happened. */
  | { status: 'error'; message: string }
  /** A submit is already in flight (e.g. repeated Cmd/Ctrl+Enter) — ignore. */
  | { status: 'busy' };

export function useAttachmentSubmit(owner: AttachmentOwner): {
  submitting: boolean;
  submit: (params: AttachmentSubmitParams) => Promise<AttachmentSubmitResult>;
} {
  const [submitting, setSubmitting] = useState(false);
  // Ref, not state: a repeat Cmd/Ctrl+Enter can fire before React re-renders
  // with `submitting === true`, so the guard must not depend on render timing.
  const inFlight = useRef(false);

  async function submit(params: AttachmentSubmitParams): Promise<AttachmentSubmitResult> {
    if (inFlight.current) return { status: 'busy' };
    inFlight.current = true;
    setSubmitting(true);
    try {
      const created = await params.create();
      if (params.files.length > 0) {
        const result = await uploadAttachments(owner, created.id, params.files);
        // The entity exists either way; refetch so its `files` embed shows up.
        params.invalidate();
        if (result.failed > 0) {
          return {
            status: 'partial',
            message:
              `${params.createdLabel}，但 ${result.failed} 个附件上传失败` +
              `（${result.firstError ?? '请稍后重试'}）。可通过附件区的「添加附件」补传。`,
          };
        }
      }
      return { status: 'done' };
    } catch (err) {
      return {
        status: 'error',
        message: isApiClientError(err) ? err.message : '提交失败，请稍后重试',
      };
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return { submitting, submit };
}
