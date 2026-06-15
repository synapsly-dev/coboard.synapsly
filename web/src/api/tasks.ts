import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  AssignTaskInput,
  BoardResponse,
  CreateTaskInput,
  ProjectMembersResponse,
  ProjectMemberWithUser,
  Task,
  TaskResponse,
  UpdateTaskInput,
} from 'shared';
import { api } from './client';
import { queryKeys } from '../lib/query';

/**
 * Task data + mutation hooks (§7 tasks). Reads drive the kanban board and the
 * task detail drawer; writes use TanStack Query OPTIMISTIC updates so the acting
 * user sees instant feedback while the request is in flight. Other clients are
 * refreshed by the SSE invalidation layer (§6.5, lib/sse.ts).
 *
 * Optimistic pattern (per mutation):
 *  - onMutate: cancel in-flight board/task queries, snapshot caches, apply the
 *    predicted next state, return the snapshot as rollback context.
 *  - onError: restore the snapshot (so a 409 lost-claim race etc. reverts).
 *  - onSettled: invalidate the affected queries to reconcile with the server.
 */

// ---------------------------------------------------------------------------
// Low-level fetchers — shared by hooks and mutation reconciliation.
// ---------------------------------------------------------------------------

export const tasksApi = {
  board: (projectId: string, signal?: AbortSignal): Promise<BoardResponse> =>
    api.get<BoardResponse>(`/projects/${projectId}/tasks`, { signal }),
  get: (taskId: string, signal?: AbortSignal): Promise<TaskResponse> =>
    api.get<TaskResponse>(`/tasks/${taskId}`, { signal }),
  create: (projectId: string, body: CreateTaskInput): Promise<TaskResponse> =>
    api.post<TaskResponse>(`/projects/${projectId}/tasks`, body),
  update: (taskId: string, body: UpdateTaskInput): Promise<TaskResponse> =>
    api.patch<TaskResponse>(`/tasks/${taskId}`, body),
  claim: (taskId: string): Promise<TaskResponse> =>
    api.post<TaskResponse>(`/tasks/${taskId}/claim`),
  release: (taskId: string): Promise<TaskResponse> =>
    api.post<TaskResponse>(`/tasks/${taskId}/release`),
  assign: (taskId: string, body: AssignTaskInput): Promise<TaskResponse> =>
    api.post<TaskResponse>(`/tasks/${taskId}/assign`, body),
  remove: (taskId: string): Promise<void> => api.delete<void>(`/tasks/${taskId}`),
  members: (projectId: string, signal?: AbortSignal): Promise<ProjectMembersResponse> =>
    api.get<ProjectMembersResponse>(`/projects/${projectId}/members`, { signal }),
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Board tasks for a project (§7 GET /projects/:id/tasks). */
export function useBoardTasks(projectId: string | undefined): UseQueryResult<Task[]> {
  return useQuery<Task[]>({
    queryKey: projectId ? queryKeys.board(projectId) : ['projects', '__none__', 'tasks'],
    queryFn: async ({ signal }) => {
      const res = await tasksApi.board(projectId!, signal);
      return res.tasks;
    },
    enabled: projectId !== undefined,
  });
}

/** A single task by id (§7 GET /tasks/:id). */
export function useTask(taskId: string | undefined): UseQueryResult<Task> {
  return useQuery<Task>({
    queryKey: taskId ? queryKeys.task(taskId) : ['tasks', '__none__'],
    queryFn: async ({ signal }) => {
      const res = await tasksApi.get(taskId!, signal);
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
    queryKey: projectId
      ? queryKeys.projectMembers(projectId)
      : ['projects', '__none__', 'members'],
    queryFn: async ({ signal }) => {
      const res = await tasksApi.members(projectId!, signal);
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
  void queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.activities(taskId) });
  // Completing/reopening shifts contribution stats.
  void queryClient.invalidateQueries({ queryKey: ['stats'] });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Create a task (§7 POST /projects/:id/tasks). No optimistic insert (the server
 * mints id/rank/timestamps); we simply refetch the board on success.
 */
export function useCreateTask(
  projectId: string,
): UseMutationResult<TaskResponse, Error, CreateTaskInput> {
  const queryClient = useQueryClient();
  return useMutation<TaskResponse, Error, CreateTaskInput>({
    mutationFn: (body) => tasksApi.create(projectId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.board(projectId) });
    },
  });
}

/** Variables accepted by the patch mutation: id + partial fields. */
export interface PatchTaskVars {
  taskId: string;
  patch: UpdateTaskInput;
}

/**
 * Patch a task's fields / status / rank (§7 PATCH /tasks/:id) with an optimistic
 * update. Used for inline edits AND for drag-to-reorder/move on the board.
 *
 * `completedAt`/`completedBy` are server-derived on a status transition to/from
 * `done`; we mirror the expected effect locally so the card updates immediately,
 * then reconcile via invalidation.
 */
export function usePatchTask(
  projectId: string,
  /** Optional current user id, used to predict `completed_by` on completion. */
  currentUserId?: string,
): UseMutationResult<TaskResponse, Error, PatchTaskVars, BoardSnapshot> {
  const queryClient = useQueryClient();
  return useMutation<TaskResponse, Error, PatchTaskVars, BoardSnapshot>({
    mutationFn: ({ taskId, patch }) => tasksApi.update(taskId, patch),
    onMutate: async ({ taskId, patch }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.board(projectId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.task(taskId) });
      return applyOptimisticTask(queryClient, projectId, taskId, (task) => {
        const next: Task = { ...task, ...patch };
        if (patch.status === 'done' && task.status !== 'done') {
          next.completedAt = new Date().toISOString();
          next.completedBy = task.assigneeId ?? currentUserId ?? null;
        } else if (patch.status && patch.status !== 'done' && task.status === 'done') {
          next.completedAt = null;
          next.completedBy = null;
        }
        return next;
      });
    },
    onError: (_err, { taskId }, context) => {
      restoreSnapshot(queryClient, projectId, taskId, context);
    },
    onSettled: (_data, _err, { taskId }) => {
      invalidateTask(queryClient, projectId, taskId);
    },
  });
}

/**
 * Claim an unassigned open task (§6.2). Optimistically assigns to the current
 * user and moves to in_progress; a lost race (409) rolls back.
 */
export function useClaimTask(
  projectId: string,
  currentUserId: string,
): UseMutationResult<TaskResponse, Error, string, BoardSnapshot> {
  const queryClient = useQueryClient();
  return useMutation<TaskResponse, Error, string, BoardSnapshot>({
    mutationFn: (taskId) => tasksApi.claim(taskId),
    onMutate: async (taskId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.board(projectId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.task(taskId) });
      return applyOptimisticTask(queryClient, projectId, taskId, (task) => ({
        ...task,
        assigneeId: currentUserId,
        status: 'in_progress',
      }));
    },
    onError: (_err, taskId, context) => {
      restoreSnapshot(queryClient, projectId, taskId, context);
    },
    onSettled: (_data, _err, taskId) => {
      invalidateTask(queryClient, projectId, taskId);
    },
  });
}

