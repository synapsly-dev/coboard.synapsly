import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { User, Task } from 'shared';
import { TaskCard } from './TaskCard';

/**
 * TaskCard rendering tests (§10 — 前端关键组件 RTL). Verifies the card surfaces
 * title, points, priority, due date, and assignee avatar, and that the claim
 * affordance appears only for unassigned open tasks.
 */

// Stub auth so ClaimButton (rendered for unassigned open tasks) has a user.
const mockUser: User = {
  id: 'user-1',
  email: 'me@example.com',
  displayName: '张三',
  avatarColor: '#3b82f6',
  role: 'member',
  isActive: true,
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

const claimMutate = vi.fn();
vi.mock('../../api/tasks', () => ({
  useClaimTask: () => ({ mutate: claimMutate, isPending: false }),
}));

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    projectId: 'project-1',
    title: '完成登录页面',
    description: null,
    status: 'open',
    assigneeId: null,
    points: 5,
    priority: 'high',
    dueDate: '2026-06-20',
    createdBy: 'user-1',
    rank: 'm',
    completedAt: null,
    completedBy: null,
    createdAt: '2026-06-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('TaskCard', () => {
  beforeEach(() => {
    claimMutate.mockReset();
  });

  it('renders the title, points badge, priority, and due date', () => {
    render(<TaskCard task={makeTask()} projectId="project-1" />);

    expect(screen.getByText('完成登录页面')).toBeTruthy();
    expect(screen.getByText('5 点')).toBeTruthy();
    expect(screen.getByText('高')).toBeTruthy();
    expect(screen.getByText('06-20')).toBeTruthy();
  });

  it('shows the claim button for an unassigned open task', () => {
    render(<TaskCard task={makeTask()} projectId="project-1" />);
    expect(screen.getByRole('button', { name: '认领任务' })).toBeTruthy();
  });

  it('shows the assignee avatar (not a claim button) when assigned', () => {
    const assignee: User = { ...mockUser, id: 'user-2', displayName: '李四' };
    render(
      <TaskCard
        task={makeTask({ status: 'in_progress', assigneeId: 'user-2' })}
        projectId="project-1"
        assignee={assignee}
      />,
    );

    expect(screen.queryByRole('button', { name: '认领任务' })).toBeNull();
    // Avatar renders the display name (title + sr-only label).
    expect(screen.getAllByText('李四').length).toBeGreaterThan(0);
  });

  it('omits the points badge when points are null', () => {
    render(<TaskCard task={makeTask({ points: null })} projectId="project-1" />);
    expect(screen.queryByText(/点$/)).toBeNull();
  });
});
