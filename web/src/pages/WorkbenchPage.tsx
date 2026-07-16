import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  ClipboardCheck,
  FolderKanban,
  Hand,
  ListTodo,
} from 'lucide-react';
import type { Notification, Task } from 'shared';
import type { LucideIcon } from 'lucide-react';
import { Badge, EmptyState, Spinner } from '../components/ui';
import { useAuth } from '../lib/auth-context';
import { cn } from '../lib/utils';
import { useAllTasks } from '../api/tasks';
import { useMarkNotificationRead, useNotifications } from '../api/notifications';
import { useRejectedTasks, useReviewQueue } from '../api/workbench';
import { useMyStats } from '../api/stats';
import { DEFAULT_FILTERS, resolveStatsQuery } from '../features/stats';
import { isDueUrgent, selectMyActiveTasks } from '../features/workbench/my-tasks';
import { dueInfo, relativeTime } from '../features/board/format';
import { TaskTypeBadge } from '../features/board/TaskTypeBadge';
import { isClaimFull } from 'shared';
import { FINAL_REVIEW_CHIP_CLASS, STATUS_LABELS } from '../features/board/labels';
import { NotificationRows, notificationHref } from '../features/notifications/NotificationCenter';

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
  const notifications = useNotifications('unread', 6);
  const markNotificationRead = useMarkNotificationRead();

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
  const mine = useMemo(() => selectMyActiveTasks(allTasks.data ?? [], myId), [allTasks.data, myId]);

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
  const rejectedIds = useMemo(() => new Set(rejectedTasks.map((task) => task.id)), [rejectedTasks]);
  const urgentMine = useMemo(
    () => mine.filter((task) => isDueUrgent(task) && !rejectedIds.has(task.id)),
    [mine, rejectedIds],
  );
  const progressing = useMemo(
    () => mine.filter((task) => !isDueUrgent(task) && !rejectedIds.has(task.id)),
    [mine, rejectedIds],
  );
  const immediateCount = queue.length + rejectedTasks.length + urgentMine.length;

  function openTask(task: Task): void {
    navigate(`/board/${task.projectId ?? 'all'}?task=${task.id}`);
  }

  function openNotification(notification: Notification): void {
    if (notification.readAt === null) markNotificationRead.mutate(notification.id);
    navigate(notificationHref(notification));
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">工作台</h1>
            <p className="text-sm text-muted-foreground">
              先处理紧急事项，再持续推进任务，并掌握与你相关的变化。
            </p>
          </div>
          {/* 本周统计 — compact stat strip (same week window as 统计). */}
          <div className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-2.5 text-sm shadow-sm">
            <span className="text-muted-foreground">本周</span>
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

        {/* 1. Immediate actions are derived from current task state, not notification history. */}
        <Section icon={AlertTriangle} title="立即处理" count={immediateCount}>
          {reviewQueue.isLoading || rejected.isLoading || allTasks.isLoading ? (
            <div className="rounded-lg border border-border bg-card py-7 text-center shadow-sm">
              <Spinner label="加载待处理事项" />
            </div>
          ) : immediateCount === 0 ? (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
                <ClipboardCheck className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-medium text-foreground">当前没有紧急事项</p>
                <p className="text-xs text-muted-foreground">
                  新的审核、退回或截止提醒会集中在这里。
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
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
                      meta={t.firstApprover ? `初审人 ${t.firstApprover.displayName}` : undefined}
                    />
                  ))}
                </TaskGroup>
              )}
              {rejectedTasks.length > 0 && (
                <TaskGroup label="被退回" count={rejectedTasks.length} destructive>
                  {rejectedTasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onOpen={openTask}
                      showDue
                      meta={`已退回 · 当前「${STATUS_LABELS[task.status]}」`}
                      metaTone="destructive"
                    />
                  ))}
                </TaskGroup>
              )}
              {urgentMine.length > 0 && (
                <TaskGroup label="临近截止" count={urgentMine.length} warning>
                  {urgentMine.map((task) => (
                    <TaskRow key={task.id} task={task} onOpen={openTask} showDue />
                  ))}
                </TaskGroup>
              )}
            </div>
          )}
        </Section>

        {/* 2. Non-urgent active work; urgent/rejected tasks live above. */}
        <Section icon={ListTodo} title="正在推进" count={progressing.length}>
          {allTasks.isLoading ? (
            <div className="py-6 text-center">
              <Spinner label="加载任务" />
            </div>
          ) : progressing.length === 0 ? (
            <EmptyState
              icon={ListTodo}
              title={mine.length > 0 ? '进行中的任务都需要优先处理' : '暂无进行中的任务'}
              description={
                mine.length > 0
                  ? '这些任务已集中到上方「立即处理」。'
                  : '去看板认领一个任务，或从下方「可认领」直接开始。'
              }
              className="py-8"
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              {progressing.map((t) => (
                <TaskRow key={t.id} task={t} onOpen={openTask} showDue />
              ))}
            </div>
          )}
        </Section>

        {/* 3. Unread context. Task state remains the source of truth for actions above. */}
        <Section icon={Bell} title="与你相关" count={notifications.data?.counts.unread ?? 0}>
          {notifications.isLoading ? (
            <div className="rounded-lg border border-border bg-card py-7 text-center shadow-sm">
              <Spinner label="加载通知" />
            </div>
          ) : (notifications.data?.notifications.length ?? 0) === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
              暂无未读通知
            </div>
          ) : (
            <NotificationRows
              notifications={notifications.data?.notifications ?? []}
              onOpen={openNotification}
              compact
            />
          )}
        </Section>

        {/* 4. Claimable work is deliberately lower priority than personal obligations. */}
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
  destructive = false,
  warning = false,
  children,
}: {
  label: string;
  count: number;
  /** 待复核 group gets the violet stage hue (P2 §3). */
  finalStage?: boolean;
  destructive?: boolean;
  warning?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 leading-none',
            finalStage
              ? FINAL_REVIEW_CHIP_CLASS
              : destructive
                ? 'bg-destructive/10 text-destructive'
                : warning
                  ? 'bg-warning/15 text-warning-foreground'
                  : 'bg-secondary text-secondary-foreground',
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
