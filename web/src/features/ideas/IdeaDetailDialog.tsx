import { useState } from 'react';
import { Check, Trash2, X } from 'lucide-react';
import type { Idea, IdeaWithContext } from 'shared';
import { adoptIdeaInputSchema } from 'shared';
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
  useConfirm,
} from '../../components/ui';
import { isApiClientError } from '../../api/client';
import { useAdoptIdea, useDeleteIdea, useRejectIdea } from '../../api/ideas';
import { useAuth } from '../../lib/auth-context';
import { avatarUrl } from '../../lib/utils';
import { relativeTime } from '../board/format';
import { renderMarkdown } from '../task/markdown';
import { confirmDeleteIdea } from './delete';
import { IdeaAttachments } from './IdeaAttachments';
import { IDEA_STATUS_LABELS, IDEA_STATUS_VARIANT } from './labels';

/**
 * Read view for one 灵感区 idea (想法详情). Card previews are clamped to three
 * lines of plain text, so this dialog carries the FULL body through the same
 * safe Markdown pipeline as task ideas/comments (no raw HTML, XSS-inert),
 * plus the interactive attachment chips and the lifecycle actions:
 * - 采纳/驳回 for a pending idea (global admin — the `onReviewed` callback lets
 *   the opener refresh its snapshot even when a status filter drops the idea
 *   from the live list);
 * - 删除 for the author / an admin — closes the dialog on success, and reports
 *   failures inline (never silently).
 *
 * Opened for STANDALONE and no-project POOL-task ideas — project-task ideas
 * open their task drawer instead (richer context).
 */
