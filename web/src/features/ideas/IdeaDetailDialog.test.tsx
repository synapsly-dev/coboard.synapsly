import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { IdeaWithContext, User } from 'shared';
import { IdeaDetailDialog } from './IdeaDetailDialog';

/**
 * 想法详情 read dialog: full body through the safe Markdown pipeline, attachment
 * chips, admin 采纳/驳回 on pending ideas, and 删除 for author/admin.
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

vi.mock('../../api/ideas', () => ({
  useAdoptIdea: () => ({ mutate: vi.fn(), isPending: false }),
  useRejectIdea: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteIdea: () => ({ mutate: vi.fn(), isPending: false }),
}));

function makeIdea(overrides: Partial<IdeaWithContext> = {}): IdeaWithContext {
  return {
    id: 'idea-1',
    taskId: null,
    taskTitle: null,
    projectId: null,
    projectName: null,
    author: { id: 'user-2', displayName: '李四', avatarColor: '#888888', hasAvatar: false },
    body: '## 增长方案\n\n用 **A/B 实验** 验证落地页转化。',
    status: 'pending',
    rewardPoints: null,
    adoptedBy: null,
    files: [
      {
        id: '00000000-0000-0000-0000-00000000000f',
        filename: '方案.pdf',
        mime: 'application/pdf',
        sizeBytes: 2048,
        uploaderId: 'user-2',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderDialog(idea: IdeaWithContext | null, canManage: boolean): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <IdeaDetailDialog idea={idea} canManage={canManage} onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('IdeaDetailDialog', () => {
  it('renders the full markdown body, attachments, and admin review actions', () => {
    renderDialog(makeIdea(), true);

    // Markdown pipeline: heading + bold render as elements, not raw ## / ** text.
    expect(screen.getByText('增长方案')).toBeTruthy();
    expect(screen.getByText('A/B 实验')).toBeTruthy();
    expect(screen.queryByText(/##/)).toBeNull();

    expect(screen.getByText('方案.pdf')).toBeTruthy();
    expect(screen.getByText('独立想法')).toBeTruthy();
    // Author name appears in the avatar (sr-only) AND the byline.
    expect(screen.getAllByText('李四').length).toBeGreaterThan(0);

    // Admin on a pending idea: 采纳 / 驳回 + the idea-level 删除 (exact match —
    // the attachment chip has its own "删除 方案.pdf" button).
    expect(screen.getByRole('button', { name: '采纳' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '驳回' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '删除' })).toBeTruthy();
  });

  it('hides review/delete for a non-admin viewer on an adopted idea', () => {
    renderDialog(makeIdea({ status: 'adopted', rewardPoints: 20 }), false);

    expect(screen.queryByRole('button', { name: /采纳/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /删除/ })).toBeNull();
    expect(screen.getByText('奖励 20 点')).toBeTruthy();
  });

  it('labels a pool-task idea with its task title and 无项目', () => {
    renderDialog(
      makeIdea({ taskId: '00000000-0000-0000-0000-0000000000aa', taskTitle: '整理周报' }),
      false,
    );
    expect(screen.getByText('想法 · 整理周报')).toBeTruthy();
    expect(screen.getByText('无项目')).toBeTruthy();
  });

  it('renders nothing when idea is null (closed)', () => {
    renderDialog(null, true);
    expect(screen.queryByText('独立想法')).toBeNull();
  });
});
