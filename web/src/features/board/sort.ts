import type { Priority, Task, TaskStatus } from 'shared';

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
