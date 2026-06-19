import { differenceInCalendarDays, format, isValid, parseISO } from 'date-fns';

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
