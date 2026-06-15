import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { User, Task } from 'shared';
import { ClaimButton } from './ClaimButton';

/**
 * ClaimButton tests (§10 — 认领按钮). Verifies the button is shown only for
 * unassigned open tasks, triggers the claim mutation on click, and is hidden for
 * already-assigned or non-open tasks.
 */

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
    title: '任务',
    description: null,
    status: 'open',
    assigneeId: null,
    points: null,
    priority: 'medium',
    dueDate: null,
    createdBy: 'user-1',
    rank: 'm',
    completedAt: null,
    completedBy: null,
    createdAt: '2026-06-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('ClaimButton', () => {
  beforeEach(() => {
    claimMutate.mockReset();
  });

  it('renders for an unassigned open task', () => {
    render(<ClaimButton task={makeTask()} projectId="project-1" />);
    expect(screen.getByRole('button', { name: '认领任务' })).toBeTruthy();
  });

  it('calls the claim mutation with the task id on click', async () => {
    const user = userEvent.setup();
    render(<ClaimButton task={makeTask()} projectId="project-1" />);
    await user.click(screen.getByRole('button', { name: '认领任务' }));
    expect(claimMutate).toHaveBeenCalledTimes(1);
    expect(claimMutate.mock.calls[0]?.[0]).toBe('task-1');
  });

  it('renders nothing for an already-assigned task', () => {
    const { container } = render(
      <ClaimButton
        task={makeTask({ assigneeId: 'user-2', status: 'in_progress' })}
        projectId="project-1"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for a non-open task', () => {
    const { container } = render(
      <ClaimButton task={makeTask({ status: 'done' })} projectId="project-1" />,
    );
    expect(container.firstChild).toBeNull();
  });
});
