import { useState } from 'react';
import { Lightbulb, Paperclip, Plus, Send, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { IdeaStatus, IdeaWithContext } from 'shared';
import { createStandaloneIdeaInputSchema, ideaStatuses } from 'shared';
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Textarea,
} from '../components/ui';
import { avatarUrl } from '../lib/utils';
import { useAllIdeas, useCreateStandaloneIdea, useDeleteIdea } from '../api/ideas';
import { useAuth } from '../lib/auth-context';
import { relativeTime } from '../features/board/format';
import { AttachmentPicker } from '../features/attachments/AttachmentPicker';
import { useAttachmentSubmit } from '../features/attachments/useAttachmentSubmit';
import { confirmDeleteIdea } from '../features/ideas/delete';
import { IdeaAttachments } from '../features/ideas/IdeaAttachments';
import { IdeaDetailDialog, IdeaReviewActions } from '../features/ideas/IdeaDetailDialog';
import { IDEA_STATUS_LABELS, IDEA_STATUS_VARIANT } from '../features/ideas/labels';
import { TaskDetailDrawer } from '../features/task/TaskDetailDrawer';

/**
 * 灵感区 (§7.1) — a board of every idea the current user can see (admins: all). Two
 * kinds of cards:
 * - TASK ideas: show their owning project + task title; clicking opens the task
 *   detail drawer on the 想法 tab (current behavior).
 * - STANDALONE ideas (no task/project, posted here via 「发布灵感」): show a
 *   「独立想法」 badge, are non-clickable, and a global admin can adopt/reject them
 *   inline (since there is no task drawer to host the action).
 *
 * A status filter narrows the list; adopted ideas credit reward points to the author.
 */

/** Sentinel for "all statuses" in the filter select (Radix needs a non-empty value). */
const ALL_STATUSES = 'all';

export default function IdeasPage(): JSX.Element {
  const { user, isAdmin } = useAuth();
  const [status, setStatus] = useState<IdeaStatus | typeof ALL_STATUSES>(ALL_STATUSES);
  // Clicking a TASK idea opens its task detail drawer in-place (no navigation away).
  const [selected, setSelected] = useState<{ taskId: string; projectId: string } | null>(null);
  // Snapshot of the idea being read (想法详情). Rendering prefers the LIVE list
  // row (refetched changes show up immediately), but falls back to the snapshot
  // when a status filter / SSE refetch drops the idea from the filtered list —
  // the dialog must neither vanish mid-action nor spontaneously reopen later.
  // For that filtered case, onReviewed merges the mutation result back in.
  const [detail, setDetail] = useState<IdeaWithContext | null>(null);
  const { data: ideas, isLoading, isError, refetch } = useAllIdeas({
    status: status === ALL_STATUSES ? undefined : status,
  });

  const list = ideas ?? [];
  const detailIdea = detail ? (list.find((i) => i.id === detail.id) ?? detail) : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-base font-semibold">
              <Lightbulb className="h-4 w-4 text-warning-foreground" aria-hidden />
              灵感区
            </h1>
            <p className="text-sm text-muted-foreground">
              汇集你可见项目下的想法，以及面向所有人的独立灵感。被采纳的想法会为作者计入奖励点数。
            </p>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Select value={status} onValueChange={(v) => setStatus(v as IdeaStatus | typeof ALL_STATUSES)}>
              <SelectTrigger className="min-w-0 flex-1 sm:w-36 sm:flex-none">
                <SelectValue placeholder="全部状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_STATUSES}>全部状态</SelectItem>
                {ideaStatuses.map((s) => (
                  <SelectItem key={s} value={s}>
                    {IDEA_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <PublishIdeaDialog />
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner label="加载想法" />
          </div>
        ) : isError ? (
          <EmptyState
            icon={Lightbulb}
            title="加载想法失败"
            description="请检查网络后重试。"
            action={
              <Button variant="outline" onClick={() => void refetch()}>
                重新加载
              </Button>
            }
          />
        ) : list.length === 0 ? (
          <EmptyState
            icon={Lightbulb}
            title="还没有想法"
            description="点击「发布灵感」分享一个独立想法，或在任务详情页的「想法 / 灵感」区分享灵感。"
          />
        ) : (
          <div className="grid gap-3 motion-safe:animate-fade-in sm:grid-cols-2">
            {list.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                canManage={isAdmin}
                canDelete={isAdmin || idea.author.id === user?.id}
                onOpen={
                  idea.taskId != null && idea.projectId != null
                    ? () => setSelected({ taskId: idea.taskId!, projectId: idea.projectId! })
                    : undefined
                }
                onOpenDetail={() => setDetail(idea)}
              />
            ))}
          </div>
        )}
      </div>
      <TaskDetailDrawer
        taskId={selected?.taskId ?? null}
        projectId={selected?.projectId ?? ''}
        open={selected !== null}
        initialTab="ideas"
        onOpenChange={(o) => {
          if (!o) setSelected(null);
        }}
      />
      <IdeaDetailDialog
        idea={detailIdea}
        canManage={isAdmin}
        onOpenChange={(o) => {
          if (!o) setDetail(null);
        }}
        onReviewed={(updated) => setDetail((prev) => (prev ? { ...prev, ...updated } : prev))}
        onFilesChanged={(update) =>
          setDetail((prev) => (prev ? { ...prev, files: update(prev.files) } : prev))
        }
      />
    </div>
  );
}

