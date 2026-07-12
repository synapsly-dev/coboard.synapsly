import { useQueryClient } from '@tanstack/react-query';
import type { Attachment, Idea } from 'shared';
import { useAuth } from '../../lib/auth-context';
import { queryKeys } from '../../lib/query';
import { AttachmentChips } from '../attachments/AttachmentChips';

/**
 * An idea's attachment chips (§7.1) — the ONE place that wires idea attachment
 * permissions and cache invalidation, shared by the task drawer's 想法 section,
 * the 灵感区 cards, and the 想法详情 dialog. Mirrors the server rules: the
 * AUTHOR may add/remove files while the idea is still pending (also the recovery
 * path for a failed composer upload); a manager may delete anytime. Changes
 * invalidate BOTH the owning task's idea list (when any) and the 灵感区 list,
 * so no surface shows stale chips.
 */
export function IdeaAttachments({
  idea,
  canManage,
  onFilesChanged,
}: {
  idea: Idea;
  /** Lead-equivalent over this idea (task manager / global admin). */
  canManage: boolean;
  /**
   * Functional patch for callers holding their own copy of the idea (the 想法
   * 详情 dialog's snapshot fallback) — invalidation alone can't refresh state
   * that a status filter has dropped from the cached list.
   */
  onFilesChanged?: (update: (files: Attachment[]) => Attachment[]) => void;
}): JSX.Element {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return (
    <AttachmentChips
      owner="ideas"
      ownerId={idea.id}
      files={idea.files}
      canUpload={idea.author.id === user?.id && idea.status === 'pending'}
      canDeleteFile={(f) =>
        canManage || (f.uploaderId === user?.id && idea.status === 'pending')
      }
      onFileUploaded={(file) => onFilesChanged?.((files) => [...files, file])}
      onFileDeleted={(fileId) => onFilesChanged?.((files) => files.filter((f) => f.id !== fileId))}
      onChanged={() => {
        if (idea.taskId) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.taskIdeas(idea.taskId) });
        }
        void queryClient.invalidateQueries({ queryKey: ['ideas'] });
      }}
    />
  );
}
