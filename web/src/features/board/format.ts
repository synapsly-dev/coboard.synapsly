import { differenceInCalendarDays, format, isValid, parseISO } from 'date-fns';
import type { Task } from 'shared';
import { STATUS_TIME } from './labels';

/**
 * Small presentation helpers for tasks: due-date formatting with overdue/soon
 * awareness, and relative timestamps for comments/activities. Kept feature-local.
 */

export interface DueInfo {
  /** "MM-dd" formatted label, or null if no/invalid date. */
  label: string | null;
  /** Negative = overdue, 0 = today, positive = days remaining. */
  daysUntil: number | null;
  overdue: boolean;
  soon: boolean;
}

/** Parse a "YYYY-MM-DD" due date and classify its urgency relative to today. */
export function dueInfo(dueDate: string | null): DueInfo {
  if (!dueDate) {
    return { label: null, daysUntil: null, overdue: false, soon: false };
  }
  const parsed = parseISO(dueDate);
  if (!isValid(parsed)) {
    return { label: null, daysUntil: null, overdue: false, soon: false };
  }
  const daysUntil = differenceInCalendarDays(parsed, new Date());
  return {
    label: format(parsed, 'MM-dd'),
    daysUntil,
    overdue: daysUntil < 0,
    soon: daysUntil >= 0 && daysUntil <= 2,
  };
}

/** Format an ISO datetime for compact display (e.g. "06-15 14:30"). */
export function formatDateTime(iso: string): string {
  const parsed = parseISO(iso);
  if (!isValid(parsed)) return '';
  return format(parsed, 'MM-dd HH:mm');
}

/** Format an ISO date as a plain calendar day (e.g. "2026-06-15"). */
export function formatDate(iso: string): string {
  const parsed = parseISO(iso);
  if (!isValid(parsed)) return '';
  return format(parsed, 'yyyy-MM-dd');
}

/** The lifecycle timestamp a task card shows (板块时间). */
export interface StatusTimeInfo {
  /** Chinese verb prefix: "发布" / "提交" / "完成". */
  prefix: string;
  /** Compact "MM-dd HH:mm" timestamp. */
  text: string;
}

/**
 * Pick the stage-appropriate timestamp for a card, per {@link STATUS_TIME}:
 * 待认领/进行中 → 发布时间 (`createdAt`); 待审阅 → 提交时间 (`deliveredAt`);
 * 已完成 → 完成时间 (`completedAt`). Null when the stage's timestamp is missing
 * or unparsable (e.g. a pending_review task defensively lacking `deliveredAt`).
 */
export function statusTimeInfo(
  task: Pick<Task, 'status' | 'createdAt' | 'deliveredAt' | 'completedAt'>,
): StatusTimeInfo | null {
  const spec = STATUS_TIME[task.status];
  const iso = task[spec.field];
  if (!iso) return null;
  const text = formatDateTime(iso);
  return text ? { prefix: spec.prefix, text } : null;
}

/**
 * Whether a completed task met its DDL. `dueDate` is date-only, so finishing any
 * time on the due day itself counts as on time. Null (= no verdict) when either
 * side is missing or unparsable.
 *
 * Days are compared in the viewer's local calendar — the same convention every
 * due-date display uses ({@link dueInfo}'s overdue/soon). For a team spread
 * across timezones the verdict could differ per viewer near midnight; the app
 * consistently accepts that trade-off rather than pinning a business timezone.
 */
export function completedOnTime(
  completedAt: string | null,
  dueDate: string | null,
): boolean | null {
  if (!completedAt || !dueDate) return null;
  const completed = parseISO(completedAt);
  const due = parseISO(dueDate);
  if (!isValid(completed) || !isValid(due)) return null;
  return differenceInCalendarDays(due, completed) >= 0;
}

/**
 * Semantic state of a task's DDL, shared by the board card and the detail drawer
 * so the two can never render contradictory verdicts:
 *
 * - 已完成 tasks get a fixed verdict: `on_time` (按期完成) / `late` (逾期完成);
 *   with `completedAt` defensively missing, a past DDL still reads `overdue` so
 *   the late signal is never silently lost.
 * - Unfinished tasks keep the live urgency: `overdue` (已逾期) / `soon` (即将到期).
 * - Null = no due date, or nothing noteworthy about it.
 */
export type DueVerdict = 'on_time' | 'late' | 'overdue' | 'soon' | null;

export function dueVerdict(
  task: Pick<Task, 'status' | 'completedAt' | 'dueDate'>,
): DueVerdict {
  const due = dueInfo(task.dueDate);
  if (!due.label) return null;
  if (task.status === 'done') {
    const onTime = completedOnTime(task.completedAt, task.dueDate);
    if (onTime !== null) return onTime ? 'on_time' : 'late';
    return due.overdue ? 'overdue' : null;
  }
  if (due.overdue) return 'overdue';
  if (due.soon) return 'soon';
  return null;
}

/** Coarse relative time in Chinese ("刚刚 / 5 分钟前 / 3 小时前 / 06-15"). */
export function relativeTime(iso: string): string {
  const parsed = parseISO(iso);
  if (!isValid(parsed)) return '';
  const diffMs = Date.now() - parsed.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  return format(parsed, 'yyyy-MM-dd');
}
