import { describe, expect, it } from 'vitest';
import type { Priority, Task, TaskClaimant, TaskStatus } from 'shared';
import {
  compareTasksForKey,
  compareTasksInColumn,
  taskMatcher,
  type ColumnSortKey,
} from './sort';

/**
 * Column-aware task ordering (task-sort). Verifies each board column sorts by its
 * lifecycle-appropriate key and direction.
 */

function claimant(claimedAt: string): TaskClaimant {
  return {
    userId: '00000000-0000-0000-0000-000000000001',
    displayName: 'x',
    avatarColor: '#000000',
    hasAvatar: false,
    points: null,
    claimedAt,
  };
}

function task(over: Partial<Task> & { id: string }): Task {
  return {
    projectId: null,
    projectName: null,
    projectKey: null,
    title: over.id,
    description: null,
    deliverableSpec: null,
    acceptanceCriteria: null,
    qualityGrade: null,
    needsFinalReview: false,
    firstApprovedBy: null,
    firstApprover: null,
    firstApprovedAt: null,
    status: 'open',
    points: null,
    priority: 'medium',
    taskType: null,
    minClaimants: 1,
    maxClaimants: null,
    dueDate: null,
    createdBy: '00000000-0000-0000-0000-000000000001',
    creator: null,
    rank: 'm',
    completedAt: null,
    deliveredAt: null,
    deliveredBy: null,
    deliverer: null,
    reviewedBy: null,
    reviewer: null,
    claimants: [],
    labels: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function order(status: TaskStatus, tasks: Task[]): string[] {
  return [...tasks].sort(compareTasksInColumn(status)).map((t) => t.id);
}

describe('compareTasksInColumn', () => {
  it('待认领 open: urgency desc, then oldest-waiting first on ties', () => {
    const mk = (id: string, priority: Priority, createdAt: string) =>
      task({ id, status: 'open', priority, createdAt });
    const tasks = [
      mk('low', 'low', '2026-01-01T00:00:00.000Z'),
      mk('urgent', 'urgent', '2026-01-05T00:00:00.000Z'),
      mk('high', 'high', '2026-01-03T00:00:00.000Z'),
      mk('med-new', 'medium', '2026-02-01T00:00:00.000Z'),
      mk('med-old', 'medium', '2026-01-02T00:00:00.000Z'),
    ];
    // urgent > high > medium(oldest first) > low
    expect(order('open', tasks)).toEqual(['urgent', 'high', 'med-old', 'med-new', 'low']);
  });

  it('进行中 in_progress: by first-claim time, newest first', () => {
    const a = task({ id: 'a', status: 'in_progress', claimants: [claimant('2026-01-10T00:00:00.000Z')] });
    const b = task({ id: 'b', status: 'in_progress', claimants: [claimant('2026-01-20T00:00:00.000Z')] });
    // multi-claim uses the earliest claim → c entered at 01-05 (oldest), so it sinks
    const c = task({
      id: 'c',
      status: 'in_progress',
      claimants: [claimant('2026-01-25T00:00:00.000Z'), claimant('2026-01-05T00:00:00.000Z')],
    });
    expect(order('in_progress', [a, b, c])).toEqual(['b', 'a', 'c']);
  });

  it('待审阅 pending_review: by deliveredAt, oldest first (FIFO)', () => {
    const a = task({ id: 'a', status: 'pending_review', deliveredAt: '2026-01-10T00:00:00.000Z' });
    const b = task({ id: 'b', status: 'pending_review', deliveredAt: '2026-01-02T00:00:00.000Z' });
    const c = task({ id: 'c', status: 'pending_review', deliveredAt: '2026-01-20T00:00:00.000Z' });
    expect(order('pending_review', [a, b, c])).toEqual(['b', 'a', 'c']);
  });

  it('已完成 done: by completedAt, newest first', () => {
    const a = task({ id: 'a', status: 'done', completedAt: '2026-01-10T00:00:00.000Z' });
    const b = task({ id: 'b', status: 'done', completedAt: '2026-01-02T00:00:00.000Z' });
    const c = task({ id: 'c', status: 'done', completedAt: '2026-01-20T00:00:00.000Z' });
    expect(order('done', [a, b, c])).toEqual(['c', 'a', 'b']);
  });

  it('handles offset timezones by epoch, not lexicographically', () => {
    // 09:00+09:00 == 00:00Z; 23:30-01:00 == 00:30 next-day-Z. Lexicographic on the
    // raw strings would mis-order these; epoch compare must not.
    const earlier = task({ id: 'earlier', status: 'done', completedAt: '2026-03-02T09:00:00.000+09:00' });
    const later = task({ id: 'later', status: 'done', completedAt: '2026-03-01T23:30:00.000-01:00' });
    expect(order('done', [earlier, later])).toEqual(['later', 'earlier']);
  });
});

describe('compareTasksForKey (板块排序)', () => {
  function orderBy(status: TaskStatus, key: ColumnSortKey, tasks: Task[]): string[] {
    return [...tasks].sort(compareTasksForKey(status, key)).map((t) => t.id);
  }

  it('default matches the column lifecycle order', () => {
    const a = task({ id: 'a', status: 'open', priority: 'low' });
    const b = task({ id: 'b', status: 'open', priority: 'urgent' });
    expect(orderBy('open', 'default', [a, b])).toEqual(order('open', [a, b]));
  });

  it('time keys on 待审阅 sort by 提交时间 (deliveredAt), both directions', () => {
    const early = task({
      id: 'early',
      status: 'pending_review',
      deliveredAt: '2026-01-10T00:00:00.000Z',
      createdAt: '2026-01-09T00:00:00.000Z',
    });
    const late = task({
      id: 'late',
      status: 'pending_review',
      deliveredAt: '2026-01-20T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(orderBy('pending_review', 'time_desc', [early, late])).toEqual(['late', 'early']);
    expect(orderBy('pending_review', 'time_asc', [late, early])).toEqual(['early', 'late']);
  });

  it('time keys on 进行中 sort by 发布时间 (createdAt), not claim time', () => {
    // Claim order says a entered later, but publish order says b is newer —
    // the explicit time sort must follow what the card displays (发布时间).
    const a = task({
      id: 'a',
      status: 'in_progress',
      createdAt: '2026-01-01T00:00:00.000Z',
      claimants: [claimant('2026-02-20T00:00:00.000Z')],
    });
    const b = task({
      id: 'b',
      status: 'in_progress',
      createdAt: '2026-01-15T00:00:00.000Z',
      claimants: [claimant('2026-02-10T00:00:00.000Z')],
    });
    expect(orderBy('in_progress', 'time_desc', [a, b])).toEqual(['b', 'a']);
  });

  it('time keys on 已完成 sort by 完成时间 (completedAt)', () => {
    const a = task({ id: 'a', status: 'done', completedAt: '2026-01-10T00:00:00.000Z' });
    const b = task({ id: 'b', status: 'done', completedAt: '2026-01-20T00:00:00.000Z' });
    expect(orderBy('done', 'time_asc', [b, a])).toEqual(['a', 'b']);
  });

  it('priority key ranks urgency on any column (e.g. 已完成)', () => {
    const low = task({ id: 'low', status: 'done', priority: 'low', completedAt: '2026-01-20T00:00:00.000Z' });
    const urgent = task({ id: 'urgent', status: 'done', priority: 'urgent', completedAt: '2026-01-10T00:00:00.000Z' });
    // Default done order would put `low` (newer) first; priority flips it.
    expect(orderBy('done', 'priority', [low, urgent])).toEqual(['urgent', 'low']);
  });

  it('due key puts the soonest DDL first and undated tasks last', () => {
    const none = task({ id: 'none', status: 'open', dueDate: null });
    const near = task({ id: 'near', status: 'open', dueDate: '2026-01-05' });
    const far = task({ id: 'far', status: 'open', dueDate: '2026-03-01' });
    expect(orderBy('open', 'due', [none, far, near])).toEqual(['near', 'far', 'none']);
  });

  it('breaks due-key ties (both undated) with the default order, not NaN', () => {
    const a = task({ id: 'a', status: 'open', priority: 'low', dueDate: null });
    const b = task({ id: 'b', status: 'open', priority: 'urgent', dueDate: null });
    expect(orderBy('open', 'due', [a, b])).toEqual(['b', 'a']);
  });

  it('sinks tasks missing the stage timestamp to the end in BOTH time directions', () => {
    // The card shows no 提交时间 chip for `nodate` (statusTimeInfo → null), so it
    // must not interleave mid-list by some other timestamp.
    const nodate = task({ id: 'nodate', status: 'pending_review', deliveredAt: null, createdAt: '2026-03-01T00:00:00.000Z' });
    const early = task({ id: 'early', status: 'pending_review', deliveredAt: '2026-01-10T00:00:00.000Z' });
    const late = task({ id: 'late', status: 'pending_review', deliveredAt: '2026-01-20T00:00:00.000Z' });
    expect(orderBy('pending_review', 'time_desc', [nodate, early, late])).toEqual(['late', 'early', 'nodate']);
    expect(orderBy('pending_review', 'time_asc', [nodate, late, early])).toEqual(['early', 'late', 'nodate']);
  });
});

describe('taskMatcher (板块搜索)', () => {
  const t = task({
    id: 't',
    title: '完成登录页面 Login Page',
    labels: [{ id: '00000000-0000-0000-0000-00000000000a', name: '前端', color: '#3b82f6' }],
    claimants: [{ ...claimant('2026-01-01T00:00:00.000Z'), displayName: '李四' }],
    projectName: '增长项目',
  });

  function matches(query: string): boolean {
    const m = taskMatcher(query);
    return m !== null && m(t);
  }

  it('matches title case-insensitively and ignores surrounding whitespace', () => {
    expect(matches('登录')).toBe(true);
    expect(matches('  login ')).toBe(true);
    expect(matches('LOGIN')).toBe(true);
  });

  it('matches label names, claimant names, and the project name', () => {
    expect(matches('前端')).toBe(true);
    expect(matches('李四')).toBe(true);
    expect(matches('增长')).toBe(true);
  });

  it('empty / whitespace query yields null (not filtering); misses return false', () => {
    expect(taskMatcher('')).toBeNull();
    expect(taskMatcher('   ')).toBeNull();
    expect(matches('不存在的词')).toBe(false);
  });
});
