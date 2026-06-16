import type { Task, TaskStatus } from 'shared';
import { cn } from '../../lib/utils';
import { TaskCard } from './TaskCard';
import { STATUS_LABELS } from './labels';
import type { TaskPermissionContext } from './permissions';

/**
 * A single board column (lifecycle v2 §5) — a vertical list of task cards. Cards
 * are static (no drag); status transitions happen via the card actions
 * (认领 / 交付 / 审阅) and the detail drawer.
 */
export interface ColumnProps {
  status: TaskStatus;
  tasks: Task[];
  projectId: string;
  /** Current user + project role; forwarded to each card for action gating. */
  permCtx: TaskPermissionContext;
  /** Show a per-card owning-project badge (the 全部项目 view, §8). */
  showProjectBadge?: boolean;
  onOpenTask?: (taskId: string) => void;
  /** Extra classes — used by the mobile paged view to show/hide one column. */
  className?: string;
}

const COLUMN_ACCENT: Record<TaskStatus, string> = {
  open: 'bg-muted-foreground/40',
  in_progress: 'bg-primary',
  pending_review: 'bg-warning',
  done: 'bg-success',
};

export function Column({
  status,
  tasks,
  projectId,
  permCtx,
  showProjectBadge = false,
  onOpenTask,
  className,
}: ColumnProps): JSX.Element {
  return (
    <section
      className={cn(
        // Mobile (paged view): the active column fills the width; siblings are
        // hidden by the parent (see Board). md+: equal full-width flex columns.
        'flex h-full min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-xl bg-secondary/40',
        'md:w-auto md:flex-1 md:shrink',
        className,
      )}
      aria-label={STATUS_LABELS[status]}
    >
      <header className="flex items-center gap-2 px-3 py-2.5">
        <span className={cn('h-2 w-2 rounded-full', COLUMN_ACCENT[status])} aria-hidden />
        <h2 className="text-sm font-semibold text-foreground">{STATUS_LABELS[status]}</h2>
        <span className="ml-auto rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {tasks.length}
        </span>
      </header>

      <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-3 pt-0.5">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            projectId={projectId}
            permCtx={permCtx}
            showProjectBadge={showProjectBadge}
            onOpen={onOpenTask}
          />
        ))}

        {tasks.length === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border/70 px-3 py-8 text-center text-xs text-muted-foreground">
            暂无任务
          </div>
        )}
      </div>
    </section>
  );
}
