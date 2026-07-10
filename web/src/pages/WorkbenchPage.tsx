import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarClock,
  ClipboardCheck,
  FolderKanban,
  Hand,
  ListTodo,
  Undo2,
} from 'lucide-react';
import type { Task } from 'shared';
import type { LucideIcon } from 'lucide-react';
import { Badge, EmptyState, Spinner } from '../components/ui';
import { useAuth } from '../lib/auth-context';
import { cn } from '../lib/utils';
import { useAllTasks } from '../api/tasks';
import { useRejectedTasks, useReviewQueue } from '../api/workbench';
import { useMyStats } from '../api/stats';
import { DEFAULT_FILTERS, resolveStatsQuery } from '../features/stats';
import { selectMyActiveTasks } from '../features/workbench/my-tasks';
import { dueInfo, relativeTime } from '../features/board/format';
import { TaskTypeBadge } from '../features/board/TaskTypeBadge';
import { isClaimFull } from '../features/board/permissions';
import { FINAL_REVIEW_CHIP_CLASS, STATUS_LABELS } from '../features/board/labels';

/**
 * 个人工作台 (P2 §4, 运营需求 §3 层级 3) — one page answering 「我现在该干什么」:
 * 1. 待我审核 — the review queue (初审 vs 待复核 groups, P2 §3);
 * 2. 我的进行中 — my claimed open/in_progress tasks with DDL urgency;
 * 3. 可认领 — open tasks I could pick up (C/D 类 or pool, not full);
 * 4. 最近被退回 — my recently rejected deliveries;
 * plus a 本周点数 stat strip (same Monday-based week as the stats page).
 *
 * Rows are compact (not full TaskCards) and deep-link to the owning board with
 * `?task=<id>`, which opens the detail drawer there (see Board.tsx).
 */
