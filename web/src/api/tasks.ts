import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { queryKeys } from 'client-core';
import type {
  CreateTaskInput,
  DeliverTaskInput,
  ProjectMemberWithUser,
  ReviewTaskInput,
  Task,
  TaskResponse,
  TaskReview,
  TransferTaskInput,
  UpdateTaskInput,
} from 'shared';
import { coboardClient } from '../platform/coboard-client';

/**
 * Task data + mutation hooks (§7 tasks). Reads drive the kanban board and the
 * task detail drawer. Field edits and deletes use bounded optimistic updates;
 * lifecycle mutations always apply the authoritative Task returned by the server.
 * Other clients are refreshed by the realtime invalidation layer.
 *
 * Optimistic pattern (field edits/deletes only):
 *  - onMutate: cancel in-flight board/task queries, snapshot caches, apply the
 *    predicted next state, return the snapshot as rollback context.
 *  - onError: restore the snapshot (so a 409 lost-claim race etc. reverts).
 *  - onSettled: invalidate the affected queries to reconcile with the server.
 */

// ---------------------------------------------------------------------------
// Low-level fetchers — shared by hooks and mutation reconciliation.
// ---------------------------------------------------------------------------

/**
 * Sentinel projectId for the "全部项目" board (§8). Used as the `:projectId` route
 * param and as the cache key for {@link useAllTasks}; `queryKeys.allTasks()` is
 * `queryKeys.board(ALL_PROJECTS)` so the optimistic helpers reuse that cache.
 */
export { ALL_PROJECTS } from 'client-core';

const tasksClient = coboardClient.tasks;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Board tasks for a project (§7 GET /projects/:id/tasks). */
export function useBoardTasks(projectId: string | undefined): UseQueryResult<Task[]> {
  return useQuery<Task[]>({
    queryKey: projectId ? queryKeys.board(projectId) : ['projects', '__none__', 'tasks'],
    queryFn: async ({ signal }) => {
      const res = await tasksClient.board(projectId!, signal);
      return res.tasks;
    },
    enabled: projectId !== undefined,
  });
}

/**
 * All tasks visible to the current user — their member projects' tasks plus every
 * no-project (pool) task (§8 GET /tasks/all). Powers the "全部项目" board; each
 * task carries `projectName`/`projectKey` (null for pool tasks) for the badge.
 */
export function useAllTasks(enabled = true): UseQueryResult<Task[]> {
  return useQuery<Task[]>({
    queryKey: queryKeys.allTasks(),
    queryFn: async ({ signal }) => {
      const res = await tasksClient.all(signal);
      return res.tasks;
    },
    enabled,
  });
}

/** A task's 审核记录 (P2 §2 GET /tasks/:id/reviews), newest first. */
export function useTaskReviews(taskId: string | undefined): UseQueryResult<TaskReview[]> {
  return useQuery<TaskReview[]>({
    queryKey: taskId ? queryKeys.taskReviews(taskId) : ['tasks', '__none__', 'reviews'],
    queryFn: async ({ signal }) => {
      const res = await tasksClient.reviews(taskId!, signal);
      return res.reviews;
    },
    enabled: taskId !== undefined,
  });
}

/** A single task by id (§7 GET /tasks/:id). */
export function useTask(taskId: string | undefined): UseQueryResult<Task> {
  return useQuery<Task>({
    queryKey: taskId ? queryKeys.task(taskId) : ['tasks', '__none__'],
    queryFn: async ({ signal }) => {
      const res = await tasksClient.get(taskId!, signal);
      return res.task;
    },
    enabled: taskId !== undefined,
  });
}

/**
 * Read-only project member list (§7 GET /projects/:id/members) — needed by the
 * assignee picker (CreateTaskDialog, TaskDetailDrawer). Member *management*
 * mutations are owned by the admin frontend; this hook only reads.
 */
export function useProjectMembers(
  projectId: string | undefined,
): UseQueryResult<ProjectMemberWithUser[]> {
  return useQuery<ProjectMemberWithUser[]>({
    queryKey: projectId ? queryKeys.projectMembers(projectId) : ['projects', '__none__', 'members'],
    queryFn: async ({ signal }) => {
      const res = await tasksClient.members(projectId!, signal);
      return res.members;
    },
    enabled: projectId !== undefined,
  });
}

// ---------------------------------------------------------------------------
// Optimistic mutation helpers
// ---------------------------------------------------------------------------

/** Snapshot captured in onMutate, restored on error. */
interface BoardSnapshot {
  board: Task[] | undefined;
  task: Task | undefined;
}

/**
 * Patch one task within the cached board array (immutably) and the single-task
 * cache, applying `patch` to the matching task. Returns the prior snapshot.
 */
function applyOptimisticTask(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
  taskId: string,
  patch: (task: Task) => Task,
): BoardSnapshot {
  const boardKey = queryKeys.board(projectId);
  const taskKey = queryKeys.task(taskId);

  const board = queryClient.getQueryData<Task[]>(boardKey);
  const task = queryClient.getQueryData<Task>(taskKey);

  if (board) {
    queryClient.setQueryData<Task[]>(
      boardKey,
      board.map((t) => (t.id === taskId ? patch(t) : t)),
    );
  }
  if (task) {
    queryClient.setQueryData<Task>(taskKey, patch(task));
  }

  return { board, task };
}

