import { useNavigate, useParams } from 'react-router-dom';
import { ChevronsUpDown, FolderKanban } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui';
import { useProjects } from '../../api/projects';
import { cn } from '../../lib/utils';

/**
 * Project switcher (§4). Lists the current user's visible projects (useProjects)
 * and navigates to a project's board on selection. Reflects the active project
 * from the `/board/:projectId` route param.
 */
export function ProjectSwitcher(): JSX.Element {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const { data: projects, isLoading } = useProjects();

  const active = projects?.find((p) => p.id === projectId);
  const visibleProjects = projects?.filter((p) => !p.archived) ?? [];

  const label = isLoading ? '加载项目…' : (active?.name ?? '选择项目');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-9 max-w-[16rem] items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium transition-colors',
            'hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          aria-label="切换项目"
        >
          <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[14rem]">
        <DropdownMenuLabel>项目</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {visibleProjects.length === 0 ? (
          <DropdownMenuItem disabled>暂无可见项目</DropdownMenuItem>
        ) : (
          visibleProjects.map((project) => (
            <DropdownMenuItem
              key={project.id}
              onSelect={() => navigate(`/board/${project.id}`)}
              className={cn(project.id === projectId && 'bg-accent text-accent-foreground')}
            >
              <span className="truncate">{project.name}</span>
              <span className="ml-auto text-xs text-muted-foreground">{project.key}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
