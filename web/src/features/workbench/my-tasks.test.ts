import { describe, expect, it } from 'vitest';
import { addDays, format } from 'date-fns';
import type { Task, TaskClaimant, TaskStatus } from 'shared';
import { byDueDateThenTitle, isDueUrgent, selectMyActiveTasks } from './my-tasks';

/**
 * Unit coverage for the shared 工作台 selectors (P3 §3). The nav reminder badge
 * and the WorkbenchPage's 「我的进行中」 both build on these, so the tests pin the
 * claimant filter, urgency ordering, and the overdue / due-soon classification.
 */

const ME = 'user-me';

function claimant(userId: string): TaskClaimant {
  return {
    userId,
    displayName: userId,
    avatarColor: '#3b82f6',
    hasAvatar: false,
    points: null,
    claimedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeTask(
  overrides: Partial<Task> & Pick<Task, 'id' | 'title' | 'status'>,
): Task {
  return {
    projectId: null,
    projectName: null,
    projectKey: null,
    description: null,
    points: null,
    priority: 'medium',
    taskType: null,
    deliverableSpec: null,
    acceptanceCriteria: null,
    qualityGrade: null,
    needsFinalReview: false,
    firstApprovedBy: null,
    firstApprover: null,
    firstApprovedAt: null,
    minClaimants: 1,
    maxClaimants: null,
    dueDate: null,
    createdBy: 'user-creator',
    creator: null,
    rank: 'a0',
    completedAt: null,
    deliveredAt: null,
    deliveredBy: null,
    deliverer: null,
    reviewedBy: null,
    reviewer: null,
    claimants: [claimant(ME)],
    labels: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** "YYYY-MM-DD" local date offset by `days` from today. */
function dayOffset(days: number): string {
  return format(addDays(new Date(), days), 'yyyy-MM-dd');
}

describe('selectMyActiveTasks', () => {
  it('keeps only my claimed open/in_progress tasks', () => {
    const tasks: Task[] = [
      makeTask({ id: 't-open', title: 'A', status: 'open' }),
      makeTask({ id: 't-progress', title: 'B', status: 'in_progress' }),
      makeTask({ id: 't-review', title: 'C', status: 'pending_review' }),
      makeTask({ id: 't-done', title: 'D', status: 'done' }),
      makeTask({ id: 't-other', title: 'E', status: 'open', claimants: [claimant('user-x')] }),
      makeTask({ id: 't-none', title: 'F', status: 'open', claimants: [] }),
    ];
    const mine = selectMyActiveTasks(tasks, ME);
    expect(mine.map((t) => t.id).sort()).toEqual(['t-open', 't-progress']);
  });

  it('returns nothing when the user is unknown', () => {
    const tasks = [makeTask({ id: 't1', title: 'A', status: 'open' })];
    expect(selectMyActiveTasks(tasks, undefined)).toEqual([]);
    expect(selectMyActiveTasks(tasks, null)).toEqual([]);
  });

  it('sorts by due date ascending with null dates last, then by title', () => {
    const tasks: Task[] = [
      makeTask({ id: 't-late', title: '晚', status: 'open', dueDate: '2026-12-31' }),
      makeTask({ id: 't-none-b', title: '乙', status: 'open', dueDate: null }),
      makeTask({ id: 't-early', title: '早', status: 'open', dueDate: '2026-01-02' }),
      makeTask({ id: 't-none-a', title: '甲', status: 'open', dueDate: null }),
    ];
    const mine = selectMyActiveTasks(tasks, ME);
    // Null due dates go last, tie-broken by zh-CN title order (甲 before 乙).
    expect(mine.map((t) => t.id)).toEqual(['t-early', 't-late', 't-none-a', 't-none-b']);
  });
});

describe('isDueUrgent', () => {
  const cases: Array<{ due: string | null; urgent: boolean; label: string }> = [
    { due: dayOffset(-1), urgent: true, label: 'overdue yesterday' },
    { due: dayOffset(0), urgent: true, label: 'due today' },
    { due: dayOffset(2), urgent: true, label: 'due within ~48h' },
    { due: dayOffset(3), urgent: false, label: 'due later this week' },
    { due: null, urgent: false, label: 'no due date' },
  ];
  for (const { due, urgent, label } of cases) {
    it(`classifies ${label} as ${urgent ? 'urgent' : 'not urgent'}`, () => {
      const task = makeTask({ id: 't', title: 'T', status: 'open', dueDate: due });
      expect(isDueUrgent(task)).toBe(urgent);
    });
  }
});

describe('byDueDateThenTitle', () => {
  it('is stable for identical due dates via zh-CN title compare', () => {
    const a = makeTask({ id: 'a', title: '安排', status: 'open' as TaskStatus, dueDate: '2026-06-01' });
    const b = makeTask({ id: 'b', title: '布置', status: 'open' as TaskStatus, dueDate: '2026-06-01' });
    expect(byDueDateThenTitle(a, b)).toBeLessThan(0);
    expect(byDueDateThenTitle(b, a)).toBeGreaterThan(0);
  });
});
