import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createTaskTextInputSchema, idParamSchema, type TaskTextsResponse } from 'shared';
import { forbidden, notFound } from '../lib/errors.js';
import { requireTaskVisibility } from '../lib/guards.js';
import { parseBody, parseParams } from '../lib/validate.js';
import { loadTaskOrThrow } from '../services/commentService.js';
import {
  createTaskText,
  deleteTaskText,
  listTaskTexts,
  loadTaskTextOrThrow,
} from '../services/taskTextService.js';

/**
 * Task text-deliverable routes (交付内容 §7.2):
 * - GET    /tasks/:id/texts          list a task's text deliverables
 * - POST   /tasks/:id/texts          submit a text deliverable
 * - DELETE /tasks/:id/texts/:textId  delete (author / project lead / global admin)
 *
 * Read + submit require task visibility (project member, or any authed user for a
 * pool task §8); delete is gated to the author or the lead-equivalent. Mirrors the
 * attachment routes; data access + realtime fan-out live in taskTextService.
 */

const textParamsSchema = z.object({
  id: z.string().uuid(),
  textId: z.string().uuid(),
});

const taskTextsRoutes: FastifyPluginAsync = async (fastify) => {
  const { db, bus } = fastify;

  fastify.get('/tasks/:id/texts', async (request): Promise<TaskTextsResponse> => {
    const { id } = parseParams(idParamSchema, request.params);
    const task = await loadTaskOrThrow(db, id);
    await requireTaskVisibility(db, request, task);
    const texts = await listTaskTexts(db, id);
    return { texts };
  });

  fastify.post('/tasks/:id/texts', async (request, reply): Promise<TaskTextsResponse> => {
    const { id } = parseParams(idParamSchema, request.params);
    const task = await loadTaskOrThrow(db, id);
    const { user } = await requireTaskVisibility(db, request, task);
    const input = parseBody(createTaskTextInputSchema, request.body);

    const text = await createTaskText(
      db,
      { taskId: task.id, projectId: task.projectId, authorId: user.id, content: input.content },
      bus,
    );
    reply.code(201);
    return { texts: [text] };
  });

  fastify.delete('/tasks/:id/texts/:textId', async (request, reply) => {
    const { id, textId } = parseParams(textParamsSchema, request.params);
    const task = await loadTaskOrThrow(db, id);
    const { user, isLead } = await requireTaskVisibility(db, request, task);

    const meta = await loadTaskTextOrThrow(db, textId);
    if (meta.taskId !== id) {
      throw notFound('交付内容不存在');
    }
    const isAuthor = meta.authorId === user.id;
    if (!isAuthor && !isLead) {
      throw forbidden('只能删除自己提交的交付内容');
    }

    await deleteTaskText(db, { id: meta.id, taskId: meta.taskId }, task.projectId, bus);
    return reply.code(204).send();
  });
};

export default taskTextsRoutes;
