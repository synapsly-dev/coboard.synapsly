import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Task, User } from 'shared';
import { Column } from './Column';
import type { TaskPermissionContext } from './permissions';

/**
 * Column search + sort (板块搜索/排序). Verifies the header search filters the
 * card list (and the count reads matched/total), closing search clears it, and
 * the sort menu re-orders cards away from the lifecycle default.
 */

const mockUser: User = {
  id: 'user-1',
  email: 'me@example.com',
  displayName: '张三',
  avatarColor: '#3b82f6',
  role: 'member',
  isActive: true,
  hasAvatar: false,
  createdAt: '2026-06-01T00:00:00.000Z',
};

vi.mock('../../lib/auth-context', () => ({
  useAuth: () => ({
    user: mockUser,
    loading: false,
    isAuthenticated: true,
    isAdmin: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock('../../api/tasks', () => ({
  useClaimTask: () => ({ mutate: vi.fn(), isPending: false }),
  useDeliverTask: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useReviewTask: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));

const permCtx: TaskPermissionContext = { user: mockUser, projectRole: 'member' };

function makeTask(overrides: Partial<Task> & Pick<Task, 'id' | 'title'>): Task {
  return {
    projectId: 'project-1',
    projectName: '示例项目',
    projectKey: 'DEMO',
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
    createdBy: 'user-1',
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
    createdAt: '2026-06-15T00:00:00.000Z',
    ...overrides,
  };
}

function renderColumn(tasks: Task[]): void {
  render(<Column status="open" tasks={tasks} projectId="project-1" permCtx={permCtx} />);
}

/** Card titles in render order. */
function titles(): (string | null)[] {
  return screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
}

describe('Column search (板块搜索)', () => {
  it('filters cards by the query and shows a matched/total count', async () => {
    const user = userEvent.setup();
    renderColumn([
      makeTask({ id: 't1', title: '完成登录页面' }),
      makeTask({ id: 't2', title: '编写接口文档' }),
    ]);

    await user.click(screen.getByRole('button', { name: '搜索待认领任务' }));
    await user.type(screen.getByPlaceholderText('搜索标题 / 标签 / 认领人'), '登录');

    expect(screen.getByText('完成登录页面')).toBeTruthy();
    expect(screen.queryByText('编写接口文档')).toBeNull();
    expect(screen.getByText('1/2')).toBeTruthy();
  });

  it('shows 无匹配任务 when the query hits nothing, and closing search clears it', async () => {
    const user = userEvent.setup();
    renderColumn([makeTask({ id: 't1', title: '完成登录页面' })]);

    const toggle = screen.getByRole('button', { name: '搜索待认领任务' });
    await user.click(toggle);
    await user.type(screen.getByPlaceholderText('搜索标题 / 标签 / 认领人'), '不存在');
    expect(screen.getByText('无匹配任务')).toBeTruthy();

    // Toggling the search closed clears the filter — no invisible query left.
    await user.click(toggle);
    expect(screen.getByText('完成登录页面')).toBeTruthy();
  });
});

describe('Column sort (板块排序)', () => {
  it('re-orders cards when switching from 默认 to 发布时间：新 → 旧', async () => {
    const user = userEvent.setup();
    // Default open order = urgency first → 紧急旧任务 leads; publish-time-desc
    // puts the newer 低优新任务 first.
    renderColumn([
      makeTask({ id: 't1', title: '紧急旧任务', priority: 'urgent', createdAt: '2026-06-10T09:00:00' }),
      makeTask({ id: 't2', title: '低优新任务', priority: 'low', createdAt: '2026-06-18T09:00:00' }),
    ]);
    expect(titles()).toEqual(['紧急旧任务', '低优新任务']);

    await user.click(screen.getByRole('button', { name: '待认领排序方式' }));
    await user.click(await screen.findByText('发布时间：新 → 旧'));

    expect(titles()).toEqual(['低优新任务', '紧急旧任务']);
  });
});
