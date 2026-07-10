import { useState } from 'react';
import { CalendarClock, FolderKanban, PackageCheck } from 'lucide-react';
import type { Task } from 'shared';
import { Badge, Button } from '../../components/ui';
import { cn } from '../../lib/utils';
import { ClaimButton } from './ClaimButton';
import { ClaimLimitBadge } from './ClaimLimitBadge';
import { LabelChip } from './LabelChip';
import { ClaimantAvatars } from './ClaimantAvatars';
import { DeliverDialog } from './DeliverDialog';
import { FirstApprovedChip, ReviewActions } from './ReviewActions';
import { RevokeApprovalButton } from './RevokeApprovalButton';
import { dueInfo } from './format';
import { PRIORITY_BADGE, PRIORITY_LABELS, QUALITY_GRADE_META } from './labels';
import { TaskTypeBadge } from './TaskTypeBadge';
import {
  canClaim,
  canDeliver,
  canReview,
  canRevokeApproval,
  type TaskPermissionContext,
} from './permissions';

/**
 * Board task card (lifecycle v2 §5). Presents title, stacked claimant avatars,
 * points badge, priority and due date. State/role-aware actions: 认领 (open/
 * in_progress, when not a claimant), 交付 (in_progress claimant/manager → opens the
 * deliver dialog), 审阅 (pending_review lead/admin → approve/reject) with a 待审阅
 * badge for non-leads.
 */
export interface TaskCardProps {
  task: Task;
  projectId: string;
  /** Current user + project role; drives which actions appear. */
  permCtx?: TaskPermissionContext;
  /**
   * Show the owning-project badge (§8). Only set in the 全部项目 view; uses the
   * task's `projectName`/`projectKey`, or 「无项目」 for a no-project (pool) task.
   */
  showProjectBadge?: boolean;
  /** Open the detail drawer. */
  onOpen?: (taskId: string) => void;
  className?: string;
}

