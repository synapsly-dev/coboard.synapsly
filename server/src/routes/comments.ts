import type { FastifyPluginAsync } from 'fastify';
import {
  createCommentInputSchema,
  idParamSchema,
  updateCommentInputSchema,
  type ActivitiesResponse,
  type CommentsResponse,
} from 'shared';
import { forbidden } from '../lib/errors.js';
import { requireProjectMember } from '../lib/guards.js';
import { parseBody, parseParams } from '../lib/validate.js';
import {
  createComment,
  deleteComment,
  listActivities,
  listComments,
  loadCommentOrThrow,
  loadTaskOrThrow,
  updateComment,
} from '../services/commentService.js';

/**
 * Comment & activity routes (§5, §6.5, §7):
 * - GET    /tasks/:id/comments      list a task's comments
 * - POST   /tasks/:id/comments      add a comment (parses @mentions, records
 *                                    a `commented` activity, fans out on the bus)
 * - PATCH  /comments/:id            edit a comment (author only)
 * - DELETE /comments/:id            delete a comment (author / lead / admin)
 * - GET    /tasks/:id/activities    the task's activity timeline
 *
 * Every endpoint requires the caller to be a member of the task's project (§6.3);
 * non-members must not even learn the task exists. Authorization is enforced via
 * the shared guards; data access lives in commentService.
 */
const commentsRoutes: FastifyPluginAsync = async (fastify) => {
  // --- GET /tasks/:id/comments ---------------------------------------------
  fastify.get('/tasks/:id/comments', async (request): Promise<CommentsResponse> => {
    const { id } = parseParams(idParamSchema, request.params);
    const task = await loadTaskOrThrow(fastify.db, id);
    // Project membership (admins included) gates visibility.
    await requireProjectMember(fastify.db, request, task.projectId);

    const comments = await listComments(fastify.db, id);
    return { comments };
  });

  // --- POST /tasks/:id/comments --------------------------------------------
  fastify.post('/tasks/:id/comments', async (request, reply): Promise<CommentsResponse> => {
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(createCommentInputSchema, request.body);

    const task = await loadTaskOrThrow(fastify.db, id);
    // Any project member may comment (§6.3).
    const { user } = await requireProjectMember(fastify.db, request, task.projectId);

    const comment = await createComment(
      fastify.db,
      {
        task,
        authorId: user.id,
        body: input.body,
        explicitMentions: input.mentions,
      },
      fastify.bus,
    );

    reply.code(201);
    return { comments: [comment] };
  });

  // --- PATCH /comments/:id (author only) -----------------------------------
  fastify.patch('/comments/:id', async (request): Promise<CommentsResponse> => {
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(updateCommentInputSchema, request.body);

    const comment = await loadCommentOrThrow(fastify.db, id);
    const task = await loadTaskOrThrow(fastify.db, comment.taskId);
    const { user } = await requireProjectMember(fastify.db, request, task.projectId);

    // Only the original author may edit their comment (§7).
    if (comment.authorId !== user.id) {
      throw forbidden('只能编辑自己发表的评论');
    }

    const updated = await updateComment(
      fastify.db,
      {
        comment,
        task,
        body: input.body,
        explicitMentions: input.mentions,
      },
      fastify.bus,
    );

    return { comments: [updated] };
  });

  // --- DELETE /comments/:id (author / lead / admin) ------------------------
  fastify.delete('/comments/:id', async (request, reply) => {
    const { id } = parseParams(idParamSchema, request.params);

    const comment = await loadCommentOrThrow(fastify.db, id);
    const task = await loadTaskOrThrow(fastify.db, comment.taskId);
    const membership = await requireProjectMember(fastify.db, request, task.projectId);

    // Author, project lead, or global admin may delete (§6.3).
    const isAuthor = comment.authorId === membership.user.id;
    const isLeadOrAdmin = membership.projectRole === 'lead';
    if (!isAuthor && !isLeadOrAdmin) {
      throw forbidden('只能删除自己发表的评论');
    }

    await deleteComment(fastify.db, comment, task, fastify.bus);
    return reply.code(204).send();
  });

  // --- GET /tasks/:id/activities -------------------------------------------
  fastify.get('/tasks/:id/activities', async (request): Promise<ActivitiesResponse> => {
    const { id } = parseParams(idParamSchema, request.params);
    const task = await loadTaskOrThrow(fastify.db, id);
    await requireProjectMember(fastify.db, request, task.projectId);

    const activities = await listActivities(fastify.db, id);
    return { activities };
  });
};

export default commentsRoutes;
