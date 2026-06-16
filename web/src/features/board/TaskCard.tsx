import { CalendarClock, MessageSquare } from 'lucide-react';
import type { User, Task } from 'shared';
import { Avatar, Badge } from '../../components/ui';
import { avatarUrl, cn } from '../../lib/utils';
import { ClaimButton } from './ClaimButton';
import { dueInfo } from './format';
import { PRIORITY_BADGE, PRIORITY_LABELS } from './labels';

/**
 * Board task card (§6.1). Presents title, assignee avatar, points badge, priority
 * and due date; shows a {@link ClaimButton} for unassigned open tasks. Purely
 * presentational and dnd-agnostic — {@link SortableTaskCard} wraps it for drag.
 */
export interface TaskCardProps {
  task: Task;
  projectId: string;
  /** Resolve assignee id → user for the avatar (from project members). */
  assignee?: User | undefined;
  /** Open the detail drawer. */
  onOpen?: (taskId: string) => void;
  /** True while this card is the active drag overlay (subtle elevation). */
  dragging?: boolean;
  className?: string;
}

export function TaskCard({
  task,
  projectId,
  assignee,
  onOpen,
  dragging = false,
  className,
}: TaskCardProps): JSX.Element {
  const priority = PRIORITY_BADGE[task.priority];
  const due = dueInfo(task.dueDate);

  return (
    <article
      className={cn(
        'group flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left shadow-sm transition-shadow',
        'hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        dragging && 'rotate-1 shadow-lg ring-2 ring-primary/40',
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
      {/* Priority + points row */}
      <div className="flex items-center justify-between gap-2">
        <Badge variant={priority.variant} className="gap-1">
          <span className={cn('h-1.5 w-1.5 rounded-full', priority.dot)} aria-hidden />
          {PRIORITY_LABELS[task.priority]}
        </Badge>
        {task.points != null && (
          <Badge variant="primary" aria-label={`${task.points} 点`}>
            {task.points} 点
          </Badge>
        )}
      </div>

      {/* Title */}
      <h3 className="line-clamp-3 text-sm font-medium leading-snug text-foreground">
        {task.title}
      </h3>

      {/* Footer: due date + assignee/claim */}
      <div className="mt-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
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

        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {task.assigneeId && assignee ? (
            <Avatar
              name={assignee.displayName}
              color={assignee.avatarColor}
              imageUrl={assignee.hasAvatar ? avatarUrl(assignee.id) : undefined}
              size="xs"
            />
          ) : task.assigneeId ? (
            // Assignee present but not resolvable (e.g. not loaded) — neutral dot.
            <span
              className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-[10px] text-muted-foreground"
              aria-label="已指派"
            >
              <MessageSquare className="h-3 w-3" aria-hidden />
            </span>
          ) : (
            <ClaimButton task={task} projectId={projectId} size="sm" />
          )}
        </div>
      </div>
    </article>
  );
}
