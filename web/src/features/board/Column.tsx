import { useMemo, useState } from 'react';
import { ArrowUpDown, Check, Search } from 'lucide-react';
import type { Task, TaskStatus } from 'shared';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
} from '../../components/ui';
import { cn } from '../../lib/utils';
import { TaskCard } from './TaskCard';
import { STATUS_LABELS, STATUS_TIME } from './labels';
import { compareTasksForKey, taskMatcher, type ColumnSortKey } from './sort';
import type { TaskPermissionContext } from './permissions';

/**
 * A single board column (lifecycle v2 §5) — a vertical list of task cards. Cards
 * are static (no drag); status transitions happen via the card actions
 * (认领 / 交付 / 审阅) and the detail drawer.
 *
 * The header carries per-column search and sort (板块搜索/排序): search filters by
 * title/labels/claimants/project, sort defaults to the lifecycle order and can be
 * switched to the column's own timestamp (发布/提交/完成), priority, or due date.
 * Both are column-local view state — they never mutate the shared task list.
 */
export interface ColumnProps {
  status: TaskStatus;
  tasks: Task[];
  projectId: string;
  /** Current user + project role; forwarded to each card for action gating. */
  permCtx: TaskPermissionContext;
  /** Show a per-card owning-project badge (the 全部项目 view, §8). */
  showProjectBadge?: boolean;
  onOpenTask?: (taskId: string) => void;
  /** Extra classes — used by the mobile paged view to show/hide one column. */
  className?: string;
}

const COLUMN_ACCENT: Record<TaskStatus, string> = {
  open: 'bg-muted-foreground/40',
  in_progress: 'bg-primary',
  pending_review: 'bg-warning',
  done: 'bg-success',
};

/** Compact ghost icon button for the dense column header (Button handles the rest). */
const HEADER_BTN = 'h-8 w-8 shrink-0 text-muted-foreground sm:h-8 sm:w-8';

/** The sort menu entries for a column; the time entries name its own timestamp. */
function sortOptions(status: TaskStatus): { key: ColumnSortKey; label: string }[] {
  const time = STATUS_TIME[status].label;
  return [
    { key: 'default', label: '默认排序' },
    { key: 'time_desc', label: `${time}：新 → 旧` },
    { key: 'time_asc', label: `${time}：旧 → 新` },
    { key: 'priority', label: '优先级：高 → 低' },
    { key: 'due', label: '截止日期：近 → 远' },
  ];
}

export function Column({
  status,
  tasks,
  projectId,
  permCtx,
  showProjectBadge = false,
  onOpenTask,
  className,
}: ColumnProps): JSX.Element {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<ColumnSortKey>('default');

  // Null = empty query (not filtering); taskMatcher owns that definition.
  const matcher = useMemo(() => taskMatcher(query), [query]);
  const filtering = matcher !== null;

  // Search then (re-)sort. `tasks` arrives in the column's default order (Board
  // sorts it), so `default` keeps it as-is; other keys sort a copy.
  const visible = useMemo(() => {
    const matched = matcher ? tasks.filter(matcher) : tasks;
    if (sortKey === 'default') return matched;
    return [...matched].sort(compareTasksForKey(status, sortKey));
  }, [tasks, matcher, sortKey, status]);

  const toggleSearch = (): void => {
    // Closing also clears the query — no invisible filters on a closed box.
    if (searchOpen) setQuery('');
    setSearchOpen(!searchOpen);
  };

  return (
    <section
      className={cn(
        // Mobile (paged view): the active column fills the width; siblings are
        // hidden by the parent (see Board). md+: equal full-width flex columns.
        'flex h-full min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-xl bg-secondary/40',
        'md:w-auto md:flex-1 md:shrink',
        className,
      )}
      aria-label={STATUS_LABELS[status]}
    >
      <header className="flex items-center gap-2 px-3 py-1.5">
        <span className={cn('h-2 w-2 rounded-full', COLUMN_ACCENT[status])} aria-hidden />
        <h2 className="truncate text-sm font-semibold text-foreground">
          {STATUS_LABELS[status]}
        </h2>
        <span className="rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {filtering ? `${visible.length}/${tasks.length}` : tasks.length}
        </span>

        <div className="ml-auto flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSearch}
            aria-expanded={searchOpen}
            aria-label={`搜索${STATUS_LABELS[status]}任务`}
            title="搜索"
            className={cn(HEADER_BTN, (searchOpen || filtering) && 'text-primary')}
          >
            <Search className="h-4 w-4" aria-hidden />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`${STATUS_LABELS[status]}排序方式`}
                title="排序"
                className={cn(HEADER_BTN, sortKey !== 'default' && 'text-primary')}
              >
                <ArrowUpDown className="h-4 w-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[12rem]">
              {sortOptions(status).map((opt) => (
                <DropdownMenuItem key={opt.key} onSelect={() => setSortKey(opt.key)}>
                  <Check
                    className={cn('h-3.5 w-3.5', opt.key === sortKey ? 'opacity-100' : 'opacity-0')}
                    aria-hidden
                  />
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {searchOpen && (
        <div className="px-2 pb-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索标题 / 标签 / 认领人"
            aria-label={`搜索${STATUS_LABELS[status]}任务`}
            autoFocus
            className="h-9 bg-background text-sm sm:h-8"
          />
        </div>
      )}

      <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-3 pt-0.5">
        {visible.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            projectId={projectId}
            permCtx={permCtx}
            showProjectBadge={showProjectBadge}
            onOpen={onOpenTask}
          />
        ))}

        {visible.length === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border/70 px-3 py-8 text-center text-xs text-muted-foreground">
            {filtering && tasks.length > 0 ? '无匹配任务' : '暂无任务'}
          </div>
        )}
      </div>
    </section>
  );
}
