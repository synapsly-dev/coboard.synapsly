import type { Priority, Task, TaskStatus } from 'shared';
import { STATUS_TIME } from './labels';

/**
 * Column-aware task ordering (task-sort feature). Each board column sorts by a
 * meaning that fits its lifecycle stage rather than a single manual rank:
 *
 * - 待认领 `open`           — by urgency (urgent → low); ties → oldest waiting first,
 *                            so the longest-unclaimed task of a given urgency leads.
 * - 进行中 `in_progress`    — by when it became in_progress (its first claim),
 *                            newest first.
 * - 待审阅 `pending_review` — by when it entered review (`deliveredAt`), OLDEST
 *                            first (a FIFO review queue).
 * - 已完成 `done`           — by completion time (`completedAt`), newest first.
 *
 * Datetimes are compared by parsed epoch (the wire format allows a timezone
 * offset, so lexicographic compare is unsafe). Every comparator falls back to
 * `createdAt` for a deterministic, stable order on ties.
 */

/** Urgency rank — higher is more urgent. */
const PRIORITY_ORDER: Record<Priority, number> = {
  low: 0,
  medium: 1,
  high: 2,
  urgent: 3,
};

/** Epoch ms for an ISO datetime; null/invalid sorts as 0 (the epoch). */
function ms(iso: string | null): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * When a task entered `in_progress` — i.e. when it was first claimed. Multi-claim
 * tasks use the earliest claim; falls back to creation time if (defensively) the
 * task has no claimants.
 */
function inProgressEnteredAt(task: Task): number {
  let earliest = Infinity;
  for (const c of task.claimants) {
    const t = ms(c.claimedAt);
    if (t < earliest) earliest = t;
  }
  return earliest === Infinity ? ms(task.createdAt) : earliest;
}

/**
 * User-selectable column sort (板块排序). `default` is the lifecycle order built by
 * {@link compareTasksInColumn}; the rest re-sort the column on demand:
 *
 * - `time_desc` / `time_asc` — by the column's own display timestamp
 *                              (发布/提交/完成时间, see {@link columnTimeMs}).
 * - `priority`               — urgency (urgent → low).
 * - `due`                    — soonest due date first; undated tasks sink to the end.
 *
 * Every key breaks ties with the column's default order, so switching keys never
 * shuffles equal cards arbitrarily.
 */
export type ColumnSortKey = 'default' | 'time_desc' | 'time_asc' | 'priority' | 'due';

/**
 * The column's display timestamp (板块时间) as epoch ms, per {@link STATUS_TIME} —
 * the same mapping the card chip renders. Null when the stage timestamp is
 * missing/unparsable; the time comparators sink those to the end (in BOTH
 * directions) so a card showing no timestamp never sits inexplicably mid-list.
 */
export function columnTimeMs(task: Task, status: TaskStatus): number | null {
  const iso = task[STATUS_TIME[status].field];
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Due-date epoch for sorting; undated/invalid dates sort last. */
function dueMs(task: Task): number {
  if (!task.dueDate) return Infinity;
  const t = Date.parse(task.dueDate);
  return Number.isNaN(t) ? Infinity : t;
}

/** Comparator for a user-chosen sort key within a column. */
export function compareTasksForKey(
  status: TaskStatus,
  key: ColumnSortKey,
): (a: Task, b: Task) => number {
  const base = compareTasksInColumn(status);
  switch (key) {
    case 'time_desc':
    case 'time_asc':
      return (a, b) => {
        const ta = columnTimeMs(a, status);
        const tb = columnTimeMs(b, status);
        if (ta === null || tb === null) {
          // No visible stage timestamp → last, whichever direction is chosen.
          if (ta === tb) return base(a, b);
          return ta === null ? 1 : -1;
        }
        if (ta === tb) return base(a, b);
        return key === 'time_desc' ? tb - ta : ta - tb;
      };
    case 'priority':
      return (a, b) => PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority] || base(a, b);
    case 'due':
      return (a, b) => {
        const da = dueMs(a);
        const db = dueMs(b);
        // Strict compare first: both-undated is Infinity - Infinity = NaN.
        if (da !== db) return da - db;
        return base(a, b);
      };
    default:
      return base;
  }
}

/**
 * Build a column-search predicate (板块搜索): case-insensitive substring match
 * over what a user can see on the card — title, label names, claimant names, and
 * the owning project name (visible in the 全部项目 view). The query is normalized
 * once here, not per task. Null = empty/whitespace query, i.e. "not filtering" —
 * the single definition callers branch on.
 */
export function taskMatcher(query: string): ((task: Task) => boolean) | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  return (task) =>
    task.title.toLowerCase().includes(q) ||
    task.labels.some((l) => l.name.toLowerCase().includes(q)) ||
    task.claimants.some((c) => c.displayName.toLowerCase().includes(q)) ||
    (task.projectName ?? '').toLowerCase().includes(q);
}

/** Build the comparator for a given column's status. */
export function compareTasksInColumn(status: TaskStatus): (a: Task, b: Task) => number {
  switch (status) {
    case 'open':
      return (a, b) => {
        const byUrgency = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
        if (byUrgency !== 0) return byUrgency;
        return ms(a.createdAt) - ms(b.createdAt); // oldest waiting first
      };
    case 'in_progress':
      return (a, b) => {
        const d = inProgressEnteredAt(b) - inProgressEnteredAt(a); // newest first
        if (d !== 0) return d;
        return ms(b.createdAt) - ms(a.createdAt);
      };
    case 'pending_review':
      return (a, b) => {
        const d = ms(a.deliveredAt) - ms(b.deliveredAt); // oldest first (FIFO)
        if (d !== 0) return d;
        return ms(a.createdAt) - ms(b.createdAt);
      };
    case 'done':
      return (a, b) => {
        const d = ms(b.completedAt) - ms(a.completedAt); // newest first
        if (d !== 0) return d;
        return ms(b.createdAt) - ms(a.createdAt);
      };
    default:
      return (a, b) => ms(a.createdAt) - ms(b.createdAt);
  }
}