function restoreSnapshot(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
  taskId: string,
  snapshot: BoardSnapshot | undefined,
): void {
  if (!snapshot) return;
  queryClient.setQueryData(queryKeys.board(projectId), snapshot.board);
  queryClient.setQueryData(queryKeys.task(taskId), snapshot.task);
}

function invalidateTask(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
  taskId: string,
): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.board(projectId) });
  // The "全部项目" board (§8) aggregates every visible task, so a mutation issued
  // from a project board must also refresh it (and vice-versa). Idempotent when
  // projectId === ALL_PROJECTS (same key).
  void queryClient.invalidateQueries({ queryKey: queryKeys.allTasks() });
  void queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.activities(taskId) });
  // Completing/reopening shifts contribution stats.
  void queryClient.invalidateQueries({ queryKey: ['stats'] });
  // 工作台 (P2 §4): review queue / rejected lists mirror task state.
  void queryClient.invalidateQueries({ queryKey: ['workbench'] });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Create a task via the unified endpoint (§8 POST /tasks). The body carries an
 * optional `projectId`: present → a project task (caller must be a member);
 * absent/null → a no-project (pool) task. No optimistic insert (the server mints
 * id/rank/timestamps); we refetch the affected project board (when scoped) and the
 * "全部项目" board on success.
 */
export function useCreateTask(): UseMutationResult<TaskResponse, Error, CreateTaskInput> {
  const queryClient = useQueryClient();
  return useMutation<TaskResponse, Error, CreateTaskInput>({
    mutationFn: (body) => tasksClient.create(body),
    onSuccess: (_data, body) => {
      if (body.projectId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.board(body.projectId) });
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.allTasks() });
    },
  });
}

/** Variables accepted by the patch mutation: id + partial fields. */
export interface PatchTaskVars {
  taskId: string;
  patch: UpdateTaskInput;
}

/**
 * Patch a task's fields / rank, plus the direct open↔in_progress board moves
 * (§7 PATCH /tasks/:id, lifecycle v2 §3) with an optimistic update. Deliver/review
 * own the pending_review/done transitions, so this never touches completion state.
 */
export function usePatchTask(
  projectId: string,
): UseMutationResult<TaskResponse, Error, PatchTaskVars, BoardSnapshot> {
  const queryClient = useQueryClient();
  return useMutation<TaskResponse, Error, PatchTaskVars, BoardSnapshot>({
    mutationFn: ({ taskId, patch }) => tasksClient.update(taskId, patch),
    onMutate: async ({ taskId, patch }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.board(projectId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.task(taskId) });
      // `labelIds` is a write-only id set whose shape differs from the displayed
      // `labels` objects — strip it from the optimistic spread (the server returns
      // the resolved label objects, reconciled on settle).
      const { labelIds: _labelIds, ...optimistic } = patch;
      return applyOptimisticTask(queryClient, projectId, taskId, (task) => ({
        ...task,
        ...optimistic,
        // Status is server-owned. A min-claimant edit may move the task only after
        // the authoritative response is received.
        status: task.status,
      }));
    },
    onError: (_err, { taskId }, context) => {
      restoreSnapshot(queryClient, projectId, taskId, context);
    },
    onSuccess: ({ task }) => {
      queryClient.setQueryData(queryKeys.task(task.id), task);
    },
    onSettled: (_data, _err, { taskId }) => {
      invalidateTask(queryClient, projectId, taskId);
    },
  });
}

/**
 * Claim a task. Lifecycle transitions are server-owned; the returned Task is the
 * only state written back into client caches.
 */
export function useClaimTask(projectId: string): UseMutationResult<TaskResponse, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<TaskResponse, Error, string>({
    mutationFn: (taskId) => tasksClient.claim(taskId),
    onSuccess: ({ task }) => {
      queryClient.setQueryData(queryKeys.task(task.id), task);
    },
    onSettled: (_data, _err, taskId) => {
      invalidateTask(queryClient, projectId, taskId);
    },
  });
}

/** Variables for release: task id + optional target (defaults to self). */
export interface ReleaseTaskVars {
  taskId: string;
  /** The claimant to remove; omitted means the current user releases themselves. */
  userId?: string;
}

/**
 * Release a claimant from a task (lifecycle v2 §3). Optimistically removes the
 * target from the claimants set; when none remain the task drops back to open.
 */
export function useReleaseTask(
  projectId: string,
): UseMutationResult<TaskResponse, Error, ReleaseTaskVars> {
  const queryClient = useQueryClient();
  return useMutation<TaskResponse, Error, ReleaseTaskVars>({
    mutationFn: ({ taskId, userId }) => tasksClient.release(taskId, userId),
    onSuccess: ({ task }) => {
      queryClient.setQueryData(queryKeys.task(task.id), task);
    },
    onSettled: (_data, _err, { taskId }) => {
      invalidateTask(queryClient, projectId, taskId);
    },
  });
}

