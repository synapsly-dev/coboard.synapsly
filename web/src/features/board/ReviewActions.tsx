import { useState } from 'react';
import { Check, X } from 'lucide-react';
import {
  isAdminRole,
  QUALITY_COEFFICIENTS,
  qualityGrades,
  type QualityGrade,
  type Task,
} from 'shared';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Textarea,
} from '../../components/ui';
import { isApiClientError } from '../../api/client';
import { useReviewTask } from '../../api/tasks';
import { useAuth } from '../../lib/auth-context';
import { cn } from '../../lib/utils';
import { FINAL_REVIEW_CHIP_CLASS, QUALITY_GRADE_META } from './labels';
import { pendingReviewStage } from 'shared';

/**
 * Review controls for a `pending_review` task (lifecycle v2 §5; P2 §2/§3). The
 * label follows the stage: 审阅 (single-stage), 初审 (first of two), 复核 (final
 * admin stage). 通过 opens a small dialog carrying the structured verdict — an
 * optional 交付质量 A/B/C/D grade (with a suggested-points hint, display only) and
 * an optional comment; 驳回 keeps its reason dialog. Used both on the board card
 * and in the detail drawer. Visibility is the caller's job (canReview).
 */
export interface ReviewActionsProps {
  task: Task;
  projectId: string;
  /** Compact buttons on cards, default in the drawer. */
  size?: 'sm' | 'md';
  className?: string;
  /** Fired after a successful approve/reject. */
  onReviewed?: () => void;
}

export function ReviewActions({
  task,
  projectId,
  size = 'sm',
  className,
  onReviewed,
}: ReviewActionsProps): JSX.Element {
  const { user } = useAuth();
  const review = useReviewTask(projectId);
  const [approveOpen, setApproveOpen] = useState(false);
  const [grade, setGrade] = useState<QualityGrade | null>(null);
  const [comment, setComment] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');

  const stage = pendingReviewStage(task);
  const stageLabel = stage === 'first' ? '初审' : stage === 'final' ? '复核' : '审阅';
  const isAdmin = isAdminRole(user?.role);

  // What approving does next, per the two-stage chain (P2 §3). An admin's approve
  // at 初审 completes the whole chain in one go (初审+复核 both recorded).
  const approveHint =
    stage === 'first'
      ? isAdmin
        ? '管理员通过将直接完成任务（初审与复核一并生效）。'
        : '初审通过后任务进入「待复核」，由总运营复核后完成。'
      : stage === 'final'
        ? '复核通过后任务将标记为「已完成」。'
        : '通过后任务将标记为「已完成」。';

  // Suggested final points = base × quality coefficient — DISPLAY ONLY, points
  // remain manually confirmed (docx §13.5; allocations locked at deliver).
  const coeff = grade ? QUALITY_COEFFICIENTS[grade] : null;
  const suggested =
    grade && coeff != null && task.points != null ? Math.round(task.points * coeff) : null;

  function resetApprove(): void {
    setGrade(null);
    setComment('');
  }

  function approve(): void {
    review.mutate(
      {
        taskId: task.id,
        input: {
          decision: 'approve',
          ...(grade ? { qualityGrade: grade } : {}),
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        },
      },
      {
        onSuccess: () => {
          setApproveOpen(false);
          resetApprove();
          onReviewed?.();
        },
      },
    );
  }

  function reject(): void {
    review.mutate(
      {
        taskId: task.id,
        input: { decision: 'reject', ...(reason.trim() ? { comment: reason.trim() } : {}) },
      },
      {
        onSuccess: () => {
          setRejectOpen(false);
          setReason('');
          onReviewed?.();
        },
      },
    );
  }

  return (
    <div className={className} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2">
        {/* Stage context — only surfaced for the two-stage chain (初审/复核);
            single-stage 审阅 stays as today, chip-free. */}
        {stage !== 'single' && (
          <Badge variant={stage === 'final' ? 'primary' : 'outline'} className="shrink-0">
            {stageLabel}
          </Badge>
        )}
        <Button
          type="button"
          variant="primary"
          size={size}
          className="flex-1 sm:flex-none"
          onClick={() => setApproveOpen(true)}
          aria-label={`通过${stageLabel}`}
        >
          <Check className="h-3.5 w-3.5" aria-hidden />
          通过
        </Button>
        <Button
          type="button"
          variant="outline"
          size={size}
          className="flex-1 sm:flex-none"
          onClick={() => setRejectOpen(true)}
          aria-label="驳回交付"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          驳回
        </Button>
      </div>

      <Dialog
        open={approveOpen}
        onOpenChange={(next) => {
          setApproveOpen(next);
          if (!next) resetApprove();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>通过{stageLabel}</DialogTitle>
            <DialogDescription>{approveHint}</DialogDescription>
          </DialogHeader>

          {/* 交付质量 selector (P2 §2) — optional, tap again to clear. */}
          <div className="grid gap-1.5">
            <Label>交付质量（选填）</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {qualityGrades.map((g) => {
                const meta = QUALITY_GRADE_META[g];
                const active = grade === g;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGrade(active ? null : g)}
                    aria-pressed={active}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium leading-none transition-colors',
                      meta.className,
                      active ? 'ring-2 ring-current' : 'opacity-70 hover:opacity-100',
                    )}
                  >
                    <span className="font-bold">{meta.letter}</span>
                    <span>{meta.name}</span>
                    <span className="tabular-nums opacity-80">{QUALITY_COEFFICIENTS[g]}</span>
                  </button>
                );
              })}
            </div>
            {suggested != null && coeff != null && (
              <p className="text-xs text-muted-foreground">
                建议最终点数 ≈ {suggested}（基础{task.points}×{coeff}）
              </p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="approve-comment">审核意见（选填）</Label>
            <Textarea
              id="approve-comment"
              rows={3}
              placeholder="对本次交付的评价…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>

          {review.isError && (
            <p className="text-xs text-destructive">
              {isApiClientError(review.error) ? review.error.message : '操作失败，请重试'}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setApproveOpen(false);
                resetApprove();
              }}
            >
              取消
            </Button>
            <Button type="button" loading={review.isPending} onClick={approve}>
              <Check className="h-3.5 w-3.5" aria-hidden />
              确认通过
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>驳回交付</DialogTitle>
            <DialogDescription>
              任务将退回「进行中」，已分配的点数会被清空。可填写驳回理由。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="reject-reason">驳回理由（选填）</Label>
            <Textarea
              id="reject-reason"
              rows={3}
              placeholder="说明需要修改的地方…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {review.isError && (
            <p className="text-xs text-destructive">
              {isApiClientError(review.error) ? review.error.message : '操作失败，请重试'}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRejectOpen(false)}>
              取消
            </Button>
            <Button type="button" variant="destructive" loading={review.isPending} onClick={reject}>
              确认驳回
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Read-only 「已初审 · 待复核」 chip (P2 §3) for viewers who cannot act on the
 * final stage — shows the 初审人 as a tooltip/title. Rendered wherever the old
 * 待审阅 badge would sit for a non-reviewer.
 */
export function FirstApprovedChip({
  task,
  className,
}: {
  task: Task;
  className?: string;
}): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium leading-none',
        FINAL_REVIEW_CHIP_CLASS,
        className,
      )}
      title={task.firstApprover ? `初审人：${task.firstApprover.displayName}` : undefined}
      aria-label="已初审，待复核"
    >
      已初审 · 待复核
    </span>
  );
}
