import { useState } from 'react';
import { Lightbulb, Send, Trash2 } from 'lucide-react';
import type { Idea, Task } from 'shared';
import { createIdeaInputSchema } from 'shared';
import { Avatar, Badge, Button, Spinner, Textarea, useConfirm } from '../../components/ui';
import { useQueryClient } from '@tanstack/react-query';
import { avatarUrl } from '../../lib/utils';
import { useCreateIdea, useDeleteIdea, useTaskIdeas } from '../../api/ideas';
import { queryKeys } from '../../lib/query';
import { relativeTime } from '../board/format';
import type { TaskPermissionContext } from '../board/permissions';
import { isManager } from '../board/permissions';
import { AttachmentPicker } from '../attachments/AttachmentPicker';
import { useAttachmentSubmit } from '../attachments/useAttachmentSubmit';
import { confirmDeleteIdea } from '../ideas/delete';
import { IdeaAttachments } from '../ideas/IdeaAttachments';
import { IdeaReviewActions } from '../ideas/IdeaDetailDialog';
import { IDEA_STATUS_LABELS, IDEA_STATUS_VARIANT } from '../ideas/labels';
import { renderMarkdown } from './markdown';

/**
 * Idea / inspiration section (§7.1) inside the task detail drawer. A composer to
 * post an idea on the task plus the list of ideas (newest first). Each idea shows
 * its author, safely-rendered markdown body, and a status badge; leads/admins see
 * 采纳（输入奖励点数）/ 驳回 actions (the shared IdeaReviewActions), and adopted
 * ideas show their reward points. Idea-domain labels/attachments/delete flow live
 * in features/ideas and are shared with the 灵感区.
 */

export interface IdeaSectionProps {
  task: Task;
  permCtx: TaskPermissionContext;
}

export function IdeaSection({ task, permCtx }: IdeaSectionProps): JSX.Element {
  const taskId = task.id;
  const { data: ideas, isLoading } = useTaskIdeas(taskId);
  // Manager (admin / project lead, or pool-task creator) may adopt/reject + delete
  // any idea on this task; the author may delete their own (matches the server rule).
  const manager = isManager(permCtx, task);
  const myId = permCtx.user?.id;

  return (
    <div className="flex flex-col gap-4">
      {isLoading ? (
        <div className="py-4 text-center">
          <Spinner label="加载想法" />
        </div>
      ) : !ideas || ideas.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          还没有想法，欢迎分享你的灵感。
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {ideas.map((idea) => (
            <IdeaItem
              key={idea.id}
              idea={idea}
              canManage={manager}
              canDelete={manager || idea.author.id === myId}
            />
          ))}
        </ul>
      )}
      <IdeaComposer taskId={taskId} />
    </div>
  );
}

function IdeaItem({
  idea,
  canManage,
  canDelete,
}: {
  idea: Idea;
  canManage: boolean;
  canDelete: boolean;
}): JSX.Element {
  const deleteIdea = useDeleteIdea();
  const confirm = useConfirm();

  return (
    <li className="flex gap-3">
      <Avatar
        name={idea.author.displayName}
        color={idea.author.avatarColor}
        imageUrl={idea.author.hasAvatar ? avatarUrl(idea.author.id) : undefined}
        size="sm"
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {idea.author.displayName}
          </span>
          <span className="text-xs text-muted-foreground">{relativeTime(idea.createdAt)}</span>
          <Badge variant={IDEA_STATUS_VARIANT[idea.status]}>
            {IDEA_STATUS_LABELS[idea.status]}
          </Badge>
          {idea.status === 'adopted' && idea.rewardPoints != null && (
            <Badge variant="primary">奖励 {idea.rewardPoints} 点</Badge>
          )}
          {canDelete && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="ml-auto h-9 w-9 text-muted-foreground hover:text-destructive sm:h-7 sm:w-7"
              aria-label="删除想法"
              loading={deleteIdea.isPending}
              onClick={() => void confirmDeleteIdea(confirm, deleteIdea, idea)}
            >
              {!deleteIdea.isPending && <Trash2 className="h-3.5 w-3.5" aria-hidden />}
            </Button>
          )}
        </div>

        <div className="mt-1 break-words">{renderMarkdown(idea.body)}</div>
        <IdeaAttachments idea={idea} canManage={canManage} />

        {idea.status === 'rejected' && idea.rejectReason && (
          <div className="mt-2 rounded-md border border-border bg-secondary/30 p-2.5">
            <p className="text-xs font-medium text-muted-foreground">驳回理由</p>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground">
              {idea.rejectReason}
            </p>
          </div>
        )}

        {canManage && idea.status === 'pending' && (
          <div className="mt-2">
            <IdeaReviewActions idea={idea} />
          </div>
        )}
      </div>
    </li>
  );
}

function IdeaComposer({ taskId }: { taskId: string }): JSX.Element {
  const [body, setBody] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const createIdea = useCreateIdea(taskId);
  const queryClient = useQueryClient();
  // Shared create→upload flow with the double-submit guard (see useAttachmentSubmit).
  const { submitting, submit } = useAttachmentSubmit('ideas');

  async function send(): Promise<void> {
    setError(null);
    const parsed = createIdeaInputSchema.safeParse({ body: body.trim() });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '想法不能为空');
      return;
    }

    const result = await submit({
      create: () => createIdea.mutateAsync(parsed.data),
      files: pendingFiles,
      invalidate: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.taskIdeas(taskId) });
        void queryClient.invalidateQueries({ queryKey: ['ideas'] });
      },
      createdLabel: '想法已发布',
    });
    if (result.status === 'busy') return;
    if (result.status === 'error') {
      setError(result.message);
      return;
    }
    if (result.status === 'partial') setError(result.message);
    setBody('');
    setPendingFiles([]);
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    void send();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="分享一个想法或灵感…"
        aria-label="想法内容"
        invalid={!!error}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            handleSubmit(e);
          }
        }}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <AttachmentPicker files={pendingFiles} onChange={setPendingFiles} disabled={submitting} />
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lightbulb className="h-3.5 w-3.5 shrink-0" aria-hidden />
          想法被采纳后，奖励点数将计入你的贡献
        </span>
        <Button
          type="submit"
          size="sm"
          className="w-full shrink-0 sm:w-auto"
          loading={submitting}
          disabled={!body.trim()}
        >
          {!submitting && <Send className="h-3.5 w-3.5" aria-hidden />}
          发布想法
        </Button>
      </div>
    </form>
  );
}