export default function WorkbenchPage(): JSX.Element {
  const { user } = useAuth();
  const navigate = useNavigate();

  const reviewQueue = useReviewQueue();
  const allTasks = useAllTasks();
  const rejected = useRejectedTasks();

  // 本周 window — identical computation to the stats page (Monday-based).
  const week = useMemo(() => resolveStatsQuery(DEFAULT_FILTERS), []);
  const myStats = useMyStats({ from: week.from, to: week.to });

  const queue = reviewQueue.data ?? [];
  // Two-stage split (P2 §3): first-approved tasks await the admin's 复核.
  const awaitingFirst = queue.filter((t) => t.firstApprovedAt == null);
  const awaitingFinal = queue.filter((t) => t.firstApprovedAt != null);

  const myId = user?.id;
  // Shared with the nav badge (P3 §3, features/workbench/my-tasks) so the page
  // list and the reminder count can't drift.
  const mine = useMemo(
    () => selectMyActiveTasks(allTasks.data ?? [], myId),
    [allTasks.data, myId],
  );

  const claimable = useMemo(() => {
    const tasks = allTasks.data ?? [];
    return tasks.filter(
      (t) =>
        t.status === 'open' &&
        (myId == null || !t.claimants.some((c) => c.userId === myId)) &&
        !isClaimFull(t) &&
        (t.projectId === null || t.taskType === 'claimable' || t.taskType === 'collab'),
    );
  }, [allTasks.data, myId]);

  const rejectedTasks = rejected.data ?? [];

  function openTask(task: Task): void {
    navigate(`/board/${task.projectId ?? 'all'}?task=${task.id}`);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">工作台</h1>
            <p className="text-sm text-muted-foreground">
              待办审核、进行中的任务与可认领的机会，一页看清。
            </p>
          </div>
          {/* 本周我的点数 — compact stat strip (same week window as 统计). */}
          <div className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-2.5 text-sm shadow-sm">
            <span className="text-muted-foreground">本周我的点数</span>
            {myStats.isLoading ? (
              <Spinner />
            ) : (
              <>
                <span className="text-lg font-semibold tabular-nums text-foreground">
                  {myStats.data?.pointsSum ?? 0}
                  <span className="ml-0.5 text-xs font-normal text-muted-foreground">点</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  完成 {myStats.data?.completedCount ?? 0} 个任务
                </span>
              </>
            )}
          </div>
        </header>

        {/* 1. 待我审核 — hidden entirely when the queue is empty. */}
        {queue.length > 0 && (
          <Section icon={ClipboardCheck} title="待我审核" count={queue.length}>
            {awaitingFirst.length > 0 && (
              <TaskGroup label="待初审" count={awaitingFirst.length}>
                {awaitingFirst.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    onOpen={openTask}
                    meta={
                      t.deliverer
                        ? `提交人 ${t.deliverer.displayName}${
                            t.deliveredAt ? ` · ${relativeTime(t.deliveredAt)}` : ''
                          }`
                        : undefined
                    }
                  />
                ))}
              </TaskGroup>
            )}
            {awaitingFinal.length > 0 && (
              <TaskGroup label="待复核" count={awaitingFinal.length} finalStage>
                {awaitingFinal.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    onOpen={openTask}
                    meta={
                      t.firstApprover ? `初审人 ${t.firstApprover.displayName}` : undefined
                    }
                  />
                ))}
              </TaskGroup>
            )}
          </Section>
        )}

        {/* 2. 我的进行中 — always visible; empty state when nothing claimed. */}
        <Section icon={ListTodo} title="我的进行中" count={mine.length}>
          {allTasks.isLoading ? (
            <div className="py-6 text-center">
              <Spinner label="加载任务" />
            </div>
          ) : mine.length === 0 ? (
            <EmptyState
              icon={ListTodo}
              title="暂无进行中的任务"
              description="去看板认领一个任务，或从下方「可认领」直接开始。"
              className="py-8"
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              {mine.map((t) => (
                <TaskRow key={t.id} task={t} onOpen={openTask} showDue />
              ))}
            </div>
          )}
        </Section>

        {/* 3. 可认领 — hidden when empty. */}
        {claimable.length > 0 && (
          <Section icon={Hand} title="可认领" count={claimable.length}>
            <div className="flex flex-col gap-1.5">
              {claimable.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  onOpen={openTask}
                  showDue
                  meta={`已认领 ${t.claimants.length}/${
                    t.maxClaimants != null ? t.maxClaimants : '不限'
                  }`}
                />
              ))}
            </div>
          </Section>
        )}

        {/* 4. 最近被退回 — hidden when empty. */}
        {rejectedTasks.length > 0 && (
          <Section icon={Undo2} title="最近被退回" count={rejectedTasks.length}>
            <div className="flex flex-col gap-1.5">
              {rejectedTasks.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  onOpen={openTask}
                  showDue
                  meta={`已退回 · 当前「${STATUS_LABELS[t.status]}」`}
                  metaTone="destructive"
                />
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presentational pieces
// ---------------------------------------------------------------------------

function Section({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: LucideIcon;
  title: string;
  count?: number;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
        {title}
        {count != null && count > 0 && (
          <Badge variant="neutral" className="tabular-nums">
            {count}
          </Badge>
        )}
      </h2>
      {children}
    </section>
  );
}

/** A labeled sub-group (待初审 / 待复核) with its own count chip. */
function TaskGroup({
  label,
  count,
  finalStage = false,
  children,
}: {
  label: string;
  count: number;
  /** 待复核 group gets the violet stage hue (P2 §3). */
  finalStage?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 leading-none',
            finalStage ? FINAL_REVIEW_CHIP_CLASS : 'bg-warning/15 text-warning-foreground',
          )}
        >
          {label}
          <span className="tabular-nums">{count}</span>
        </span>
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

/**
 * Compact task row: type letter, title, project/pool badge, points, optional DDL
 * urgency and a status-specific meta line. Click navigates to the owning board
 * with `?task=<id>` (opens the detail drawer there).
 */
function TaskRow({
  task,
  onOpen,
  meta,
  metaTone,
  showDue = false,
}: {
  task: Task;
  onOpen: (task: Task) => void;
  /** Status-specific trailing context, e.g. 提交人 / 初审人 / 已认领 x/y. */
  meta?: string;
  metaTone?: 'destructive';
  /** Show the DDL urgency badge (已逾期 / 即将到期) for date-sensitive lists. */
  showDue?: boolean;
}): JSX.Element {
  const due = dueInfo(task.dueDate);
  return (
    <button
      type="button"
      onClick={() => onOpen(task)}
      className={cn(
        'flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-card px-3 py-2 text-left shadow-sm',
        'transition-[box-shadow,border-color,transform] duration-base ease-standard',
        'hover:border-primary/40 hover:shadow-md active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
      aria-label={`查看任务：${task.title}`}
    >
      <TaskTypeBadge taskType={task.taskType} codeOnly />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        {task.title}
      </span>

      {showDue && due.label && (due.overdue || due.soon) && (
        <Badge variant={due.overdue ? 'destructive' : 'warning'} className="gap-1 shrink-0">
          <CalendarClock className="h-3 w-3" aria-hidden />
          {due.overdue ? '已逾期' : '即将到期'}
        </Badge>
      )}

      {task.points != null && (
        <Badge variant="primary" className="shrink-0 tabular-nums">
          {task.points} 点
        </Badge>
      )}

      <Badge variant="outline" className="max-w-[9rem] shrink-0 gap-1">
        <FolderKanban className="h-3 w-3 shrink-0" aria-hidden />
        <span className="truncate">{task.projectName ?? '任务池'}</span>
      </Badge>

      {meta && (
        <span
          className={cn(
            'w-full truncate text-xs sm:w-auto',
            metaTone === 'destructive' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {meta}
        </span>
      )}
    </button>
  );
}