/** 「发布灵感」 — a small dialog with a body textarea posting a STANDALONE idea. */
function PublishIdeaDialog(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const createIdea = useCreateStandaloneIdea();
  const queryClient = useQueryClient();
  // Shared create→upload flow with the double-submit guard (see useAttachmentSubmit).
  const { submitting, submit } = useAttachmentSubmit('ideas');

  function reset(): void {
    setBody('');
    setPendingFiles([]);
    setError(null);
  }

  async function send(): Promise<void> {
    setError(null);
    const parsed = createStandaloneIdeaInputSchema.safeParse({ body: body.trim() });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '想法不能为空');
      return;
    }

    const result = await submit({
      create: () => createIdea.mutateAsync(parsed.data),
      files: pendingFiles,
      invalidate: () => void queryClient.invalidateQueries({ queryKey: ['ideas'] }),
      createdLabel: '灵感已发布',
    });
    if (result.status === 'busy') return;
    if (result.status === 'error') {
      setError(result.message);
      return;
    }
    if (result.status === 'partial') {
      // Leave the dialog open so the warning is seen; the idea itself is out.
      setError(result.message);
      setBody('');
      setPendingFiles([]);
      return;
    }
    reset();
    setOpen(false);
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    void send();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="md">
          <Plus className="h-4 w-4" aria-hidden />
          发布灵感
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>发布灵感</DialogTitle>
          <DialogDescription>
            分享一个不依附于任何任务的独立想法，对所有成员可见。被管理员采纳后将为你计入奖励点数。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-3">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            autoFocus
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

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset();
                setOpen(false);
              }}
            >
              取消
            </Button>
            <Button type="submit" loading={submitting} disabled={!body.trim()}>
              {!submitting && <Send className="h-3.5 w-3.5" aria-hidden />}
              发布
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function IdeaCard({
  idea,
  canManage,
  canDelete,
  onOpen,
  onOpenDetail,
}: {
  idea: IdeaWithContext;
  /** Whether the current user (global admin) may adopt/reject a standalone idea. */
  canManage: boolean;
  /** Whether the current user (global admin / author) may delete this idea. */
  canDelete: boolean;
  /** Opens the owning task drawer; undefined for a STANDALONE / pool-task idea. */
  onOpen?: () => void;
  /** Opens the idea read dialog (想法详情) — used when there is no task drawer. */
  onOpenDetail: () => void;
}): JSX.Element {
  const isStandalone = idea.taskId == null;
  const deleteIdea = useDeleteIdea();

  /** Overlaid 删除 button (top-right); kept out of the clickable task-card button. */
  const deleteButton = canDelete ? (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="absolute right-2 top-2 z-10 h-9 w-9 bg-card/80 text-muted-foreground hover:text-destructive sm:h-7 sm:w-7"
      aria-label="删除想法"
      loading={deleteIdea.isPending}
      onClick={(e) => {
        e.stopPropagation();
        confirmDeleteIdea(deleteIdea, idea);
      }}
    >
      {!deleteIdea.isPending && <Trash2 className="h-3.5 w-3.5" aria-hidden />}
    </Button>
  ) : null;

  const head = (
    <>
      <div className="flex flex-wrap items-center gap-2 pr-9 sm:pr-0">
        {isStandalone ? (
          <Badge variant="primary">独立想法</Badge>
        ) : (
          <Badge variant="outline" className="font-mono">
            {/* Pool-task ideas (§8) have no owning project. */}
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

      {!isStandalone && (
        <p className="truncate text-sm font-medium text-foreground">{idea.taskTitle}</p>
      )}

      <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
        {idea.body}
      </p>

      {/* CLICKABLE task-idea cards keep a passive 📎 count (the whole card is one
          <button>, so interactive chips can't nest); the drawer's 想法 tab has the
          full chips. Non-clickable cards (standalone / pool-task ideas) render the
          interactive chips below instead. */}
      {onOpen && idea.files.length > 0 && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Paperclip className="h-3 w-3" aria-hidden />
          {idea.files.length} 个附件
        </span>
      )}

      <div className="mt-auto flex items-center gap-2 pt-1">
        <Avatar
          name={idea.author.displayName}
          color={idea.author.avatarColor}
          imageUrl={idea.author.hasAvatar ? avatarUrl(idea.author.id) : undefined}
          size="xs"
        />
        <span className="text-xs text-foreground">{idea.author.displayName}</span>
        <span className="text-xs text-muted-foreground">{relativeTime(idea.createdAt)}</span>
      </div>
    </>
  );

  // TASK idea: the whole card is a button that opens the task drawer (current
  // behavior). The 删除 control is overlaid OUTSIDE the button (no nested buttons).
  if (!isStandalone && onOpen) {
    return (
      <div className="relative">
        {deleteButton}
        <button
          type="button"
          onClick={onOpen}
          className="flex w-full flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {head}
        </button>
      </div>
    );
  }

  // STANDALONE / pool-task idea (no task drawer): the whole card opens the read
  // dialog (想法详情). It hosts interactive children (chips, admin actions), so it
  // is a role="button" div rather than a real <button> — the children stop
  // propagation, mirroring the board TaskCard pattern.
  return (
    <div
      // No aria-label: the accessible name must come from the card's content
      // (preview, status, author) so screen readers can tell the cards apart.
      className="relative flex cursor-pointer flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      role="button"
      tabIndex={0}
      onClick={onOpenDetail}
      onKeyDown={(e) => {
        // Only the card itself — Enter/Space inside child controls must not open.
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpenDetail();
        }
      }}
    >
      {deleteButton}
      {head}
      <IdeaAttachments idea={idea} canManage={canManage} />
      {isStandalone && canManage && idea.status === 'pending' && (
        <div onClick={(e) => e.stopPropagation()}>
          <IdeaReviewActions idea={idea} />
        </div>
      )}
    </div>
  );
}

// 采纳/驳回 actions moved to features/ideas/IdeaDetailDialog (IdeaReviewActions) —
// shared between the 灵感区 cards and the read dialog.