/** Variables for assign: task id + assignee. */
export interface AssignTaskVars {
  taskId: string;
  assigneeId: string;
  /** Optional display fields retained for the picker; lifecycle state is not predicted. */
  assignee?: { displayName: string; avatarColor: string; hasAvatar: boolean };
}

/**
 * Dispatch a task to a member (lifecycle v2 §3, lead/admin only — enforced
 * server-side). Adds the user to the claimants set; open tasks move to in_progress.
 */
export function useAssignTask(
  projectId: string,
): UseMutationResult<TaskResponse, Error, AssignTaskVars> {
  const queryClient = useQueryClient();
  return useMutation<TaskResponse, Error, AssignTaskVars>({
    mutationFn: ({ taskId, assigneeId }) => tasksClient.assign(taskId, { assigneeId }),
    onSuccess: ({ task }) => {
      queryClient.setQueryData(queryKeys.task(task.id), task);
    },
    onSettled: (_data, _err, { taskId }) => {
      invalidateTask(queryClient, projectId, taskId);
    },
  });
}

/** Variables for deliver: task id + the allocations payload. */
export interface DeliverTaskVars {
  taskId: string;
  input: DeliverTaskInput;
}

/**
 * Deliver a task for review (lifecycle v2 §3): submit the points split. Moves the
 * task to pending_review server-side; no optimistic mutation (the server validates
 * the split), we just reconcile on settle.
 */
export function useDeliverTask(
  projectId: string,
): UseMutationResult<TaskResponse, Error, DeliverTaskVars> {
  const queryClient = useQueryClient();
  return useMutation<TaskResponse, Error, DeliverTaskVars>({
    mutationFn: ({ taskId, input }) => tasksClient.deliver(taskId, input),
    onSettled: (_data, _err, { taskId }) => {
      invalidateTask(queryClient, projectId, taskId);
    },
  });
}

/** Variables for review: task id + decision (+ optional rejection reason). */
export interface ReviewTaskVars {
  taskId: string;
  input: ReviewTaskInput;
}

/**
 * Review a delivered task (lifecycle v2 §3, lead/admin only): approve → done, or
 * reject → in_progress (with an optional reason). Reconciles on settle; completing
 * shifts contribution stats, so the stats queries are invalidated too.
 */
export function useReviewTask(
  projectId: string,
): UseMutationResult<TaskResponse, Error, ReviewTaskVars> {
  const queryClient = useQueryClient();
  return useMutation<TaskResponse, Error, ReviewTaskVars>({
    mutationFn: ({ taskId, input }) => tasksClient.review(taskId, input),
    onSettled: (_data, _err, { taskId }) => {
      invalidateTask(queryClient, projectId, taskId);
    },
  });
}

/**
 * Revoke a completed task's approval (撤销通过): a `done` task returns to
 * `pending_review` for re-review. No optimistic mutation; reconciles on settle
 * (un-completing also shifts contribution stats, which invalidateTask refreshes).
 */
export function useRevokeApproval(
  projectId: string,
): UseMutationResult<TaskResponse, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<TaskResponse, Error, string>({
    mutationFn: (taskId) => tasksClient.revokeApproval(taskId),
    onSettled: (_data, _err, taskId) => {
      invalidateTask(queryClient, projectId, taskId);
    },
  });
}

/** Variables for transfer: task id + {fromUserId, toUserId, reason?}. */
export interface TransferTaskVars {
  taskId: string;
  input: TransferTaskInput;
}

/**
 * 转让 a task between claimants (P2 §5 异常流): release(from) + assign(to) as one
 * atomic server action, recorded as a `transferred` activity. Manager tier only
 * (enforced server-side). No optimistic mutation (the server validates both ends);
 * reconciles on settle like the other task mutations.
 */
export function useTransferTask(
  projectId: string,
): UseMutationResult<TaskResponse, Error, TransferTaskVars> {
  const queryClient = useQueryClient();
  return useMutation<TaskResponse, Error, TransferTaskVars>({
    mutationFn: ({ taskId, input }) => tasksClient.transfer(taskId, input),
    onSettled: (_data, _err, { taskId }) => {
      invalidateTask(queryClient, projectId, taskId);
    },
  });
}

/**
 * Delete a task (§7 DELETE /tasks/:id). Optimistically removes it from the board.
 */
export function useDeleteTask(
  projectId: string,
): UseMutationResult<void, Error, string, BoardSnapshot> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string, BoardSnapshot>({
    mutationFn: (taskId) => tasksClient.remove(taskId),
    onMutate: async (taskId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.board(projectId) });
      const boardKey = queryKeys.board(projectId);
      const board = queryClient.getQueryData<Task[]>(boardKey);
      const task = queryClient.getQueryData<Task>(queryKeys.task(taskId));
      if (board) {
        queryClient.setQueryData<Task[]>(
          boardKey,
          board.filter((t) => t.id !== taskId),
        );
      }
      return { board, task };
    },
    onError: (_err, taskId, context) => {
      restoreSnapshot(queryClient, projectId, taskId, context);
    },
    onSettled: (_data, _err, taskId) => {
      invalidateTask(queryClient, projectId, taskId);
    },
  });
}