export function TaskCard({
  task,
  projectId,
  permCtx,
  showProjectBadge = false,
  onOpen,
  className,
}: TaskCardProps): JSX.Element {
  const priority = PRIORITY_BADGE[task.priority];
  const due = dueInfo(task.dueDate);
  const [deliverOpen, setDeliverOpen] = useState(false);

  // Keep cards compact: show at most a few label chips, then a "+N" overflow pill.
  const MAX_LABELS = 3;
  const shownLabels = task.labels.slice(0, MAX_LABELS);
  const extraLabels = task.labels.length - shownLabels.length;

  const showClaim = permCtx ? canClaim(permCtx, task) : false;
  const showDeliver = permCtx ? canDeliver(permCtx, task) : false;
  const showReview = permCtx ? canReview(permCtx, task) : false;
  const showRevoke = permCtx ? canRevokeApproval(permCtx, task) : false;
  const pendingReview = task.status === 'pending_review';

  return (
    <article
      className={cn(
        'group flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left shadow-sm',
        // Border + shadow now ease together (was shadow-only, so the border snapped);
        // a 1% press-dip gives touch users whole-card tap feedback. Stable task.id
        // keys mean the mount fade fires only on genuinely new / column-moved cards
        // (claim, create, filter) — a soft settle, not a flash.
        'transition-[box-shadow,border-color,transform] duration-base ease-standard motion-safe:animate-fade-in',
        'hover:border-primary/40 hover:shadow-md active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      role="button"
      tabIndex={0}
      aria-label={`查看任务：${task.title}`}
      onClick={() => onOpen?.(task.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen?.(task.id);
        }
      }}
    >
      {/* Owning-project badge (全部项目 view only, §8). */}
      {showProjectBadge && (
        <Badge
          variant="outline"
          className="self-start gap-1"
          title={task.projectName ?? '无项目（任务池）'}
        >
          <FolderKanban className="h-3 w-3 shrink-0" aria-hidden />
          <span className="max-w-[10rem] truncate">
            {task.projectName ?? '无项目'}
          </span>
        </Badge>
      )}

      {/* Task type (A/B/C/D) + priority + points row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {/* Task-type chip is the marquee signal — render it first (null → nothing). */}
          <TaskTypeBadge taskType={task.taskType} />
          <Badge variant={priority.variant} className="gap-1">
            <span className={cn('h-1.5 w-1.5 rounded-full', priority.dot)} aria-hidden />
            {PRIORITY_LABELS[task.priority]}
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* 交付质量 grade on completed tasks (P2 §2) — a small letter chip. */}
          {task.status === 'done' && task.qualityGrade && (
            <span
              className={cn(
                'inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-bold leading-none',
                QUALITY_GRADE_META[task.qualityGrade].className,
              )}
              title={`交付质量 ${QUALITY_GRADE_META[task.qualityGrade].letter} · ${QUALITY_GRADE_META[task.qualityGrade].name}`}
              aria-label={`交付质量 ${QUALITY_GRADE_META[task.qualityGrade].letter}`}
            >
              {QUALITY_GRADE_META[task.qualityGrade].letter}
            </span>
          )}
          {task.points != null && (
            <Badge variant="primary" aria-label={`${task.points} 点`}>
              {task.points} 点
            </Badge>
          )}
        </div>
      </div>

      {/* Title */}
      <h3 className="line-clamp-3 text-sm font-medium leading-snug text-foreground">
        {task.title}
      </h3>

      {/* Labels (task-labels) — compact, wrap, capped with a +N overflow */}
      {task.labels.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {shownLabels.map((label) => (
            <LabelChip key={label.id} label={label} />
          ))}
          {extraLabels > 0 && (
            <span
              className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium leading-none text-muted-foreground"
              title={task.labels.map((l) => l.name).join('、')}
            >
              +{extraLabels}
            </span>
          )}
        </div>
      )}

      {/* Footer: due date + claim-limit status + claimants */}
      <div className="mt-1 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <ClaimLimitBadge task={task} />
          {due.label && (
            <span
              className={cn(
                'inline-flex items-center gap-1',
                due.overdue && 'font-medium text-destructive',
                due.soon && !due.overdue && 'text-warning-foreground',
              )}
              title={due.overdue ? '已逾期' : undefined}
            >
              <CalendarClock className="h-3.5 w-3.5" aria-hidden />
              {due.label}
            </span>
          )}
        </div>

        <ClaimantAvatars claimants={task.claimants} />
      </div>

      {/* Actions row (state/role-aware) */}
      {(showClaim || showDeliver || showReview || showRevoke || (pendingReview && !showReview)) && (
        <div
          className="mt-2 flex flex-wrap items-center gap-2 pt-1 sm:mt-1 sm:pt-0"
          onClick={(e) => e.stopPropagation()}
        >
          {showClaim && <ClaimButton task={task} projectId={projectId} size="sm" />}

          {showRevoke && <RevokeApprovalButton task={task} projectId={projectId} size="sm" />}

          {showDeliver && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setDeliverOpen(true)}
              aria-label="交付任务"
            >
              <PackageCheck className="h-3.5 w-3.5" aria-hidden />
              交付
            </Button>
          )}

          {showReview && <ReviewActions task={task} projectId={projectId} size="sm" />}

          {pendingReview && !showReview && (
            // Two-stage chain (P2 §3): once first-approved the card reads 待复核
            // (violet, 初审人 in the tooltip); before that, 待审阅 as before.
            task.firstApprovedAt != null ? (
              <FirstApprovedChip task={task} />
            ) : (
              <Badge variant="warning" aria-label="待审阅">
                待审阅
              </Badge>
            )
          )}
        </div>
      )}

      {showDeliver && (
        <DeliverDialog
          task={task}
          projectId={projectId}
          open={deliverOpen}
          onOpenChange={setDeliverOpen}
        />
      )}
    </article>
  );
}
