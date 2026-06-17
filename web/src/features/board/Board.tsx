import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import type { Task, TaskStatus } from 'shared';
import { EmptyState, FullPageSpinner } from '../../components/ui';
import { useAuth } from '../../lib/auth-context';
import { useProjectMembers } from '../../api/tasks';
import { TaskDetailDrawer } from '../task/TaskDetailDrawer';
import { Column } from './Column';
import { CreateTaskDialog } from './CreateTaskDialog';
import {
  BoardFilters,
  FILTER_ALL,
  FILTER_ME,
  LABEL_FILTER_ALL,
  type AssigneeFilter,
  type LabelFilter,
} from './BoardFilters';
import { useLabels } from '../../api/labels';
import { COLUMN_ORDER, STATUS_LABELS } from './labels';
import { compareTasksInColumn } from './sort';
import { resolveProjectRole } from './permissions';
import { cn } from '../../lib/utils';

/**
 * The kanban board (lifecycle v2 §5; all-projects §8). Four columns: 待认领 / 进行中
 * / 待审阅 / 已完成. Cards are static (no drag) — all transitions happen through the
 * card actions (认领 / 交付 / 审阅) and the detail drawer (which also handles the
 * open↔进行中 status change). On mobile a status pager shows one column at a time;
 * md+ shows all four.
 *
 * In all-projects mode (`allProjects`, §8) `projectId` is the ALL_PROJECTS sentinel.
 * There is no single board project, so member-scoped affordances (the assignee
 * filter) are suppressed and each card shows a project badge; the detail drawer
 * resolves each task's own project for full role-aware actions.
 */
export interface BoardProps {
  projectId: string;
  tasks: Task[];
  isLoading: boolean;
  /** All-projects aggregate view (§8): show per-card project badges, hide member UI. */
  allProjects?: boolean;
}

export function Board({
  projectId,
  tasks,
  isLoading,
  allProjects = false,
}: BoardProps): JSX.Element {
  const { user } = useAuth();
  // No single owning project in all-projects mode → no board-level member list.
  const { data: members } = useProjectMembers(allProjects ? undefined : projectId);

  const [filter, setFilter] = useState<AssigneeFilter>(FILTER_ALL);
  const [labelFilter, setLabelFilter] = useState<LabelFilter>(LABEL_FILTER_ALL);
  const { data: labels } = useLabels();
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  // Deep-link support: `?task=<id>` opens the detail drawer (e.g. from the 灵感区).
  const [searchParams, setSearchParams] = useSearchParams();
  // Mobile only: which status "page" is shown (desktop shows all 4 columns).
  const [activeStatus, setActiveStatus] = useState<TaskStatus>('open');

  const projectRole = resolveProjectRole(members, user?.id);
  const permCtx = useMemo(() => ({ user, projectRole }), [user, projectRole]);

  // Open the drawer for a `?task=<id>` deep link (e.g. clicking an idea in 灵感区).
  const linkedTaskId = searchParams.get('task');
  useEffect(() => {
    if (linkedTaskId) setOpenTaskId(linkedTaskId);
  }, [linkedTaskId]);

  /**
   * Apply the claimant filter (v2: filter by claimants) and the label filter
   * (task-labels) to the flat task list.
   */
  const filtered = useMemo(() => {
    let list = tasks;
    if (filter !== FILTER_ALL) {
      const target = filter === FILTER_ME ? user?.id : filter;
      if (target) list = list.filter((t) => t.claimants.some((c) => c.userId === target));
    }
    if (labelFilter !== LABEL_FILTER_ALL) {
      list = list.filter((t) => t.labels.some((l) => l.id === labelFilter));
    }
    return list;
  }, [tasks, filter, labelFilter, user?.id]);

  /**
   * Group filtered tasks by column, each sorted by its lifecycle-appropriate
   * order (task-sort): 待认领 by urgency; 进行中/已完成 by status-entry time newest
   * first; 待审阅 by submit time oldest first. See {@link compareTasksInColumn}.
   */
  const columns = useMemo(() => {
    const byStatus: Record<TaskStatus, Task[]> = {
      open: [],
      in_progress: [],
      pending_review: [],
      done: [],
    };
    for (const task of filtered) byStatus[task.status].push(task);
    for (const status of COLUMN_ORDER) {
      byStatus[status].sort(compareTasksInColumn(status));
    }
    return byStatus;
  }, [filtered]);

  if (isLoading) {
    return <FullPageSpinner />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <BoardFilters
          value={filter}
          onChange={setFilter}
          members={members ?? []}
          currentUserId={user?.id}
          membersOnly={!allProjects}
          labels={labels ?? []}
          labelFilter={labelFilter}
          onLabelFilterChange={setLabelFilter}
        />
        <div className="ml-auto">
          <CreateTaskDialog projectId={projectId} />
        </div>
      </div>

      {/* Board */}
      {tasks.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 pb-6">
          <EmptyState
            icon={ClipboardList}
            title="还没有任务"
            description="点击右上角「新建任务」开始安排工作。"
          />
        </div>
      ) : (
        <>
          {/* Mobile status pager: tap a status to page to its column. Desktop
              (md+) shows all four columns at once and hides these tabs. */}
          <div className="flex flex-wrap gap-1.5 px-4 pb-2 sm:px-6 md:hidden">
            {COLUMN_ORDER.map((status) => {
              const active = status === activeStatus;
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => setActiveStatus(status)}
                  aria-pressed={active}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground hover:text-foreground',
                  )}
                >
                  {STATUS_LABELS[status]}
                  <span
                    className={cn(
                      'rounded-full px-1.5 text-[10px] leading-4',
                      active ? 'bg-primary-foreground/20' : 'bg-background',
                    )}
                  >
                    {columns[status].length}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex min-h-0 flex-1 gap-3 overflow-hidden px-4 pb-4 sm:px-6">
            {COLUMN_ORDER.map((status) => (
              <Column
                key={status}
                status={status}
                tasks={columns[status]}
                projectId={projectId}
                permCtx={permCtx}
                showProjectBadge={allProjects}
                onOpenTask={setOpenTaskId}
                className={cn(status === activeStatus ? 'flex' : 'hidden', 'md:flex')}
              />
            ))}
          </div>
        </>
      )}

      {/* Detail drawer */}
      <TaskDetailDrawer
        taskId={openTaskId}
        projectId={projectId}
        open={openTaskId !== null}
        onOpenChange={(next) => {
          if (!next) {
            setOpenTaskId(null);
            // Drop the deep-link param so reopening the board doesn't re-open it.
            if (searchParams.has('task')) {
              const params = new URLSearchParams(searchParams);
              params.delete('task');
              setSearchParams(params, { replace: true });
            }
          }
        }}
      />
    </div>
  );
}
