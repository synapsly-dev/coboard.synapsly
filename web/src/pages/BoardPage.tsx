import { useParams } from 'react-router-dom';
import { FolderKanban } from 'lucide-react';
import { EmptyState } from '../components/ui';
import { useBoardTasks } from '../api/tasks';
import { Board } from '../features/board/Board';

/**
 * Kanban board page (§6.1). The active project comes from the `/board/:projectId`
 * route param (set by the ProjectSwitcher). Loads the board task list and renders
 * the three-column dnd board; real-time updates arrive via SSE-driven query
 * invalidation (§6.5, lib/sse.ts) which refetches {@link useBoardTasks}.
 */
export default function BoardPage(): JSX.Element {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: tasks, isLoading, isError } = useBoardTasks(projectId);

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <EmptyState
          icon={FolderKanban}
          title="请选择一个项目"
          description="从顶部的项目切换器中选择，开始查看看板。"
        />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <EmptyState
          title="无法加载看板"
          description="请稍后重试，或确认你有该项目的访问权限。"
        />
      </div>
    );
  }

  return <Board projectId={projectId} tasks={tasks ?? []} isLoading={isLoading} />;
}
