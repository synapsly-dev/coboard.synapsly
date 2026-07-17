import type { Priority, Task, TaskStatus } from 'shared';

export type ColumnSortKey = 'default' | 'time_desc' | 'time_asc' | 'priority' | 'due';

const PRIORITY_ORDER: Record<Priority, number> = { low: 0, medium: 1, high: 2, urgent: 3 };

function ms(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function enteredInProgressAt(task: Task): number {
  const values = task.claimants.map((claimant) => ms(claimant.claimedAt));
  return values.length ? Math.min(...values) : ms(task.createdAt);
}

function stageTime(task: Task, status: TaskStatus): number | null {
  const value = status === 'pending_review' ? task.deliveredAt : status === 'done' ? task.completedAt : task.createdAt;
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function compareTasksInColumn(status: TaskStatus): (a: Task, b: Task) => number {
  if (status === 'open') return (a, b) => PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority] || ms(a.createdAt) - ms(b.createdAt);
  if (status === 'in_progress') return (a, b) => enteredInProgressAt(b) - enteredInProgressAt(a) || ms(b.createdAt) - ms(a.createdAt);
  if (status === 'pending_review') return (a, b) => ms(a.deliveredAt) - ms(b.deliveredAt) || ms(a.createdAt) - ms(b.createdAt);
  return (a, b) => ms(b.completedAt) - ms(a.completedAt) || ms(b.createdAt) - ms(a.createdAt);
}

export function compareTasksForKey(status: TaskStatus, key: ColumnSortKey): (a: Task, b: Task) => number {
  const base = compareTasksInColumn(status);
  if (key === 'priority') return (a, b) => PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority] || base(a, b);
  if (key === 'due') return (a, b) => {
    const left = a.dueDate ? ms(a.dueDate) : Infinity;
    const right = b.dueDate ? ms(b.dueDate) : Infinity;
    return left !== right ? left - right : base(a, b);
  };
  if (key === 'time_desc' || key === 'time_asc') return (a, b) => {
    const left = stageTime(a, status); const right = stageTime(b, status);
    if (left == null || right == null) return left === right ? base(a, b) : left == null ? 1 : -1;
    return left === right ? base(a, b) : key === 'time_desc' ? right - left : left - right;
  };
  return base;
}

export function taskMatcher(raw: string): ((task: Task) => boolean) | null {
  const query = raw.trim().toLowerCase();
  if (!query) return null;
  return (task) => task.title.toLowerCase().includes(query)
    || task.labels.some((label) => label.name.toLowerCase().includes(query))
    || task.claimants.some((claimant) => claimant.displayName.toLowerCase().includes(query))
    || (task.projectName ?? '').toLowerCase().includes(query);
}