export function IdeaDetailDialog({
  idea,
  canManage,
  onOpenChange,
  onReviewed,
  onFilesChanged,
}: {
  /** The idea to show; null renders a closed dialog. */
  idea: IdeaWithContext | null;
  /** Whether the viewer may adopt/reject (global admin). */
  canManage: boolean;
  onOpenChange: (open: boolean) => void;
  /** Adopt/reject landed — lets the opener merge the fresh status into its state. */
  onReviewed?: (updated: Idea) => void;
  /** Attachment add/remove landed — same snapshot-merge purpose as onReviewed. */
  onFilesChanged?: (update: (files: Idea['files']) => Idea['files']) => void;
}): JSX.Element {
  const { user } = useAuth();
  const deleteIdea = useDeleteIdea();
  const confirm = useConfirm();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isAuthor = idea != null && idea.author.id === user?.id;
  const canDelete = idea != null && (canManage || isAuthor);
  const isStandalone = idea?.taskId == null;

  return (
    <Dialog
      open={idea !== null}
      onOpenChange={(open) => {
        if (!open) setDeleteError(null);
        onOpenChange(open);
      }}
    >
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-2xl">
        {idea && (
          <>
            <DialogHeader className="shrink-0 space-y-2 border-b border-border px-6 pb-4 pt-6">
              <DialogDescription className="sr-only">
                想法的完整内容、附件与处理操作
              </DialogDescription>
              <div className="flex flex-wrap items-center gap-2 pr-8">
                {isStandalone ? (
                  <Badge variant="primary">独立想法</Badge>
                ) : (
                  <Badge variant="outline" className="font-mono">
                    {idea.projectName ?? '无项目'}
                  </Badge>
                )}
                <Badge variant={IDEA_STATUS_VARIANT[idea.status]}>
                  {IDEA_STATUS_LABELS[idea.status]}
                </Badge>
                {idea.status === 'adopted' && idea.rewardPoints != null && (
                  <Badge variant="primary">奖励 {idea.rewardPoints} 点</Badge>
                )}
              </div>

              <div className="flex items-start justify-between gap-3 pr-8">
                <DialogTitle className="break-words text-lg leading-snug">
                  {isStandalone ? '灵感详情' : `想法 · ${idea.taskTitle ?? ''}`}
                </DialogTitle>
                {canDelete && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    loading={deleteIdea.isPending}
                    onClick={() => {
                      setDeleteError(null);
                      void confirmDeleteIdea(confirm, deleteIdea, idea, {
                        // The list refetch also drops the idea; closing here gives
                        // immediate feedback instead of relying on the lookup.
                        onSuccess: () => onOpenChange(false),
                        onError: (err) =>
                          setDeleteError(
                            isApiClientError(err) ? err.message : '删除失败，请稍后重试',
                          ),
                      });
                    }}
                  >
                    {!deleteIdea.isPending && <Trash2 className="h-3.5 w-3.5" aria-hidden />}
                    删除
                  </Button>
                )}
              </div>
              {deleteError && <p className="text-xs text-destructive">{deleteError}</p>}

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Avatar
                  name={idea.author.displayName}
                  color={idea.author.avatarColor}
                  imageUrl={idea.author.hasAvatar ? avatarUrl(idea.author.id) : undefined}
                  size="xs"
                />
                <span className="truncate">{idea.author.displayName}</span>
                <span aria-hidden>·</span>
                <span className="shrink-0">{relativeTime(idea.createdAt)}</span>
              </div>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 scrollbar-thin">
              <div className="break-words text-sm">{renderMarkdown(idea.body)}</div>
              <IdeaAttachments idea={idea} canManage={canManage} onFilesChanged={onFilesChanged} />
              {idea.status === 'rejected' && idea.rejectReason && (
                <div className="mt-4 rounded-md border border-border bg-secondary/30 p-3">
                  <p className="text-xs font-medium text-muted-foreground">驳回理由</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
                    {idea.rejectReason}
                  </p>
                </div>
              )}
            </div>

            {canManage && idea.status === 'pending' && (
              <div className="shrink-0 border-t border-border px-6 py-4">
                <IdeaReviewActions idea={idea} onReviewed={onReviewed} />
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Inline 采纳（填奖励点数）/ 驳回 for a pending idea — shared by the task
 * drawer's 想法 section, the 灵感区 cards, and the detail dialog. Passes the
 * owning taskId (when any) so the task's idea list refetches; `onReviewed`
 * hands the updated idea back for callers whose local state may outlive the
 * filtered list (the detail dialog).
 */
export function IdeaReviewActions({
  idea,
  onReviewed,
}: {
  idea: Pick<Idea, 'id' | 'taskId'>;
  onReviewed?: (updated: Idea) => void;
}): JSX.Element {
  // Exactly one inline panel is open at a time: 采纳 (reward) or 驳回 (reason).
  const [mode, setMode] = useState<'idle' | 'adopting' | 'rejecting'>('idle');
  const [reward, setReward] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const adoptIdea = useAdoptIdea();
  const rejectIdea = useRejectIdea();
  const taskId = idea.taskId ?? undefined;

  function reset(): void {
    setMode('idle');
    setError(null);
  }

  function submitAdopt(): void {
    setError(null);
    // Pre-validate for a Chinese message — zod's defaults are English and the
    // schema has no custom copy, so its issues must never reach the UI.
    const value = reward.trim() === '' ? NaN : Number(reward);
    const parsed = adoptIdeaInputSchema.safeParse({ rewardPoints: value });
    if (!Number.isInteger(value) || !parsed.success) {
      setError('请输入有效的奖励点数（0 – 100000 的整数）');
      return;
    }
    adoptIdea.mutate(
      { ideaId: idea.id, input: parsed.data, taskId },
      {
        onSuccess: (updated) => {
          setReward('');
          reset();
          onReviewed?.(updated);
        },
        onError: (err) =>
          setError(isApiClientError(err) ? err.message : '采纳失败，请稍后重试'),
      },
    );
  }

  function submitReject(): void {
    setError(null);
    // 驳回理由 is optional — an empty textarea rejects without one.
    rejectIdea.mutate(
      { ideaId: idea.id, reason: reason.trim() || undefined, taskId },
      {
        onSuccess: (updated) => {
          setReason('');
          reset();
          onReviewed?.(updated);
        },
        onError: (err) =>
          setError(isApiClientError(err) ? err.message : '驳回失败，请稍后重试'),
      },
    );
  }

  return (
    <div>
      {mode === 'adopting' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            className="w-full sm:w-28"
            placeholder="奖励点数"
            aria-label="奖励点数"
            value={reward}
            onChange={(e) => setReward(e.target.value)}
          />
          <Button type="button" size="sm" loading={adoptIdea.isPending} onClick={submitAdopt}>
            <Check className="h-3.5 w-3.5" aria-hidden />
            确认采纳
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={reset}>
            取消
          </Button>
        </div>
      ) : mode === 'rejecting' ? (
        <div className="flex flex-col gap-2">
          <Textarea
            rows={2}
            className="w-full"
            placeholder="驳回理由（选填，作者可见）…"
            aria-label="驳回理由"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              loading={rejectIdea.isPending}
              onClick={submitReject}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              确认驳回
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={reset}>
              取消
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setError(null);
              setMode('adopting');
            }}
          >
            <Check className="h-3.5 w-3.5" aria-hidden />
            采纳
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setError(null);
              setMode('rejecting');
            }}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            驳回
          </Button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
