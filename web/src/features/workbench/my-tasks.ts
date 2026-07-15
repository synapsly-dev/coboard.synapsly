import { useMemo } from 'react';
import type { Task } from 'shared';
import { useAllTasks } from '../../api/tasks';
import { useRejectedTasks, useReviewQueue } from '../../api/workbench';
import { useAuth } from '../../lib/auth-context';
import { dueInfo } from '../board/format';

/**
 * Shared 工作台 selectors (P2 §4 / P3 §3). The WorkbenchPage's 「我的进行中」 list
 * and the nav badge both derive from the same /tasks/all + claimant/dueDate logic;
 * extracting it here keeps the two from drifting. Everything runs over the already
 * cached queries — no extra fetches.
 */

/** Due date ascending (nulls last), then title, so 最紧急的排最前. */
export function byDueDateThenTitle(a: Task, b: Task): number {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate == null) return 1;
    if (b.dueDate == null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return a.title.localeCompare(b.title, 'zh-CN');
}

/** The caller's active (待认领/进行中) claimed tasks, most urgent first. */
export function selectMyActiveTasks(
  tasks: readonly Task[],
  myId: string | null | undefined,
): Task[] {
  if (myId == null) return [];
  return tasks
    .filter(
      (t) =>
        (t.status === 'open' || t.status === 'in_progress') &&
        t.claimants.some((c) => c.userId === myId),
    )
    .sort(byDueDateThenTitle);
}

/**
 * DDL urgency for the reminder badge (P3 §3): overdue, or due within ~48h. Uses
 * the same {@link dueInfo} classification the workbench rows render (已逾期 /
 * 即将到期), so the badge count always matches what the page highlights.
 */
export function isDueUrgent(task: Task): boolean {
  const due = dueInfo(task.dueDate);
  return due.overdue || due.soon;
}

/**
 * 工作台 nav badge count (P3 §3): tasks awaiting my review PLUS my active tasks
 * that are overdue / due soon. Composes the same cached queries the workbench
 * page uses (review-queue + /tasks/all), so mounting it in the nav costs at most
 * one fetch per staleness window.
 */
export function useWorkbenchBadgeCount(): number {
  const { user } = useAuth();
  const { data: reviewQueue } = useReviewQueue();
  const { data: rejectedTasks } = useRejectedTasks();
  const { data: allTasks } = useAllTasks();
  const myId = user?.id;
  return useMemo(() => {
    const ids = new Set<string>();
    for (const task of reviewQueue ?? []) ids.add(task.id);
    for (const task of rejectedTasks ?? []) ids.add(task.id);
    for (const task of selectMyActiveTasks(allTasks ?? [], myId)) {
      if (isDueUrgent(task)) ids.add(task.id);
    }
    return ids.size;
  }, [reviewQueue, rejectedTasks, allTasks, myId]);
}
