import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { ClipboardList } from 'lucide-react';
import type { User, Task, TaskStatus } from 'shared';
import { taskStatuses } from 'shared';
import { EmptyState, FullPageSpinner } from '../../components/ui';
import { useAuth } from '../../lib/auth-context';
import { usePatchTask, useProjectMembers } from '../../api/tasks';
import { TaskDetailDrawer } from '../task/TaskDetailDrawer';
import { Column } from './Column';
import { TaskCard } from './TaskCard';
import { CreateTaskDialog } from './CreateTaskDialog';
import {
  BoardFilters,
  FILTER_ALL,
  FILTER_ME,
  type AssigneeFilter,
} from './BoardFilters';
import { COLUMN_ORDER } from './labels';
import { canEditTask, resolveProjectRole } from './permissions';
import { rankBetween } from './rank';

/**
 * The kanban board (§6.1). Owns drag-and-drop orchestration: dropping a card in a
 * different column issues a status PATCH; reordering within a column issues a rank
 * PATCH. Both use the optimistic {@link usePatchTask} mutation so the move is
 * instant and self-heals on error. Tasks are grouped/sorted from the flat board
 * list and filtered by the active assignee filter.
 */
export interface BoardProps {
  projectId: string;
  tasks: Task[];
  isLoading: boolean;
}

function isTaskStatus(value: string): value is TaskStatus {
  return (taskStatuses as readonly string[]).includes(value);
}

export function Board({ projectId, tasks, isLoading }: BoardProps): JSX.Element {
  const { user } = useAuth();
  const { data: members } = useProjectMembers(projectId);
  const patchTask = usePatchTask(projectId, user?.id);

  const [filter, setFilter] = useState<AssigneeFilter>(FILTER_ALL);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const sensors = useSensors(
    // 5px activation distance lets a click open the drawer without starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const projectRole = resolveProjectRole(members, user?.id);
  const permCtx = { user, projectRole };

  /** assignee id → user for avatars. */
  const usersById = useMemo(() => {
    const map = new Map<string, User>();
    for (const m of members ?? []) map.set(m.userId, m.user);
    return map;
  }, [members]);

  /** Apply the assignee filter to the flat task list. */
  const filtered = useMemo(() => {
    if (filter === FILTER_ALL) return tasks;
    if (filter === FILTER_ME) return tasks.filter((t) => t.assigneeId === user?.id);
    return tasks.filter((t) => t.assigneeId === filter);
  }, [tasks, filter, user?.id]);

  /** Group filtered tasks by column, sorted by rank then creation time. */
  const columns = useMemo(() => {
    const byStatus: Record<TaskStatus, Task[]> = {
      open: [],
      in_progress: [],
      done: [],
    };
    for (const task of filtered) byStatus[task.status].push(task);
    for (const status of COLUMN_ORDER) {
      byStatus[status].sort((a, b) => {
        if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
        return a.createdAt < b.createdAt ? -1 : 1;
      });
    }
    return byStatus;
  }, [filtered]);

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : undefined;

  function handleDragStart(event: DragStartEvent): void {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent): void {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const task = tasks.find((t) => t.id === String(active.id));
    if (!task) return;
    if (!canEditTask(permCtx, task)) return;

    // Determine the destination column: `over` is either a column droppable
    // (id = status) or another task (resolve to that task's column).
    const overId = String(over.id);
    let destStatus: TaskStatus;
    if (isTaskStatus(overId)) {
      destStatus = overId;
    } else {
      const overTask = tasks.find((t) => t.id === overId);
      if (!overTask) return;
      destStatus = overTask.status;
    }

    // Build the destination list as it appears now (sorted), excluding the
    // dragged task, to compute neighbours for the new rank.
    const destList = columns[destStatus].filter((t) => t.id !== task.id);

    // Find insertion index. If dropped over a task, insert before it; if over the
    // column itself, append to the end.
    let insertIndex = destList.length;
    if (!isTaskStatus(overId)) {
      const idx = destList.findIndex((t) => t.id === overId);
      if (idx !== -1) insertIndex = idx;
    }

    const before = insertIndex > 0 ? destList[insertIndex - 1]!.rank : null;
    const after = insertIndex < destList.length ? destList[insertIndex]!.rank : null;

    const sameColumn = destStatus === task.status;
    const samePosition =
      sameColumn &&
      columns[destStatus].findIndex((t) => t.id === task.id) === insertIndex;
    if (samePosition && before === null && after === null) return;

    const newRank = rankBetween(before, after);

    const patch =
      destStatus === task.status
        ? { rank: newRank }
        : { status: destStatus, rank: newRank };

    // No-op guard: identical rank and status.
    if (destStatus === task.status && newRank === task.rank) return;

    patchTask.mutate({ taskId: task.id, patch });
  }

  if (isLoading) {
    return <FullPageSpinner />;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <BoardFilters
          value={filter}
          onChange={setFilter}
          members={members ?? []}
          currentUserId={user?.id}
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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-4 sm:px-6">
            {COLUMN_ORDER.map((status) => (
              <Column
                key={status}
                status={status}
                tasks={columns[status]}
                projectId={projectId}
                usersById={usersById}
                onOpenTask={setOpenTaskId}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={null}>
            {activeTask ? (
              <TaskCard
                task={activeTask}
                projectId={projectId}
                assignee={
                  activeTask.assigneeId ? usersById.get(activeTask.assigneeId) : undefined
                }
                dragging
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* Detail drawer */}
      <TaskDetailDrawer
        taskId={openTaskId}
        projectId={projectId}
        open={openTaskId !== null}
        onOpenChange={(next) => {
          if (!next) setOpenTaskId(null);
        }}
      />
    </div>
  );
}
