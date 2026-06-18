import type { FastifyPluginAsync } from 'fastify';
import {
  assignTaskInputSchema,
  createTaskInputSchema,
  deliverTaskInputSchema,
  idParamSchema,
  releaseTaskInputSchema,
  reviewTaskInputSchema,
  updateTaskInputSchema,
  type BoardResponse,
  type CreateTaskInput,
  type TaskResponse,
} from 'shared';
import { z } from 'zod';
import { requireAuth, requireProjectMember } from '../lib/guards.js';
import { parseBody, parseParams } from '../lib/validate.js';
import {
  assignTask,
  claimTask,
  createTask,
  deleteTask,
  deliverTask,
  getTask,
  listAllVisibleTasks,
  listBoardTasks,
  releaseTask,
  reviewTask,
  revokeApproval,
  updateTask,
} from '../services/taskService.js';

/**
 * Task / board routes (§7, §6.1, §6.2). The route layer validates request
 * params/bodies against the shared zod contracts, requires authentication, and
 * delegates all domain logic + authorization + activity/realtime side effects to
 * `taskService`. Responses use the shared wire shapes (`BoardResponse`,
 * `TaskResponse`).
 */

/** Path params for /projects/:id/tasks (the project id). */
const projectIdParamSchema = z.object({ id: idParamSchema.shape.id });

const tasksRoutes: FastifyPluginAsync = async (fastify) => {
  const { db, bus } = fastify;

  // GET /projects/:id/tasks — board data (§6.1).
  fastify.get('/projects/:id/tasks', async (request): Promise<BoardResponse> => {
    const { id: projectId } = parseParams(projectIdParamSchema, request.params);
    // Visibility check: only project members (or admins) may read the board (§6.3).
    await requireProjectMember(db, request, projectId);
    const tasks = await listBoardTasks(db, projectId);
    return { tasks };
  });

  // POST /projects/:id/tasks — create within a project (§6.1, §6.2). Legacy entry
  // point; the body `projectId` (if any) is ignored in favor of the path param.
  fastify.post('/projects/:id/tasks', async (request, reply): Promise<TaskResponse> => {
    const { id: projectId } = parseParams(projectIdParamSchema, request.params);
    // The schema applies a default for `priority`, so the validated runtime value
    // always has it set and matches the output type (`CreateTaskInput`). zod's
    // `z.ZodType<T>` inference picks the input shape (priority optional), so assert
    // to the post-parse output type.
    const input = parseBody(createTaskInputSchema, request.body) as CreateTaskInput;
    const task = await createTask(db, bus, request, projectId, input);
    reply.code(201);
    return { task };
  });

  // POST /tasks — unified create (§8). With a `projectId` in the body the task is
  // created in that project (caller must be a member); without one it is a no-project
  // (task-pool) task that any authenticated user may create.
  fastify.post('/tasks', async (request, reply): Promise<TaskResponse> => {
    const input = parseBody(createTaskInputSchema, request.body) as CreateTaskInput;
    const task = await createTask(db, bus, request, input.projectId ?? null, input);
    reply.code(201);
    return { task };
  });

  // GET /tasks/all — every task the caller can see across their projects + the
  // no-project task pool, each with owning-project context + claimants (§8).
  fastify.get('/tasks/all', async (request): Promise<BoardResponse> => {
    const user = requireAuth(request);
    const tasks = await listAllVisibleTasks(db, user);
    return { tasks };
  });

  // GET /tasks/:id — single task (§7).
  fastify.get('/tasks/:id', async (request): Promise<TaskResponse> => {
    const { id } = parseParams(idParamSchema, request.params);
    const task = await getTask(db, request, id);
    return { task };
  });

  // PATCH /tasks/:id — edit fields / status / rank (§6.1).
  fastify.patch('/tasks/:id', async (request): Promise<TaskResponse> => {
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(updateTaskInputSchema, request.body);
    const task = await updateTask(db, bus, request, id, input);
    return { task };
  });

  // POST /tasks/:id/claim — claim an open, unassigned task (§6.2).
  fastify.post('/tasks/:id/claim', async (request): Promise<TaskResponse> => {
    const { id } = parseParams(idParamSchema, request.params);
    const task = await claimTask(db, bus, request, id);
    return { task };
  });

  // POST /tasks/:id/release — remove a claimant (self, or another via lead) (v2 §3).
  fastify.post('/tasks/:id/release', async (request): Promise<TaskResponse> => {
    const { id } = parseParams(idParamSchema, request.params);
    const { userId } = parseBody(releaseTaskInputSchema, request.body ?? {});
    const task = await releaseTask(db, bus, request, id, userId);
    return { task };
  });

  // POST /tasks/:id/assign — lead/admin dispatch (§6.2, v2 §3).
  fastify.post('/tasks/:id/assign', async (request): Promise<TaskResponse> => {
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(assignTaskInputSchema, request.body);
    const task = await assignTask(db, bus, request, id, input);
    return { task };
  });

  // POST /tasks/:id/deliver — claimant/lead submits points split for review (v2 §3).
  fastify.post('/tasks/:id/deliver', async (request): Promise<TaskResponse> => {
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(deliverTaskInputSchema, request.body);
    const task = await deliverTask(db, bus, request, id, input);
    return { task };
  });

  // POST /tasks/:id/review — lead/admin approve/reject a delivered task (v2 §3).
  fastify.post('/tasks/:id/review', async (request): Promise<TaskResponse> => {
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(reviewTaskInputSchema, request.body);
    const task = await reviewTask(db, bus, request, id, input);
    return { task };
  });

  // POST /tasks/:id/revoke-approval — 撤销通过: a done task → pending_review for re-review.
  fastify.post('/tasks/:id/revoke-approval', async (request): Promise<TaskResponse> => {
    const { id } = parseParams(idParamSchema, request.params);
    const task = await revokeApproval(db, bus, request, id);
    return { task };
  });

  // DELETE /tasks/:id — creator/lead/admin (§6.3).
  fastify.delete('/tasks/:id', async (request, reply): Promise<void> => {
    const { id } = parseParams(idParamSchema, request.params);
    await deleteTask(db, bus, request, id);
    reply.code(204);
  });
};

export default tasksRoutes;
