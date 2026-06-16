import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { LeaderboardEntry, User } from 'shared';
import { Leaderboard } from './Leaderboard';

/**
 * RTL coverage for the leaderboard (§10 前端: 统计排行榜渲染). Verifies ranked
 * rendering, the displayed metrics, current-user highlighting, and the empty
 * state. No jest-dom matchers are wired in the project, so assertions use plain
 * DOM/text queries.
 */

function makeUser(overrides: Partial<User> & Pick<User, 'id' | 'displayName'>): User {
  return {
    email: `${overrides.id}@example.com`,
    avatarColor: '#3b82f6',
    role: 'member',
    isActive: true,
    hasAvatar: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Build an entry whose points split defaults to all task points (no rewards). */
function makeEntry(
  overrides: Pick<LeaderboardEntry, 'user' | 'completedCount' | 'pointsSum'> &
    Partial<Pick<LeaderboardEntry, 'taskPoints' | 'rewardPoints'>>,
): LeaderboardEntry {
  const rewardPoints = overrides.rewardPoints ?? 0;
  return {
    taskPoints: overrides.taskPoints ?? overrides.pointsSum - rewardPoints,
    rewardPoints,
    ...overrides,
  };
}

const ENTRIES: LeaderboardEntry[] = [
  makeEntry({ user: makeUser({ id: 'u1', displayName: '张三' }), completedCount: 12, pointsSum: 34 }),
  makeEntry({ user: makeUser({ id: 'u2', displayName: '李四' }), completedCount: 8, pointsSum: 21 }),
  makeEntry({ user: makeUser({ id: 'u3', displayName: '王五' }), completedCount: 5, pointsSum: 9 }),
  makeEntry({ user: makeUser({ id: 'u4', displayName: '赵六' }), completedCount: 2, pointsSum: 3 }),
];

describe('Leaderboard', () => {
  it('renders one ranked row per entry, in order', () => {
    render(<Leaderboard entries={ENTRIES} sort="count" />);

    const list = screen.getByRole('list', { name: '贡献排行榜' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(ENTRIES.length);

    // First row is the top contributor; last row the lowest. (The Avatar repeats
    // the name in an sr-only span, so assert on row text content rather than a
    // unique text node.)
    expect(rows[0]!.textContent).toContain('张三');
    expect(rows[3]!.textContent).toContain('赵六');
  });

  it('shows both completed count and points for an entry', () => {
    render(<Leaderboard entries={[ENTRIES[0]!]} sort="count" />);
    const row = screen.getAllByRole('listitem')[0]!;
    // Count (12) and points (34) both appear in the row.
    expect(within(row).getByText('12')).toBeTruthy();
    expect(within(row).getByText('34')).toBeTruthy();
    expect(within(row).getByText('完成')).toBeTruthy();
    expect(within(row).getByText('点数')).toBeTruthy();
  });

  it('highlights the current user with a 我 badge', () => {
    render(<Leaderboard entries={ENTRIES} sort="points" currentUserId="u2" />);
    const rows = screen.getAllByRole('listitem');
    // Exactly one row carries the 我 badge, and it is 李四's (u2) row.
    expect(screen.getAllByText('我')).toHaveLength(1);
    const meRow = screen.getByText('我').closest('li');
    expect(meRow).not.toBeNull();
    expect(meRow!.textContent).toContain('李四');
    // 李四 is ranked 2nd here, so the 我 badge is on the second row.
    expect(rows[1]!.textContent).toContain('我');
  });

  it('renders an empty state when there are no entries', () => {
    render(<Leaderboard entries={[]} sort="count" />);
    expect(screen.queryByRole('list', { name: '贡献排行榜' })).toBeNull();
    expect(screen.getByText('暂无贡献数据')).toBeTruthy();
  });

  it('shows a loading indicator before data arrives', () => {
    render(<Leaderboard entries={undefined} sort="count" isLoading />);
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