/**
 * Release a task back to the open column (§6.2): clear assignee, status → open.
 */
export function useReleaseTask(
  projectId: string,
): UseMutationResult<TaskResponse, Error, string, BoardSnapshot> {
  const queryClient = useQueryClient();
  return useMutation<TaskResponse, Error, string, BoardSnapshot>({
    mutationFn: (taskId) => tasksApi.release(taskId),
    onMutate: async (taskId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.board(projectId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.task(taskId) });
      return applyOptimisticTask(queryClient, projectId, taskId, (task) => ({
        ...task,
        assigneeId: null,
        status: 'open',
      }));
    },
    onError: (_err, taskId, context) => {
      restoreSnapshot(queryClient, projectId, taskId, context);
    },
    onSettled: (_data, _err, taskId) => {
      invalidateTask(queryClient, projectId, taskId);
    },
  });
}

/** Variables for assign: task id + assignee. */
export interface AssignTaskVars {
  taskId: string;
  assigneeId: string;
}

/**
 * Dispatch a task to a member (§6.2, lead/admin only — enforced server-side).
 * Open tasks move to in_progress on assignment.
 */
export function useAssignTask(
  projectId: string,
): UseMutationResult<TaskResponse, Error, AssignTaskVars, BoardSnapshot> {
  const queryClient = useQueryClient();
  return useMutation<TaskResponse, Error, AssignTaskVars, BoardSnapshot>({
    mutationFn: ({ taskId, assigneeId }) => tasksApi.assign(taskId, { assigneeId }),
    onMutate: async ({ taskId, assigneeId }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.board(projectId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.task(taskId) });
      return applyOptimisticTask(queryClient, projectId, taskId, (task) => ({
        ...task,
        assigneeId,
        status: task.status === 'open' ? 'in_progress' : task.status,
      }));
    },
    onError: (_err, { taskId }, context) => {
      restoreSnapshot(queryClient, projectId, taskId, context);
    },
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
    mutationFn: (taskId) => tasksApi.remove(taskId),
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
