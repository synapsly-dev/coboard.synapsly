import type {
  AssignTaskInput,
  BoardResponse,
  CreateTaskInput,
  DeliverTaskInput,
  ProjectMembersResponse,
  ReviewTaskInput,
  TaskResponse,
  TaskReviewsResponse,
  TransferTaskInput,
  UpdateTaskInput,
} from 'shared';
import type { HttpAdapter } from './http.js';

export const ALL_PROJECTS = 'all';

export function createTasksClient(http: HttpAdapter) {
  return {
    board: (projectId: string, signal?: AbortSignal): Promise<BoardResponse> =>
      http.request({ method: 'GET', path: `/projects/${projectId}/tasks`, signal }),
    all: (signal?: AbortSignal): Promise<BoardResponse> =>
      http.request({ method: 'GET', path: '/tasks/all', signal }),
    get: (taskId: string, signal?: AbortSignal): Promise<TaskResponse> =>
      http.request({ method: 'GET', path: `/tasks/${taskId}`, signal }),
    create: (body: CreateTaskInput): Promise<TaskResponse> =>
      http.request({ method: 'POST', path: '/tasks', body }),
    update: (taskId: string, body: UpdateTaskInput): Promise<TaskResponse> =>
      http.request({ method: 'PATCH', path: `/tasks/${taskId}`, body }),
    claim: (taskId: string): Promise<TaskResponse> =>
      http.request({ method: 'POST', path: `/tasks/${taskId}/claim` }),
    release: (taskId: string, userId?: string): Promise<TaskResponse> =>
      http.request({
        method: 'POST',
        path: `/tasks/${taskId}/release`,
        body: userId ? { userId } : undefined,
      }),
    assign: (taskId: string, body: AssignTaskInput): Promise<TaskResponse> =>
      http.request({ method: 'POST', path: `/tasks/${taskId}/assign`, body }),
    deliver: (taskId: string, body: DeliverTaskInput): Promise<TaskResponse> =>
      http.request({ method: 'POST', path: `/tasks/${taskId}/deliver`, body }),
    review: (taskId: string, body: ReviewTaskInput): Promise<TaskResponse> =>
      http.request({ method: 'POST', path: `/tasks/${taskId}/review`, body }),
    reviews: (taskId: string, signal?: AbortSignal): Promise<TaskReviewsResponse> =>
      http.request({ method: 'GET', path: `/tasks/${taskId}/reviews`, signal }),
    transfer: (taskId: string, body: TransferTaskInput): Promise<TaskResponse> =>
      http.request({ method: 'POST', path: `/tasks/${taskId}/transfer`, body }),
    revokeApproval: (taskId: string): Promise<TaskResponse> =>
      http.request({ method: 'POST', path: `/tasks/${taskId}/revoke-approval` }),
    remove: (taskId: string): Promise<void> =>
      http.request({ method: 'DELETE', path: `/tasks/${taskId}` }),
    members: (projectId: string, signal?: AbortSignal): Promise<ProjectMembersResponse> =>
      http.request({ method: 'GET', path: `/projects/${projectId}/members`, signal }),
  };
}

export type TasksClient = ReturnType<typeof createTasksClient>;
